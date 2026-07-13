import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RbacService } from './rbac.service';

/**
 * Unit tests with in-memory doubles — Prisma/Redis are injected dependencies,
 * so the permission-resolution logic tests without infrastructure.
 */
function makeRedisStub() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => void store.set(key, value)),
    del: vi.fn(async (key: string) => void store.delete(key)),
    store,
  };
}

const userWithRoles = (permissions: Array<[string, string]>) => [
  {
    role: {
      permissions: permissions.map(([resource, action]) => ({ permission: { resource, action } })),
    },
  },
];

describe('RbacService.getEffectivePermissions', () => {
  let redis: ReturnType<typeof makeRedisStub>;
  let prisma: { userRole: { findMany: ReturnType<typeof vi.fn> } };
  let service: RbacService;

  beforeEach(() => {
    redis = makeRedisStub();
    prisma = { userRole: { findMany: vi.fn() } };
    service = new RbacService(prisma as never, redis as never);
  });

  it('unions permissions across all of a user roles', async () => {
    prisma.userRole.findMany.mockResolvedValue([
      ...userWithRoles([['kpis', 'view']]),
      ...userWithRoles([
        ['forms', 'edit'],
        ['kpis', 'view'],
      ]),
    ]);

    const permissions = await service.getEffectivePermissions('user-1');
    expect(permissions).toEqual(new Set(['kpis:view', 'forms:edit']));
  });

  it('serves from cache on the second call without hitting the database', async () => {
    prisma.userRole.findMany.mockResolvedValue(userWithRoles([['dashboards', 'view']]));

    await service.getEffectivePermissions('user-1');
    await service.getEffectivePermissions('user-1');

    expect(prisma.userRole.findMany).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith('rbac:perms:user-1', expect.any(String), 300);
  });

  it('returns an empty set for a user with no roles', async () => {
    prisma.userRole.findMany.mockResolvedValue([]);
    const permissions = await service.getEffectivePermissions('user-2');
    expect(permissions.size).toBe(0);
  });

  it('degrades to a DB-only read instead of throwing when Redis GET fails', async () => {
    redis.get.mockRejectedValue(new Error('connection refused'));
    prisma.userRole.findMany.mockResolvedValue(userWithRoles([['kpis', 'view']]));

    const permissions = await service.getEffectivePermissions('user-3');

    expect(permissions).toEqual(new Set(['kpis:view']));
  });

  it('still returns the freshly computed permissions when Redis SET fails', async () => {
    redis.set.mockRejectedValue(new Error('connection refused'));
    prisma.userRole.findMany.mockResolvedValue(userWithRoles([['forms', 'view']]));

    const permissions = await service.getEffectivePermissions('user-4');

    expect(permissions).toEqual(new Set(['forms:view']));
  });
});

describe('RbacService role assignment', () => {
  let redis: ReturnType<typeof makeRedisStub>;
  let prisma: {
    userRole: { deleteMany: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
    auditLog: { create: ReturnType<typeof vi.fn> };
  };
  let service: RbacService;

  beforeEach(() => {
    redis = makeRedisStub();
    redis.store.set('rbac:perms:user-1', '["kpis:read"]');
    prisma = {
      userRole: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }), upsert: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    service = new RbacService(prisma as never, redis as never);
  });

  it('unassignRoleFromUser deletes the grant, audit-logs it, and invalidates the permission cache', async () => {
    await service.unassignRoleFromUser('user-1', 'role-1', 'admin-1');

    expect(prisma.userRole.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', roleId: 'role-1' },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: 'admin-1',
        action: 'role.unassigned',
        entity: 'User',
        entityId: 'user-1',
        detail: { roleId: 'role-1' },
      },
    });
    expect(redis.store.has('rbac:perms:user-1')).toBe(false);
  });

  it('assignRoleToUser upserts the grant, audit-logs it, and invalidates the permission cache', async () => {
    await service.assignRoleToUser('user-1', 'role-2', 'admin-1');

    expect(prisma.userRole.upsert).toHaveBeenCalledWith({
      where: { userId_roleId: { userId: 'user-1', roleId: 'role-2' } },
      create: { userId: 'user-1', roleId: 'role-2' },
      update: {},
    });
    expect(redis.store.has('rbac:perms:user-1')).toBe(false);
  });
});

