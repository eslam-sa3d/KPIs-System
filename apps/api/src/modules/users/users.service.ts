import { Injectable } from '@nestjs/common';
import {
  CreateDepartmentInput,
  CreateUserInput,
  PAGE_DEFAULTS,
  PageQuery,
  UpdateDepartmentInput,
  buildPaginationMeta,
} from '@pulse/contracts';
import { AppError } from '../../common/app-error';
import { paged } from '../../common/envelope.interceptor';
import { PrismaService } from '../../infra/prisma.service';
import { PasswordHasher } from '../auth/password-hasher';
import { RedisService } from '../../infra/redis.service';

/** Directory management: users and departments (roles live in the rbac module). */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly redis: RedisService,
  ) {}

  /** `isActive` narrows to active-only/inactive-only when passed — e.g. the KPI-scoring
   *  person-field picker asks for active users only, so deactivated accounts drop out
   *  of its search options; omitted, every user comes back (the admin directory view). */
  async list(query: PageQuery, isActive?: boolean) {
    const page = Math.max(Number(query.page ?? PAGE_DEFAULTS.page), 1);
    const pageSize = Math.min(
      Number(query.pageSize ?? PAGE_DEFAULTS.pageSize),
      PAGE_DEFAULTS.maxPageSize,
    );
    const where = isActive === undefined ? {} : { isActive };

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
          createdAt: true,
          department: { select: { id: true, name: true } },
          roles: { select: { role: { select: { id: true, name: true } } } },
        },
      }),
    ]);

    const items = users.map((u) => ({ ...u, roles: u.roles.map(({ role }) => role) }));
    return paged(items, buildPaginationMeta(page, pageSize, totalItems));
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
          // the password an admin types here is a temporary one by convention
          // (see the "temporary password" label in the create-user form) —
          // force a change-password prompt the first time this account logs in
          mustChangePassword: true,
          departmentId: input.departmentId,
          roles: { create: input.roleIds.map((roleId) => ({ roleId })) },
        },
        select: { id: true, email: true, displayName: true, isActive: true },
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
}
