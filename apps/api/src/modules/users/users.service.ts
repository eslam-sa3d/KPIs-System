import { Injectable } from '@nestjs/common';
import {
  CreateDepartmentInput,
  CreateProjectGroupInput,
  CreateUserInput,
  PageQuery,
  UpdateDepartmentInput,
  UpdateProjectGroupInput,
  UpdateUserInput,
  buildPaginationMeta,
  resolvePageBounds,
} from '@pulse/contracts';
import { AppError } from '../../common/app-error';
import { paged } from '../../common/envelope.interceptor';
import { PrismaService } from '../../infra/prisma.service';
import { PasswordHasher } from '../auth/password-hasher';
import { RedisService } from '../../infra/redis.service';
import { RbacService } from '../rbac/rbac.service';

/** Directory management: users and departments (roles live in the rbac module). */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly redis: RedisService,
    private readonly rbac: RbacService,
  ) {}

  /** `userId` is the caller, not a filter target — a `users:view` grant scoped
   *  to department and/or project_group (see RbacService.userViewScopeKinds)
   *  restricts the roster to the union of whichever the caller's roles grant,
   *  the same way KpisService.list() restricts KPIs to the caller's own
   *  assignments. Returns null when unrestricted (an 'all'-scoped grant), so
   *  callers can fall back to their own optional filters in that case. */
  private async scopeFilter(userId: string): Promise<Record<string, unknown> | null> {
    const kinds = await this.rbac.userViewScopeKinds(userId);
    if (kinds === 'all') return null;
    // A restricted caller with none of the granted dimensions set sees no
    // one — `departmentId: null` would otherwise match every other
    // departmentless user, which is the opposite of "restricted".
    const conditions: object[] = [];
    if (kinds.includes('department')) {
      conditions.push({ departmentId: (await this.rbac.myDepartmentId(userId)) ?? '__none__' });
    }
    if (kinds.includes('project_group')) {
      // An empty groupIds array already matches zero rows via `IN ()`, so no
      // '__none__' sentinel is needed here the way the single-FK department
      // filter above needs one.
      conditions.push({
        projectGroupMemberships: { some: { groupId: { in: await this.rbac.myProjectGroupIds(userId) } } },
      });
    }
    if (kinds.includes('own')) conditions.push({ id: userId });
    return conditions.length > 0 ? { OR: conditions } : { id: '__none__' };
  }

  async list(query: PageQuery & { search?: string; departmentId?: string }, userId: string) {
    const { page, pageSize } = resolvePageBounds(query);

    const scoped = await this.scopeFilter(userId);
    const search = query.search?.trim();
    // AND'd as separate clauses, not spread — scoped's own OR (department/
    // project_group/own) and search's OR (name/email) would otherwise collide
    // on the same object key and silently drop one of the two filters.
    const where = {
      AND: [
        scoped ?? (query.departmentId ? { departmentId: query.departmentId } : {}),
        search
          ? {
              OR: [
                { displayName: { contains: search, mode: 'insensitive' as const } },
                { email: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {},
      ],
    };

    const [totalItems, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          email: true,
          displayName: true,
          isActive: true,
          isKpiApplicable: true,
          createdAt: true,
          department: { select: { id: true, name: true } },
          roles: { select: { role: { select: { id: true, name: true } } } },
        },
      }),
    ]);

    const items = users.map((u) => ({ ...u, roles: u.roles.map(({ role }) => role) }));
    return paged(items, buildPaginationMeta(page, pageSize, totalItems));
  }

  /** Headline counts for the users page's stat widgets — same view-scope
   *  restriction as list(), but an unfiltered aggregate rather than a page. */
  async stats(userId: string) {
    const where = (await this.scopeFilter(userId)) ?? {};

    const [total, active, assignedToDepartment, departments] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.count({ where: { ...where, isActive: true } }),
      this.prisma.user.count({ where: { ...where, departmentId: { not: null } } }),
      this.prisma.department.count(),
    ]);

    return { total, active, inactive: total - active, departments, assignedToDepartment };
  }

  async create(input: CreateUserInput, actorId: string) {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new AppError('CONFLICT', `A user with email "${input.email}" already exists`);

    const passwordHash = await this.hasher.hash(input.password);
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          displayName: input.displayName,
          passwordHash,
          departmentId: input.departmentId,
          isKpiApplicable: input.isKpiApplicable,
          // the password an admin sets here is the "temporary password" the
          // create-user form labels it — force a change on first login
          mustChangePassword: true,
          roles: { create: input.roleIds.map((roleId) => ({ roleId })) },
        },
        select: { id: true, email: true, displayName: true, isActive: true, isKpiApplicable: true },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'user.created',
          entity: 'User',
          entityId: created.id,
          detail: { email: input.email, roleIds: input.roleIds },
        },
      });
      return created;
    });
    return user;
  }

  async update(userId: string, input: UpdateUserInput, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppError.notFound('User', userId);

    if (input.email && input.email !== user.email) {
      const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
      if (existing) throw new AppError('CONFLICT', `A user with email "${input.email}" already exists`);
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
        ...(input.isKpiApplicable !== undefined ? { isKpiApplicable: input.isKpiApplicable } : {}),
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        isActive: true,
        isKpiApplicable: true,
        department: { select: { id: true, name: true } },
      },
    });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'user.updated', entity: 'User', entityId: userId, detail: input },
    });
    return updated;
  }

  /** Deactivation kills access immediately: permission cache is invalidated and
   *  live sessions are revoked, so neither JWT refresh nor RBAC resolution survives. */
  async setStatus(userId: string, isActive: boolean, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw AppError.notFound('User', userId);
    if (userId === actorId && !isActive) {
      throw new AppError('CONFLICT', 'You cannot deactivate your own account');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { isActive } }),
      ...(isActive
        ? []
        : [
            this.prisma.session.updateMany({
              where: { userId, revokedAt: null },
              data: { revokedAt: new Date() },
            }),
          ]),
      this.prisma.auditLog.create({
        data: {
          actorId,
          action: isActive ? 'user.activated' : 'user.deactivated',
          entity: 'User',
          entityId: userId,
        },
      }),
    ]);
    await this.redis.del(`rbac:perms:${userId}`);
    return { id: userId, isActive };
  }

  listDepartments() {
    return this.prisma.department.findMany({ orderBy: { name: 'asc' } });
  }

  async createDepartment(input: CreateDepartmentInput, actorId: string) {
    const existing = await this.prisma.department.findUnique({ where: { name: input.name } });
    if (existing) throw new AppError('CONFLICT', `Department "${input.name}" already exists`);
    const department = await this.prisma.department.create({ data: input });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'department.created', entity: 'Department', entityId: department.id },
    });
    return department;
  }

  async renameDepartment(departmentId: string, input: UpdateDepartmentInput, actorId: string) {
    const department = await this.prisma.department.findUnique({ where: { id: departmentId } });
    if (!department) throw AppError.notFound('Department', departmentId);
    const existing = await this.prisma.department.findUnique({ where: { name: input.name } });
    if (existing && existing.id !== departmentId) {
      throw new AppError('CONFLICT', `Department "${input.name}" already exists`);
    }
    const updated = await this.prisma.department.update({
      where: { id: departmentId },
      data: { name: input.name },
    });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'department.renamed', entity: 'Department', entityId: departmentId },
    });
    return updated;
  }

  /** Blocked while any user is still assigned — same "fix it first" pattern as
   *  KPI deletion, rather than silently orphaning people's department. KPI
   *  visibility assignments pointing at this department cascade-delete at the
   *  DB level (KpiAssignment.department is onDelete: Cascade), which is safe
   *  to do silently since it's just a "who sees this KPI" mapping, not data. */
  async deleteDepartment(departmentId: string, actorId: string) {
    const department = await this.prisma.department.findUnique({ where: { id: departmentId } });
    if (!department) throw AppError.notFound('Department', departmentId);
    const memberCount = await this.prisma.user.count({ where: { departmentId } });
    if (memberCount > 0) {
      throw new AppError(
        'CONFLICT',
        `"${department.name}" still has ${memberCount} member${memberCount === 1 ? '' : 's'} — move them to another department first`,
      );
    }
    await this.prisma.department.delete({ where: { id: departmentId } });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'department.deleted', entity: 'Department', entityId: departmentId },
    });
    return null;
  }

  listProjectGroups() {
    return this.prisma.projectGroup.findMany({ orderBy: { name: 'asc' } });
  }

  async createProjectGroup(input: CreateProjectGroupInput, actorId: string) {
    const existing = await this.prisma.projectGroup.findUnique({ where: { name: input.name } });
    if (existing) throw new AppError('CONFLICT', `Project group "${input.name}" already exists`);
    const group = await this.prisma.projectGroup.create({ data: input });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'project_group.created', entity: 'ProjectGroup', entityId: group.id },
    });
    return group;
  }

  async renameProjectGroup(groupId: string, input: UpdateProjectGroupInput, actorId: string) {
    const group = await this.prisma.projectGroup.findUnique({ where: { id: groupId } });
    if (!group) throw AppError.notFound('ProjectGroup', groupId);
    const existing = await this.prisma.projectGroup.findUnique({ where: { name: input.name } });
    if (existing && existing.id !== groupId) {
      throw new AppError('CONFLICT', `Project group "${input.name}" already exists`);
    }
    const updated = await this.prisma.projectGroup.update({
      where: { id: groupId },
      data: { name: input.name },
    });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'project_group.renamed', entity: 'ProjectGroup', entityId: groupId },
    });
    return updated;
  }

  /** Same "fix it first" pattern as deleteDepartment — blocked while any user
   *  is still assigned, rather than silently orphaning their project group. */
  async deleteProjectGroup(groupId: string, actorId: string) {
    const group = await this.prisma.projectGroup.findUnique({ where: { id: groupId } });
    if (!group) throw AppError.notFound('ProjectGroup', groupId);
    const memberCount = await this.prisma.projectGroupMember.count({ where: { groupId } });
    if (memberCount > 0) {
      throw new AppError(
        'CONFLICT',
        `"${group.name}" still has ${memberCount} member${memberCount === 1 ? '' : 's'} — remove them first`,
      );
    }
    await this.prisma.projectGroup.delete({ where: { id: groupId } });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'project_group.deleted', entity: 'ProjectGroup', entityId: groupId },
    });
    return null;
  }

  async listProjectGroupMembers(groupId: string) {
    const group = await this.prisma.projectGroup.findUnique({ where: { id: groupId } });
    if (!group) throw AppError.notFound('ProjectGroup', groupId);
    const members = await this.prisma.projectGroupMember.findMany({
      where: { groupId },
      orderBy: { user: { displayName: 'asc' } },
      select: { user: { select: { id: true, email: true, displayName: true } } },
    });
    return members.map(({ user }) => user);
  }

  /** Adds every listed user to the group (idempotent — re-adding a current
   *  member is a no-op) and writes one audit entry per user, same
   *  per-assignment granularity as RbacService.assignRoleToUser. */
  async addProjectGroupMembers(groupId: string, userIds: string[], actorId: string) {
    const group = await this.prisma.projectGroup.findUnique({ where: { id: groupId } });
    if (!group) throw AppError.notFound('ProjectGroup', groupId);

    const existingUsers = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true },
    });
    const missing = userIds.filter((id) => !existingUsers.some((u) => u.id === id));
    if (missing.length > 0) {
      throw new AppError('VALIDATION_ERROR', `Unknown user id(s): ${missing.join(', ')}`);
    }

    await this.prisma.$transaction([
      this.prisma.projectGroupMember.createMany({
        data: userIds.map((userId) => ({ userId, groupId })),
        skipDuplicates: true,
      }),
      ...userIds.map((userId) =>
        this.prisma.auditLog.create({
          data: {
            actorId,
            action: 'project_group.member_added',
            entity: 'User',
            entityId: userId,
            detail: { groupId },
          },
        }),
      ),
    ]);
    return this.listProjectGroupMembers(groupId);
  }

  /** Idempotent no-op if the user isn't currently a member — same shape as
   *  AuthService.logout's "unknown token is a no-op" pattern. */
  async removeProjectGroupMember(groupId: string, userId: string, actorId: string) {
    const group = await this.prisma.projectGroup.findUnique({ where: { id: groupId } });
    if (!group) throw AppError.notFound('ProjectGroup', groupId);

    await this.prisma.$transaction([
      this.prisma.projectGroupMember.deleteMany({ where: { groupId, userId } }),
      this.prisma.auditLog.create({
        data: {
          actorId,
          action: 'project_group.member_removed',
          entity: 'User',
          entityId: userId,
          detail: { groupId },
        },
      }),
    ]);
    return null;
  }
}