describe('RbacService.updateRole / deleteRole', () => {
  let redis: ReturnType<typeof makeRedisStub>;
  let prisma: {
    role: {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
    rolePermission: { deleteMany: ReturnType<typeof vi.fn> };
    userRole: { findMany: ReturnType<typeof vi.fn> };
    auditLog: { create: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let service: RbacService;

  beforeEach(() => {
    redis = makeRedisStub();
    prisma = {
      role: {
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: 'role-1', name: 'renamed' }),
        delete: vi.fn().mockResolvedValue({}),
      },
      rolePermission: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      userRole: { findMany: vi.fn().mockResolvedValue([]) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn((ops: Array<Promise<unknown>>) => Promise.all(ops)),
    };
    service = new RbacService(prisma as never, redis as never);
  });

  it('updateRole renames a non-system role and audit-logs it', async () => {
    prisma.role.findUnique
      .mockResolvedValueOnce({ id: 'role-1', name: 'old', isSystem: false })
      .mockResolvedValueOnce(null);

    await service.updateRole('role-1', { name: 'renamed' }, 'admin-1');

    expect(prisma.role.update).toHaveBeenCalledWith({
      where: { id: 'role-1' },
      data: { name: 'renamed', description: undefined, isActive: undefined },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'role.updated', entityId: 'role-1' }) }),
    );
  });

  it('updateRole rejects renaming a system role', async () => {
    prisma.role.findUnique.mockResolvedValue({ id: 'role-1', name: 'admin', isSystem: true });

    await expect(service.updateRole('role-1', { name: 'x' }, 'admin-1')).rejects.toThrow(
      'System roles cannot be modified',
    );
    expect(prisma.role.update).not.toHaveBeenCalled();
  });

  it('updateRole rejects a name that collides with another role', async () => {
    prisma.role.findUnique
      .mockResolvedValueOnce({ id: 'role-1', name: 'old', isSystem: false })
      .mockResolvedValueOnce({ id: 'role-2', name: 'taken' });

    await expect(service.updateRole('role-1', { name: 'taken' }, 'admin-1')).rejects.toThrow('already exists');
  });

  it('setRoleStatus invalidates every member cache when toggling isActive', async () => {
    prisma.role.findUnique.mockResolvedValue({ id: 'role-1', name: 'x', isSystem: false });
    prisma.userRole.findMany.mockResolvedValue([{ userId: 'user-1' }, { userId: 'user-2' }]);
    redis.store.set('rbac:perms:user-1', '[]');
    redis.store.set('rbac:perms:user-2', '[]');

    await service.setRoleStatus('role-1', { isActive: false }, 'admin-1');

    expect(redis.store.has('rbac:perms:user-1')).toBe(false);
    expect(redis.store.has('rbac:perms:user-2')).toBe(false);
  });

  it('deleteRole removes a role with no members and audit-logs it', async () => {
    prisma.role.findUnique.mockResolvedValue({
      id: 'role-1',
      name: 'temp',
      isSystem: false,
      _count: { users: 0 },
    });

    await service.deleteRole('role-1', 'admin-1');

    expect(prisma.role.delete).toHaveBeenCalledWith({ where: { id: 'role-1' } });
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('deleteRole rejects a system role', async () => {
    prisma.role.findUnique.mockResolvedValue({
      id: 'role-1',
      name: 'admin',
      isSystem: true,
      _count: { users: 3 },
    });

    await expect(service.deleteRole('role-1', 'admin-1')).rejects.toThrow('cannot be deleted');
    expect(prisma.role.delete).not.toHaveBeenCalled();
  });

  it('deleteRole rejects a role that still has members', async () => {
    prisma.role.findUnique.mockResolvedValue({
      id: 'role-1',
      name: 'qa-lead',
      isSystem: false,
      _count: { users: 2 },
    });

    await expect(service.deleteRole('role-1', 'admin-1')).rejects.toThrow('member');
    expect(prisma.role.delete).not.toHaveBeenCalled();
  });
});
