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
    user: { findUnique: vi.fn() },
    session: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'session-new',
        ...data,
      })),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
}

const jwtStub = { signAsync: vi.fn(async () => 'signed.access.token') };
const hasherStub = {
  hash: vi.fn(async (plain: string) => `hashed:${plain}`),
  verify: vi.fn(async (hash: string, plain: string) => hash === `hashed:${plain}`),
};

describe('AuthService', () => {
  let prisma: ReturnType<typeof makePrismaStub>;
  let service: AuthService;
  const context = { userAgent: 'vitest', ip: '127.0.0.1' };

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrismaStub();
    service = new AuthService(prisma as never, jwtStub as never, hasherStub as never);
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
        user: { id: 'user-1', email: activeUser.email, roles: ['admin'] },
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

      const { grant, refreshToken } = await service.refresh('raw-token', context);

      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.session.create).toHaveBeenCalledTimes(1);
      expect(grant.user.id).toBe('user-1');
      expect(refreshToken).toBeTruthy();
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
});
