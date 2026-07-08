import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccessTokenClaims, AuthenticatedUser, TokenGrant } from '@pulse/contracts';
import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../infra/prisma.service';
import { PasswordHasher } from './password-hasher';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_DAYS = 30;

/** Refresh tokens are opaque 384-bit secrets; only their SHA-256 lands in the DB. */
const hashRefreshToken = (raw: string) => createHash('sha256').update(raw).digest('hex');

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly hasher: PasswordHasher,
  ) {}

  async login(email: string, password: string, context: SessionContext): Promise<GrantWithRefresh> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { roles: { include: { role: { select: { name: true } } } } },
    });

    const invalid = new AppError('UNAUTHENTICATED', 'Invalid email or password');
    if (!user || !user.isActive) throw invalid;
    if (!(await this.hasher.verify(user.passwordHash, password))) throw invalid;

    return this.issueGrant(this.toAuthenticatedUser(user), context);
  }

  async refresh(rawRefreshToken: string, context: SessionContext): Promise<GrantWithRefresh> {
    const invalid = new AppError('UNAUTHENTICATED', 'Session is no longer valid');
    if (!rawRefreshToken) throw invalid;

    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hashRefreshToken(rawRefreshToken) },
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

    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    return this.issueGrant(this.toAuthenticatedUser(session.user), context);
  }

  /** Idempotent: logging out an unknown/already-revoked token is a no-op. */
  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) return;
    await this.prisma.session.updateMany({
      where: { refreshTokenHash: hashRefreshToken(rawRefreshToken), revokedAt: null },
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

  private async issueGrant(
    user: AuthenticatedUser,
    context: SessionContext,
  ): Promise<GrantWithRefresh> {
    const claims: AccessTokenClaims = { sub: user.id, email: user.email };
    const accessToken = await this.jwt.signAsync(claims, {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });

    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: hashRefreshToken(refreshToken),
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

  private toAuthenticatedUser(user: {
    id: string;
    email: string;
    displayName: string;
    roles: Array<{ role: { name: string } }>;
  }): AuthenticatedUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles.map(({ role }) => role.name),
    };
  }
}
