import { Injectable, Logger } from '@nestjs/common';
import { CreateRoleInput, PermissionKey, Resource, SetRoleStatusInput, UpdateRoleInput } from '@pulse/contracts';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../infra/prisma.service';
import { RedisService } from '../../infra/redis.service';

/** Resources whose rows have a `departmentId`/`projectGroupId` (directly, or one
 *  hop away via an assignment table) that a "department"/"project_group"/"own"
 *  scoped grant can actually filter by. Every RolePermission.scope value that
 *  isn't "all" is meaningful only for these — Forms/Submissions have their own,
 *  more granular access model (FormCollaborator + `restricted`), not a
 *  department, so department/project_group/own scope has no correct meaning
 *  there. Keep this in sync with the scope selector in the roles admin UI, which
 *  only offers non-"all" scope for resources listed here. */
export const DEPARTMENT_SCOPABLE_RESOURCES: readonly Resource[] = ['kpis', 'users'];
export const PROJECT_GROUP_SCOPABLE_RESOURCES: readonly Resource[] = ['users'];

const PERMISSION_CACHE_TTL_SECONDS = 300;
const cacheKey = (userId: string) => `rbac:perms:${userId}`;

/**
 * Dynamic RBAC: roles and their permission sets are data, composed by admins
 * at runtime. This service is the single authority on "what can user X do".
 */
