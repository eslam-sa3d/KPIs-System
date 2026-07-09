import { Injectable } from '@nestjs/common';
import { CreateRoleInput, PermissionKey, UpdateRoleInput } from '@pulse/contracts';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../infra/prisma.service';
import { RedisService } from '../../infra/redis.service';

const PERMISSION_CACHE_TTL_SECONDS = 300;
const cacheKey = (userId: string) => `rbac:perms:${userId}`;

/**
 * Dynamic RBAC: roles and their permission sets are data, composed by admins
 * at runtime. This service is the single authority on "what can user X do".
 */
@Injectable()
export class RbacService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Resolve a user's effective permission set (union across roles), cached. */
  async getEffectivePermissions(userId: string): Promise<Set<PermissionKey>> {
    const cached = await this.redis.get(cacheKey(userId));
    if (cached) return new Set(JSON.parse(cached) as PermissionKey[]);

    const roles = await this.prisma.userRole.findMany({
      where: { userId, user: { isActive: true }, role: { isActive: true } },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });

    const permissions = new Set<PermissionKey>(
      roles.flatMap(({ role }) =>
        role.permissions.map(
          ({ permission }) => `${permission.resource}:${permission.action}` as PermissionKey,
        ),
      ),
    );

    await this.redis.set(
      cacheKey(userId),
      JSON.stringify([...permissions]),
      PERMISSION_CACHE_TTL_SECONDS,
    );
    return permissions;
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
          permissions: role.permissions.map(({ permission, scope }) => ({
            resource: permission.resource,
            action: permission.action,
            scope,
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
          data: { roleId: role.id, permissionId: permission.id, scope: grant.scope },
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
          data: { roleId, permissionId: permission.id, scope: grant.scope },
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

  /** Admin: rename/re-describe a role, or deactivate/reactivate it. System roles are protected. */
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
      data: { name: input.name, description: input.description, isActive: input.isActive },
    });

    await this.prisma.auditLog.create({
      data: { actorId, action: 'role.updated', entity: 'Role', entityId: roleId, detail: input },
    });

    if (input.isActive !== undefined) await this.invalidateRoleMembers(roleId);
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
