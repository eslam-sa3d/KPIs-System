import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccessTokenClaims, AuthenticatedUser, TokenGrant } from '@pulse/contracts';
import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../../common/app-error';
import { env } from '../../infra/env';
import { resetPasswordEmail } from '../../infra/email-templates';
import { MailerService } from '../../infra/mailer.service';
import { PrismaService } from '../../infra/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { PasswordHasher } from './password-hasher';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_DAYS = 30;
const RESET_TOKEN_TTL_MINUTES = 60;

/** Refresh/reset tokens are opaque 384-bit secrets; only their SHA-256 lands in the DB. */
const hashToken = (raw: string) => createHash('sha256').update(raw).digest('hex');

export interface SessionContext {
  userAgent?: string;
  ip?: string;
}

export interface GrantWithRefresh {
  grant: TokenGrant;
  /** Raw refresh token — the controller moves it into an httpOnly cookie. */
  refreshToken: string;
}

/**
 * Credential auth with short-lived access JWTs and rotating refresh sessions.
 *
 * Security properties:
 * - identical UNAUTHENTICATED error for unknown email / bad password / inactive
 *   account (no user enumeration)
 * - refresh rotation: every refresh revokes the presented session and issues a
 *   new one, so a token is single-use
 * - reuse detection: presenting an already-revoked refresh token is treated as
 *   theft and revokes EVERY session the user has
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly hasher: PasswordHasher,
    private readonly rbac: RbacService,
    private readonly mailer: MailerService,
  ) {}

  async login(email: string, password: string, context: SessionContext): Promise<GrantWithRefresh> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { roles: { include: { role: { select: { name: true } } } } },
    });

    const invalid = new AppError('UNAUTHENTICATED', 'Invalid email or password');
    if (!user || !user.isActive) throw invalid;
    if (!(await this.hasher.verify(user.passwordHash, password))) throw invalid;

    return this.issueGrant(await this.toAuthenticatedUser(user), context);
  }

  async refresh(rawRefreshToken: string, context: SessionContext): Promise<GrantWithRefresh> {
    const invalid = new AppError('UNAUTHENTICATED', 'Session is no longer valid');
    if (!rawRefreshToken) throw invalid;

    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hashToken(rawRefreshToken) },
      include: {
        user: { include: { roles: { include: { role: { select: { name: true } } } } } },
      },
    });
    if (!session || !session.user.isActive) throw invalid;

    if (session.revokedAt) {
      // Rotation means a legitimate client never replays a token: this is
      // either theft or a stolen-then-used-by-owner race. Kill everything.
      await this.prisma.session.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw invalid;
    }

    if (session.expiresAt < new Date()) throw invalid;

    // Atomic claim: only one of two concurrent refreshes presenting the same
    // still-valid token (e.g. two tabs racing near access-token expiry) can
    // flip revokedAt from null. The loser must NOT fall through to the
    // reuse-detection branch above — it isn't theft, just a lost race — so it
    // simply fails this one request; the winning tab's rotated cookie is what
    // survives in the browser, and the next natural refresh recovers cleanly.
    const claimed = await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) throw invalid;

    return this.issueGrant(await this.toAuthenticatedUser(session.user), context);
  }

  /** Idempotent: logging out an unknown/already-revoked token is a no-op. */
  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) return;
    await this.prisma.session.updateMany({
      where: { refreshTokenHash: hashToken(rawRefreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getProfile(userId: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: { select: { name: true } } } } },
    });
    if (!user) throw AppError.notFound('User', userId);
    return this.toAuthenticatedUser(user);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppError.notFound('User', userId);
    if (!(await this.hasher.verify(user.passwordHash, currentPassword))) {
      throw new AppError('UNAUTHENTICATED', 'Current password is incorrect');
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await this.hasher.hash(newPassword), mustChangePassword: false },
      }),
      // rotating the password revokes every other session
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: { actorId: userId, action: 'user.password_changed', entity: 'User', entityId: userId },
      }),
    ]);
    return null;
  }

  /** Always resolves the same way regardless of whether the email matches a
   *  real, active account — same no-enumeration principle as login(). */
  async forgotPassword(email: string): Promise<null> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user && user.isActive) {
      const rawToken = randomBytes(48).toString('base64url');
      await this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000),
        },
      });
      const webUrl = env.WEB_URL;
      const resetUrl = `${webUrl}/reset-password?token=${rawToken}`;
      await this.mailer.send(
        user.email,
        'reset your pulse password',
        resetPasswordEmail({
          displayName: user.displayName,
          resetUrl,
          logoUrl: `${webUrl}/brand/pulse-logo-email.png`,
          expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
        }),
      );
    } else {
      this.logger.log(`forgot-password requested for unknown/inactive email — no email sent`);
    }
    return null;
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<null> {
    const invalid = new AppError('UNAUTHENTICATED', 'This reset link is invalid or has expired');
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (!record || record.usedAt || record.expiresAt < new Date()) throw invalid;

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: await this.hasher.hash(newPassword), mustChangePassword: false },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      // resetting the password revokes every session, same as changePassword
      this.prisma.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId: record.userId,
          action: 'user.password_reset',
          entity: 'User',
          entityId: record.userId,
        },
      }),
    ]);
    return null;
  }

  private async issueGrant(user: AuthenticatedUser, context: SessionContext): Promise<GrantWithRefresh> {
    const claims: AccessTokenClaims = { sub: user.id, email: user.email };
    const accessToken = await this.jwt.signAsync(claims, {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });

    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: hashToken(refreshToken),
        userAgent: context.userAgent,
        ip: context.ip,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    return {
      grant: { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, user },
      refreshToken,
    };
  }

  private async toAuthenticatedUser(user: {
    id: string;
    email: string;
    displayName: string;
    mustChangePassword: boolean;
    roles: Array<{ role: { name: string } }>;
  }): Promise<AuthenticatedUser> {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles.map(({ role }) => role.name),
      permissions: [...(await this.rbac.getEffectivePermissions(user.id))],
      mustChangePassword: user.mustChangePassword,
    };
  }
}
