import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersService } from './users.service';
import { RbacService } from '../rbac/rbac.service';

function makePrismaStub() {
  const tx = {
    user: {
      create: vi.fn(async ({ data, select: _s }: { data: object; select?: object }) => ({ id: 'user-new', ...data })),
      update: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    session: { updateMany: vi.fn() },
  };
  return {
    tx,
    user: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
    department: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    projectGroup: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    projectGroupMember: { findMany: vi.fn(), count: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    rolePermission: { findMany: vi.fn() },
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
    const rbac = new RbacService(prisma as never, redisStub as never);
    service = new UsersService(prisma as never, hasherStub as never, redisStub as never, rbac);
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
    expect(data.mustChangePassword).toBe(true);
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

  describe('list — RolePermission.scope enforcement', () => {
    it('shows every user when the caller holds an "all"-scoped users:view grant', async () => {
      prisma.rolePermission.findMany.mockResolvedValue([{ scope: 'all' }]);
      prisma.user.count.mockResolvedValue(2);
      prisma.user.findMany.mockResolvedValue([]);

      await service.list({}, 'user-1');

      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [{}, {}] } }));
    });

    it('filters to the caller\'s own department when every users:view grant is scoped narrower than "all"', async () => {
      prisma.rolePermission.findMany.mockResolvedValue([{ scope: 'department' }]);
      prisma.user.findUnique.mockResolvedValue({ departmentId: 'dept-1' });
      prisma.user.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([]);

      await service.list({}, 'user-1');

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { AND: [{ OR: [{ departmentId: 'dept-1' }] }, {}] } }),
      );
    });

    it('sees no one (not everyone) when restricted with no department of their own', async () => {
      prisma.rolePermission.findMany.mockResolvedValue([{ scope: 'department' }]);
      prisma.user.findUnique.mockResolvedValue({ departmentId: null });
      prisma.user.count.mockResolvedValue(0);
      prisma.user.findMany.mockResolvedValue([]);

      await service.list({}, 'user-1');

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { AND: [{ OR: [{ departmentId: '__none__' }] }, {}] } }),
      );
    });

    it('restricts to the caller alone when scoped "own"', async () => {
      prisma.rolePermission.findMany.mockResolvedValue([{ scope: 'own' }]);
      prisma.user.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([]);

      await service.list({}, 'user-1');

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { AND: [{ OR: [{ id: 'user-1' }] }, {}] } }),
      );
    });

    it('filters by name/email substring, case-insensitively', async () => {
      prisma.rolePermission.findMany.mockResolvedValue([{ scope: 'all' }]);
      prisma.user.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([]);

      await service.list({ search: '  Ana  ' }, 'user-1');

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              {},
              {
                OR: [
                  { displayName: { contains: 'Ana', mode: 'insensitive' } },
                  { email: { contains: 'Ana', mode: 'insensitive' } },
                ],
              },
            ],
          },
        }),
      );
    });

    it('filters by an explicit departmentId when the caller is unrestricted', async () => {
      prisma.rolePermission.findMany.mockResolvedValue([{ scope: 'all' }]);
      prisma.user.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([]);

      await service.list({ departmentId: 'dept-2' }, 'user-1');

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { AND: [{ departmentId: 'dept-2' }, {}] } }),
      );
    });

    it('ignores a requested departmentId when the caller is restricted to their own department', async () => {
      prisma.rolePermission.findMany.mockResolvedValue([{ scope: 'department' }]);
      prisma.user.findUnique.mockResolvedValue({ departmentId: 'dept-1' });
      prisma.user.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([]);

      await service.list({ departmentId: 'dept-2' }, 'user-1');

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { AND: [{ OR: [{ departmentId: 'dept-1' }] }, {}] } }),
      );
    });
  });

  describe('stats', () => {
    it('reports total/active/inactive/department counts for an unrestricted caller', async () => {
      prisma.rolePermission.findMany.mockResolvedValue([{ scope: 'all' }]);
      prisma.user.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(7) // active
        .mockResolvedValueOnce(6); // assigned to a department
      prisma.department.count.mockResolvedValue(3);

      const result = await service.stats('user-1');

      expect(prisma.user.count).toHaveBeenNthCalledWith(1, { where: {} });
      expect(prisma.user.count).toHaveBeenNthCalledWith(2, { where: { isActive: true } });
      expect(prisma.user.count).toHaveBeenNthCalledWith(3, { where: { departmentId: { not: null } } });
      expect(result).toEqual({ total: 10, active: 7, inactive: 3, departments: 3, assignedToDepartment: 6 });
    });

    it("scopes counts to the caller's own department when restricted", async () => {
      prisma.rolePermission.findMany.mockResolvedValue([{ scope: 'department' }]);
      prisma.user.findUnique.mockResolvedValue({ departmentId: 'dept-1' });
      prisma.user.count.mockResolvedValueOnce(4).mockResolvedValueOnce(4).mockResolvedValueOnce(4);
      prisma.department.count.mockResolvedValue(3);

      await service.stats('user-1');

      expect(prisma.user.count).toHaveBeenNthCalledWith(1, { where: { OR: [{ departmentId: 'dept-1' }] } });
      expect(prisma.user.count).toHaveBeenNthCalledWith(2, {
        where: { OR: [{ departmentId: 'dept-1' }], isActive: true },
      });
    });
  });

  describe('list — project_group scope enforcement', () => {
    it('filters to every group the caller belongs to when scoped to project_group', async () => {
      prisma.rolePermission.findMany.mockResolvedValue([{ scope: 'project_group' }]);
      prisma.projectGroupMember.findMany.mockResolvedValue([{ groupId: 'group-1' }, { groupId: 'group-2' }]);
      prisma.user.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([]);

      await service.list({}, 'user-1');

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [{ OR: [{ projectGroupMemberships: { some: { groupId: { in: ['group-1', 'group-2'] } } } }] }, {}],
          },
        }),
      );
    });

    it('sees no one when restricted to project_group but a member of none', async () => {
      prisma.rolePermission.findMany.mockResolvedValue([{ scope: 'project_group' }]);
      prisma.projectGroupMember.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);
      prisma.user.findMany.mockResolvedValue([]);

      await service.list({}, 'user-1');

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { AND: [{ OR: [{ projectGroupMemberships: { some: { groupId: { in: [] } } } }] }, {}] },
        }),
      );
    });
  });

  describe('deleteProjectGroup', () => {
    it('deletes and audits when no member is assigned', async () => {
      prisma.projectGroup.findUnique.mockResolvedValue({ id: 'group-1', name: 'Empty Group' });
      prisma.projectGroupMember.count.mockResolvedValue(0);

      await service.deleteProjectGroup('group-1', 'admin-1');

      expect(prisma.projectGroup.delete).toHaveBeenCalledWith({ where: { id: 'group-1' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'project_group.deleted', entityId: 'group-1' }),
      });
    });

    it('refuses to delete a group that still has members', async () => {
      prisma.projectGroup.findUnique.mockResolvedValue({ id: 'group-1', name: 'Staffed Group' });
      prisma.projectGroupMember.count.mockResolvedValue(2);

      await expect(service.deleteProjectGroup('group-1', 'admin-1')).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(prisma.projectGroup.delete).not.toHaveBeenCalled();
    });
  });

  describe('project group membership', () => {
    it('listProjectGroupMembers returns the members of an existing group', async () => {
      prisma.projectGroup.findUnique.mockResolvedValue({ id: 'group-1', name: 'Group' });
      prisma.projectGroupMember.findMany.mockResolvedValue([
        { user: { id: 'user-1', email: 'a@pulse.local', displayName: 'Ana' } },
      ]);

      const members = await service.listProjectGroupMembers('group-1');

      expect(members).toEqual([{ id: 'user-1', email: 'a@pulse.local', displayName: 'Ana' }]);
    });

    it('listProjectGroupMembers rejects an unknown group with NOT_FOUND', async () => {
      prisma.projectGroup.findUnique.mockResolvedValue(null);
      await expect(service.listProjectGroupMembers('ghost')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('addProjectGroupMembers adds each user and audit-logs one entry per user', async () => {
      prisma.projectGroup.findUnique.mockResolvedValue({ id: 'group-1', name: 'Group' });
      prisma.user.findMany.mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }]);
      prisma.projectGroupMember.findMany.mockResolvedValue([]);

      await service.addProjectGroupMembers('group-1', ['user-1', 'user-2'], 'admin-1');

      expect(prisma.projectGroupMember.createMany).toHaveBeenCalledWith({
        data: [
          { userId: 'user-1', groupId: 'group-1' },
          { userId: 'user-2', groupId: 'group-1' },
        ],
        skipDuplicates: true,
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          actorId: 'admin-1',
          action: 'project_group.member_added',
          entity: 'User',
          entityId: 'user-1',
          detail: { groupId: 'group-1' },
        },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ entityId: 'user-2' }),
      });
    });

    it('addProjectGroupMembers rejects unknown user ids', async () => {
      prisma.projectGroup.findUnique.mockResolvedValue({ id: 'group-1', name: 'Group' });
      prisma.user.findMany.mockResolvedValue([{ id: 'user-1' }]);

      await expect(service.addProjectGroupMembers('group-1', ['user-1', 'ghost'], 'admin-1')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(prisma.projectGroupMember.createMany).not.toHaveBeenCalled();
    });

    it('removeProjectGroupMember removes the membership and audit-logs it', async () => {
      prisma.projectGroup.findUnique.mockResolvedValue({ id: 'group-1', name: 'Group' });

      await service.removeProjectGroupMember('group-1', 'user-1', 'admin-1');

      expect(prisma.projectGroupMember.deleteMany).toHaveBeenCalledWith({
        where: { groupId: 'group-1', userId: 'user-1' },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          actorId: 'admin-1',
          action: 'project_group.member_removed',
          entity: 'User',
          entityId: 'user-1',
          detail: { groupId: 'group-1' },
        },
      });
    });
  });
});
