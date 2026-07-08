import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CreateKpiInput,
  KpiAssignmentInput,
  PAGE_DEFAULTS,
  PageQuery,
  RecordKpiEntryInput,
  buildPaginationMeta,
} from '@pulse/contracts';
import { AppError } from '../../common/app-error';
import { paged } from '../../common/envelope.interceptor';
import { PrismaService } from '../../infra/prisma.service';

/**
 * KPI definitions, dynamic role/department/stream mappings, and the entry
 * (fact) ingestion behind dashboards.
 */
@Injectable()
export class KpisService {
  constructor(private readonly prisma: PrismaService) {}

  async createKpi(input: CreateKpiInput) {
    const existing = await this.prisma.kpi.findUnique({ where: { code: input.code } });
    if (existing) throw new AppError('CONFLICT', `KPI code "${input.code}" already exists`);
    return this.prisma.kpi.create({
      // Zod guarantees metadata is plain JSON; Prisma's input type can't infer that.
      data: { ...input, metadata: input.metadata as Prisma.InputJsonValue | undefined },
    });
  }

  async list(query: PageQuery) {
    const page = Math.max(Number(query.page ?? PAGE_DEFAULTS.page), 1);
    const pageSize = Math.min(
      Number(query.pageSize ?? PAGE_DEFAULTS.pageSize),
      PAGE_DEFAULTS.maxPageSize,
    );

    const where = { isActive: true };
    const [totalItems, items] = await this.prisma.$transaction([
      this.prisma.kpi.count({ where }),
      this.prisma.kpi.findMany({
        where,
        orderBy: { code: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { assignments: true },
      }),
    ]);
    return paged(items, buildPaginationMeta(page, pageSize, totalItems));
  }

  /** Map a KPI to a role, department and/or delivery stream (idempotent). */
  async assign(kpiId: string, input: KpiAssignmentInput, actorId: string) {
    const kpi = await this.prisma.kpi.findUnique({ where: { id: kpiId } });
    if (!kpi) throw AppError.notFound('KPI', kpiId);

    // findFirst-then-create (not upsert): Postgres treats NULLs in the compound
    // unique as distinct, so idempotency must be checked with null-aware matching.
    const existing = await this.prisma.kpiAssignment.findFirst({
      where: {
        kpiId,
        roleId: input.roleId ?? null,
        departmentId: input.departmentId ?? null,
        deliveryStream: input.deliveryStream ?? null,
      },
    });
    if (existing) return existing;

    const assignment = await this.prisma.kpiAssignment.create({ data: { kpiId, ...input } });

    await this.prisma.auditLog.create({
      data: { actorId, action: 'kpi.assigned', entity: 'Kpi', entityId: kpiId, detail: input },
    });
    return assignment;
  }

  /**
   * The KPIs relevant to the caller: assigned to any of their roles OR their
   * department. Scope is derived server-side from the user record — the
   * client cannot widen it.
   */
  async listMine(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { departmentId: true, roles: { select: { roleId: true } } },
    });
    if (!user) throw AppError.notFound('User', userId);

    const roleIds = user.roles.map((r) => r.roleId);
    const scope: object[] = [{ roleId: { in: roleIds } }];
    if (user.departmentId) scope.push({ departmentId: user.departmentId });

    return this.prisma.kpi.findMany({
      where: { isActive: true, assignments: { some: { OR: scope } } },
      orderBy: { code: 'asc' },
      include: {
        entries: { orderBy: { periodStart: 'desc' }, take: 12 }, // last 12 periods for sparklines
      },
    });
  }

  async recordEntry(kpiId: string, input: RecordKpiEntryInput, enteredById: string) {
    const kpi = await this.prisma.kpi.findUnique({ where: { id: kpiId } });
    if (!kpi) throw AppError.notFound('KPI', kpiId);
    if (!kpi.isActive) {
      throw new AppError('CONFLICT', `KPI "${kpi.code}" is inactive and no longer accepts entries`);
    }

    const periodStart = new Date(input.periodStart);
    const periodEnd = new Date(input.periodEnd);

    const duplicate = await this.prisma.kpiEntry.findUnique({
      where: { kpiId_periodStart_periodEnd: { kpiId, periodStart, periodEnd } },
    });
    if (duplicate) {
      throw new AppError(
        'CONFLICT',
        `An entry for ${kpi.code} already exists for ${input.periodStart} → ${input.periodEnd}`,
      );
    }

    return this.prisma.kpiEntry.create({
      data: { kpiId, value: input.value, periodStart, periodEnd, enteredById, note: input.note },
    });
  }

  /** Time series for charts: entries in range plus target/direction context. */
  async getSeries(kpiId: string, from?: string, to?: string) {
    const kpi = await this.prisma.kpi.findUnique({ where: { id: kpiId } });
    if (!kpi) throw AppError.notFound('KPI', kpiId);

    const entries = await this.prisma.kpiEntry.findMany({
      where: {
        kpiId,
        ...(from ? { periodStart: { gte: new Date(from) } } : {}),
        ...(to ? { periodEnd: { lte: new Date(to) } } : {}),
      },
      orderBy: { periodStart: 'asc' },
      select: { value: true, periodStart: true, periodEnd: true, note: true },
    });

    return {
      kpi: {
        id: kpi.id,
        code: kpi.code,
        name: kpi.name,
        unit: kpi.unit,
        direction: kpi.direction,
        target: kpi.target,
        cadence: kpi.cadence,
      },
      entries,
    };
  }
}
