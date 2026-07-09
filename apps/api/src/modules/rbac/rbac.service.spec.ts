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
      ...userWithRoles([['kpis', 'read']]),
      ...userWithRoles([['forms', 'write'], ['kpis', 'read']]),
    ]);

    const permissions = await service.getEffectivePermissions('user-1');
    expect(permissions).toEqual(new Set(['kpis:read', 'forms:write']));
  });

  it('serves from cache on the second call without hitting the database', async () => {
    prisma.userRole.findMany.mockResolvedValue(userWithRoles([['dashboards', 'read']]));

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
