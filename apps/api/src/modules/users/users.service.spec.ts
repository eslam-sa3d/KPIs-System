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
    department: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
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
        isKpiApplicable: true,
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
        { email: 'dup@pulse.local', displayName: 'Dup', password: 'S3cretPass!', roleIds: [], isKpiApplicable: true },
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

  describe('renameDepartment', () => {
    it('renames and audits when the new name is free', async () => {
      prisma.department.findUnique
        .mockResolvedValueOnce({ id: 'dept-1', name: 'Old Name' }) // existence check
        .mockResolvedValueOnce(null); // uniqueness check

      await service.renameDepartment('dept-1', { name: 'New Name' }, 'admin-1');

      expect(prisma.department.update).toHaveBeenCalledWith({
        where: { id: 'dept-1' },
        data: { name: 'New Name' },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'department.renamed', entityId: 'dept-1' }),
      });
    });

    it('rejects an unknown department with NOT_FOUND', async () => {
      prisma.department.findUnique.mockResolvedValueOnce(null);
      await expect(service.renameDepartment('ghost', { name: 'X' }, 'admin-1')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('rejects a name collision with another department, but allows renaming to its own current name', async () => {
      prisma.department.findUnique
        .mockResolvedValueOnce({ id: 'dept-1', name: 'Old Name' })
        .mockResolvedValueOnce({ id: 'dept-2', name: 'Taken' });

      await expect(service.renameDepartment('dept-1', { name: 'Taken' }, 'admin-1')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(prisma.department.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteDepartment', () => {
    it('deletes and audits when no user is assigned', async () => {
      prisma.department.findUnique.mockResolvedValue({ id: 'dept-1', name: 'Empty Dept' });
      prisma.user.count.mockResolvedValue(0);

      await service.deleteDepartment('dept-1', 'admin-1');

      expect(prisma.department.delete).toHaveBeenCalledWith({ where: { id: 'dept-1' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'department.deleted', entityId: 'dept-1' }),
      });
    });

    it('refuses to delete a department that still has members', async () => {
      prisma.department.findUnique.mockResolvedValue({ id: 'dept-1', name: 'Staffed Dept' });
      prisma.user.count.mockResolvedValue(3);

      await expect(service.deleteDepartment('dept-1', 'admin-1')).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(prisma.department.delete).not.toHaveBeenCalled();
    });

    it('rejects an unknown department with NOT_FOUND', async () => {
      prisma.department.findUnique.mockResolvedValue(null);
      await expect(service.deleteDepartment('ghost', 'admin-1')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });
});
