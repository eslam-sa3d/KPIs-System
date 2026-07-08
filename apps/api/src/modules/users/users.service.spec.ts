import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersService } from './users.service';

function makePrismaStub() {
  const tx = {
    user: { create: vi.fn(async ({ data, select: _s }: { data: object; select?: object }) => ({ id: 'user-new', ...data })), update: vi.fn() },
    auditLog: { create: vi.fn() },
    session: { updateMany: vi.fn() },
  };
  return {
    tx,
    user: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
    department: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    session: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (t: typeof tx) => unknown)(tx) : Promise.all(arg as Promise<unknown>[]),
    ),
  };
}

const hasherStub = { hash: vi.fn(async (p: string) => `hashed:${p}`), verify: vi.fn() };
const redisStub = { del: vi.fn(), get: vi.fn(), set: vi.fn() };

describe('UsersService', () => {
  let prisma: ReturnType<typeof makePrismaStub>;
  let service: UsersService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrismaStub();
    service = new UsersService(prisma as never, hasherStub as never, redisStub as never);
  });

  it('creates a user with a HASHED password and role links, audited', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await service.create(
      {
        email: 'new@pulse.local',
        displayName: 'New User',
        password: 'S3cretPass!',
        roleIds: ['role-1'],
      },
      'admin-1',
    );

    const data = prisma.tx.user.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.passwordHash).toBe('hashed:S3cretPass!');
    expect(data).not.toHaveProperty('password');
    expect(data.roles).toEqual({ create: [{ roleId: 'role-1' }] });
    expect(prisma.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'user.created' }),
    });
  });

  it('rejects duplicate emails with CONFLICT', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(
      service.create(
        { email: 'dup@pulse.local', displayName: 'Dup', password: 'S3cretPass!', roleIds: [] },
        'admin-1',
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('deactivation revokes live sessions and clears the permission cache', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-2' });

    await service.setStatus('user-2', false, 'admin-1');

    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-2', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(redisStub.del).toHaveBeenCalledWith('rbac:perms:user-2');
  });

  it('refuses self-deactivation', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'admin-1' });
    await expect(service.setStatus('admin-1', false, 'admin-1')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});