@Injectable()
export class RbacService {
  private readonly logger = new Logger(RbacService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Resolve a user's effective permission set (union across roles), cached.
   *  Every authenticated request runs through here, so a Redis outage must
   *  degrade to DB-only reads rather than 500 the whole API. */
  async getEffectivePermissions(userId: string): Promise<Set<PermissionKey>> {
    const cached = await this.safeRedisGet(cacheKey(userId));
    if (cached) return new Set(JSON.parse(cached) as PermissionKey[]);

    const roles = await this.prisma.userRole.findMany({
      where: { userId, user: { isActive: true }, role: { isActive: true } },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });

    const permissions = new Set<PermissionKey>(
      roles.flatMap(({ role }) =>
        role.permissions.map(({ permission }) => `${permission.resource}:${permission.action}` as PermissionKey),
      ),
    );

    await this.safeRedisSet(cacheKey(userId), JSON.stringify([...permissions]), PERMISSION_CACHE_TTL_SECONDS);
    return permissions;
  }

  private async safeRedisGet(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch (err) {
      this.logger.warn(`Redis GET failed, falling back to DB for this request: ${err}`);
      return null;
    }
  }

  private async safeRedisSet(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, value, ttlSeconds);
    } catch (err) {
      this.logger.warn(`Redis SET failed, permission cache not updated for ${key}: ${err}`);
    }
  }

  /**
   * True once every one of the caller's roles that grant `resource:view` do
   * so with a scope narrower than "all" — i.e. the caller's results must be
   * filtered down to their own department/project group, not shown org-wide.
   * A single "all"-scoped grant (e.g. an admin role held alongside a narrower
   * one) is enough to see everything, matching how permission checks already
   * union across a user's roles rather than intersect.
   */
  async isViewScopeRestricted(userId: string, resource: Resource): Promise<boolean> {
    const grants = await this.prisma.rolePermission.findMany({
      where: {
        role: { isActive: true, users: { some: { userId } } },
        permission: { resource, action: 'view' },
      },
      select: { scope: true },
    });
    return !grants.some((g) => g.scope === 'all');
  }

  /** The caller's own departmentId, for building a `{ departmentId }` filter
   *  once isViewScopeRestricted() is true. Null for a caller with no
   *  department — callers should treat that as "sees nothing" when
   *  restricted, not "sees everything". */
  async myDepartmentId(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { departmentId: true } });
    if (!user) throw AppError.notFound('User', userId);
    return user.departmentId;
  }

  /** Same shape as myDepartmentId, for a "project_group"-scoped grant. */
  async myProjectGroupId(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { projectGroupId: true } });
    if (!user) throw AppError.notFound('User', userId);
    return user.projectGroupId;
  }

  /** Users-specific: unlike isViewScopeRestricted's single all-or-restricted
   *  boolean, `users:view` can be scoped by department AND/OR project_group at
   *  once (a caller might hold one role scoped each way) — the effective view
   *  is the UNION of whichever dimensions are granted, same "any 'all' grant
   *  wins" precedence as everywhere else. Returns 'all' when unrestricted,
   *  otherwise the distinct non-'all' scope values actually granted. */
  async userViewScopeKinds(userId: string): Promise<'all' | Array<'department' | 'project_group' | 'own'>> {
    const grants = await this.prisma.rolePermission.findMany({
      where: {
        role: { isActive: true, users: { some: { userId } } },
        permission: { resource: 'users', action: 'view' },
      },
      select: { scope: true },
    });
    if (grants.some((g) => g.scope === 'all')) return 'all';
    return [...new Set(grants.map((g) => g.scope))].filter(
      (s): s is 'department' | 'project_group' | 'own' => s === 'department' || s === 'project_group' || s === 'own',
    );
  }

  /** dashboards:view-specific: null means unrestricted (the caller holds an
   *  "all"-scoped grant), otherwise the union of PerformanceLevel ids across
   *  every "level"-scoped dashboards:view grant the caller holds. An empty
   *  array means restricted-but-nothing-selected (sees nobody), not
   *  unrestricted — callers must distinguish null from []. */
  async allowedDashboardLevelIds(userId: string): Promise<string[] | null> {
    const grants = await this.prisma.rolePermission.findMany({
      where: {
        role: { isActive: true, users: { some: { userId } } },
        permission: { resource: 'dashboards', action: 'view' },
      },
      select: { scope: true, scopeValues: true },
    });
    if (grants.some((g) => g.scope === 'all')) return null;
    return [...new Set(grants.filter((g) => g.scope === 'level').flatMap((g) => g.scopeValues))];
  }

  /** All roles with their permission grants, for the admin UI. */
  listRoles() {
    return this.prisma.role
      .findMany({
        orderBy: { name: 'asc' },
        include: {
          permissions: { include: { permission: true } },
          _count: { select: { users: true } },
        },
      })
      .then((roles) =>
        roles.map((role) => ({
          id: role.id,
          name: role.name,
          description: role.description,
          isSystem: role.isSystem,
          isActive: role.isActive,
          memberCount: role._count.users,
          permissions: role.permissions.map(({ permission, scope, scopeValues }) => ({
            resource: permission.resource,
            action: permission.action,
            scope,
            scopeValues,
          })),
        })),
      );
  }

  /** Admin: create a custom role with an arbitrary permission composition. */
  async createRole(input: CreateRoleInput, actorId: string) {
    const existing = await this.prisma.role.findUnique({ where: { name: input.name } });
    if (existing) throw new AppError('CONFLICT', `Role "${input.name}" already exists`);

    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: { name: input.name, description: input.description },
      });

      for (const grant of input.permissions) {
        // Permission catalog rows are upserted so new resources need no migration.
        const permission = await tx.permission.upsert({
          where: { resource_action: { resource: grant.resource, action: grant.action } },
          create: { resource: grant.resource, action: grant.action },
          update: {},
        });
        await tx.rolePermission.create({
          data: { roleId: role.id, permissionId: permission.id, scope: grant.scope, scopeValues: grant.scopeValues },
        });
      }

      await tx.auditLog.create({
        data: { actorId, action: 'role.created', entity: 'Role', entityId: role.id, detail: input },
      });
      return role;
    });
  }

  /** Admin: replace a role's permission set. Invalidates every member's cache. */
  async updateRolePermissions(roleId: string, input: CreateRoleInput['permissions'], actorId: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw AppError.notFound('Role', roleId);
    if (role.isSystem) throw AppError.forbidden('System roles cannot be modified');

    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      for (const grant of input) {
        const permission = await tx.permission.upsert({
          where: { resource_action: { resource: grant.resource, action: grant.action } },
          create: { resource: grant.resource, action: grant.action },
          update: {},
        });
        await tx.rolePermission.create({
          data: { roleId, permissionId: permission.id, scope: grant.scope, scopeValues: grant.scopeValues },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'role.permissions.updated',
          entity: 'Role',
          entityId: roleId,
          detail: { permissions: input },
        },
      });
    });

    await this.invalidateRoleMembers(roleId);
  }

  /** Admin: rename/re-describe a role. System roles are protected. Status
   *  (isActive) is a separate action — see setRoleStatus — gated by its own
   *  roles:activate_deactivate permission instead of bundled with editing. */
  async updateRole(roleId: string, input: UpdateRoleInput, actorId: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw AppError.notFound('Role', roleId);
    if (role.isSystem) throw AppError.forbidden('System roles cannot be modified');

    if (input.name && input.name !== role.name) {
      const clash = await this.prisma.role.findUnique({ where: { name: input.name } });
      if (clash) throw new AppError('CONFLICT', `Role "${input.name}" already exists`);
    }

    const updated = await this.prisma.role.update({
      where: { id: roleId },
      data: { name: input.name, description: input.description },
    });

    await this.prisma.auditLog.create({
      data: { actorId, action: 'role.updated', entity: 'Role', entityId: roleId, detail: input },
    });

    return updated;
  }

  /** Admin: activate/deactivate a role — deactivating stops it granting
   *  permissions to its members without deleting it. System roles are protected. */
  async setRoleStatus(roleId: string, input: SetRoleStatusInput, actorId: string) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw AppError.notFound('Role', roleId);
    if (role.isSystem) throw AppError.forbidden('System roles cannot be modified');

    const updated = await this.prisma.role.update({ where: { id: roleId }, data: { isActive: input.isActive } });

    await this.prisma.auditLog.create({
      data: { actorId, action: 'role.status_changed', entity: 'Role', entityId: roleId, detail: input },
    });

    await this.invalidateRoleMembers(roleId);
    return updated;
  }

  /** Admin: permanently remove a role. Blocked for system roles and roles with
   *  members — deactivate a role with members instead so no one's access
   *  silently changes without an explicit reassignment. */
  async deleteRole(roleId: string, actorId: string) {
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw AppError.notFound('Role', roleId);
    if (role.isSystem) throw AppError.forbidden('System roles cannot be deleted');
    if (role._count.users > 0) {
      throw new AppError(
        'CONFLICT',
        `"${role.name}" has ${role._count.users} member(s) — deactivate it instead, or remove its members first`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId } }),
      this.prisma.role.delete({ where: { id: roleId } }),
      this.prisma.auditLog.create({
        data: { actorId, action: 'role.deleted', entity: 'Role', entityId: roleId, detail: { name: role.name } },
      }),
    ]);
  }

  async assignRoleToUser(userId: string, roleId: string, actorId: string) {
    await this.prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId } },
      create: { userId, roleId },
      update: {},
    });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'role.assigned', entity: 'User', entityId: userId, detail: { roleId } },
    });
    await this.redis.del(cacheKey(userId));
  }

  async unassignRoleFromUser(userId: string, roleId: string, actorId: string) {
    await this.prisma.userRole.deleteMany({ where: { userId, roleId } });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'role.unassigned', entity: 'User', entityId: userId, detail: { roleId } },
    });
    await this.redis.del(cacheKey(userId));
  }

  private async invalidateRoleMembers(roleId: string): Promise<void> {
    const members = await this.prisma.userRole.findMany({ where: { roleId }, select: { userId: true } });
    await Promise.all(members.map(({ userId }) => this.redis.del(cacheKey(userId))));
  }
}
