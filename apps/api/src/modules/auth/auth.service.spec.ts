import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../common/app-error';
import { AuthService } from './auth.service';

/**
 * Unit tests with injected doubles — Prisma, JwtService and PasswordHasher are
 * constructor dependencies, so the credential/rotation/reuse logic tests
 * without a database, JWT secret, or the argon2 native binding.
 */

const activeUser = {
  id: 'user-1',
  email: 'admin@pulse.local',
  displayName: 'Admin',
  passwordHash: 'hashed:correct-password',
  isActive: true,
  roles: [{ role: { name: 'admin' } }],
};

function makePrismaStub() {
  return {
    user: { findUnique: vi.fn(), update: vi.fn() },
    session: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'session-new',
        ...data,
      })),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    passwordResetToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    // Array-form $transaction: every op is already an invoked Promise by the
    // time it lands in the array, so resolving them all is a faithful stub.
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

const jwtStub = { signAsync: vi.fn(async () => 'signed.access.token') };
const hasherStub = {
  hash: vi.fn(async (plain: string) => `hashed:${plain}`),
  verify: vi.fn(async (hash: string, plain: string) => hash === `hashed:${plain}`),
};
const rbacStub = {
  getEffectivePermissions: vi.fn(async () => new Set(['kpis:read', 'forms:read'])),
};
const mailerStub = { send: vi.fn() };

describe('AuthService', () => {
  let prisma: ReturnType<typeof makePrismaStub>;
  let service: AuthService;
  const context = { userAgent: 'vitest', ip: '127.0.0.1' };

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrismaStub();
    service = new AuthService(
      prisma as never,
      jwtStub as never,
      hasherStub as never,
      rbacStub as never,
      mailerStub as never,
    );
  });

  describe('login', () => {
    it('returns a grant and stores only a HASH of the refresh token', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);

      const { grant, refreshToken } = await service.login(
        activeUser.email,
        'correct-password',
        context,
      );

      expect(grant).toMatchObject({
        accessToken: 'signed.access.token',
        expiresIn: 900,
        user: {
          id: 'user-1',
          email: activeUser.email,
          roles: ['admin'],
          permissions: ['kpis:read', 'forms:read'],
        },
      });
      expect(refreshToken).toHaveLength(64); // 48 random bytes, base64url

      const stored = prisma.session.create.mock.calls[0]![0].data;
      expect(stored.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
      expect(stored.refreshTokenHash).not.toContain(refreshToken);
    });

    it.each([
      ['unknown email', null, 'any-password'],
      ['wrong password', activeUser, 'wrong-password'],
      ['inactive account', { ...activeUser, isActive: false }, 'correct-password'],
    ])('rejects %s with an identical UNAUTHENTICATED error (no enumeration)', async (_case, user, password) => {
      prisma.user.findUnique.mockResolvedValue(user);

      await expect(service.login(activeUser.email, password, context)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
        message: 'Invalid email or password',
      });
      expect(prisma.session.create).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    const liveSession = {
      id: 'session-1',
      userId: 'user-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: activeUser,
    };

    it('rotates: revokes the presented session and issues a new one', async () => {
      prisma.session.findUnique.mockResolvedValue(liveSession);
      prisma.session.updateMany.mockResolvedValueOnce({ count: 1 });

      const { grant, refreshToken } = await service.refresh('raw-token', context);

      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: { id: 'session-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.session.create).toHaveBeenCalledTimes(1);
      expect(grant.user.id).toBe('user-1');
      expect(refreshToken).toBeTruthy();
    });

    it('loses a concurrent rotation race cleanly, without nuking other sessions', async () => {
      // Two tabs present the same still-live token; both pass findUnique before
      // either write lands. The loser's atomic claim affects zero rows.
      prisma.session.findUnique.mockResolvedValue(liveSession);
      prisma.session.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.refresh('raw-token', context)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });

      expect(prisma.session.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: { id: 'session-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.session.create).not.toHaveBeenCalled();
    });

    it('treats reuse of a revoked token as theft: revokes ALL user sessions', async () => {
      prisma.session.findUnique.mockResolvedValue({ ...liveSession, revokedAt: new Date() });

      await expect(service.refresh('stolen-token', context)).rejects.toBeInstanceOf(AppError);

      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.session.create).not.toHaveBeenCalled();
    });

    it('rejects expired sessions', async () => {
      prisma.session.findUnique.mockResolvedValue({
        ...liveSession,
        expiresAt: new Date(Date.now() - 1),
      });
      await expect(service.refresh('old-token', context)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    it('rejects unknown and missing tokens', async () => {
      prisma.session.findUnique.mockResolvedValue(null);
      await expect(service.refresh('ghost', context)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
      await expect(service.refresh('', context)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });
  });

  describe('logout', () => {
    it('revokes the matching live session and is a no-op without a token', async () => {
      await service.logout('some-token');
      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: { refreshTokenHash: expect.stringMatching(/^[0-9a-f]{64}$/), revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });

      prisma.session.updateMany.mockClear();
      await service.logout(undefined);
      expect(prisma.session.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    it('verifies the current password, rehashes, and revokes every other session', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);

      await service.changePassword('user-1', 'correct-password', 'new-password');

      expect(hasherStub.verify).toHaveBeenCalledWith(activeUser.passwordHash, 'correct-password');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { passwordHash: 'hashed:new-password', mustChangePassword: false },
      });
      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('rejects a wrong current password without touching the stored hash', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);

      await expect(service.changePassword('user-1', 'wrong-password', 'new-password')).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    it('creates a reset token and emails it for a known, active user', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);

      await service.forgotPassword(activeUser.email);

      expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
      const stored = prisma.passwordResetToken.create.mock.calls[0]![0].data;
      expect(stored.userId).toBe('user-1');
      expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex, never the raw token

      expect(mailerStub.send).toHaveBeenCalledTimes(1);
      const [to, subject, html] = mailerStub.send.mock.calls[0]!;
      expect(to).toBe(activeUser.email);
      expect(subject).toMatch(/reset/i);
      expect(html).toContain('/reset-password?token=');
    });

    it.each([
      ['unknown email', null],
      ['inactive account', { ...activeUser, isActive: false }],
    ])('does nothing observable for %s (no enumeration)', async (_case, user) => {
      prisma.user.findUnique.mockResolvedValue(user);

      await expect(service.forgotPassword('someone@pulse.local')).resolves.toBeNull();

      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mailerStub.send).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    const liveToken = {
      id: 'reset-1',
      userId: 'user-1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };

    it('rehashes the password, marks the token used, and revokes every session', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(liveToken);

      await service.resetPassword('raw-token', 'new-password');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { passwordHash: 'hashed:new-password', mustChangePassword: false },
      });
      expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
        where: { id: 'reset-1' },
        data: { usedAt: expect.any(Date) },
      });
      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it.each([
      ['unknown token', null],
      ['already-used token', { ...liveToken, usedAt: new Date() }],
      ['expired token', { ...liveToken, expiresAt: new Date(Date.now() - 1) }],
    ])('rejects %s', async (_case, token) => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(token);

      await expect(service.resetPassword('raw-token', 'new-password')).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
