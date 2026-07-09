import { Injectable } from '@nestjs/common';
import {
  CreateEvaluationAreaInput,
  CreateKpiInput,
  KpiAssignmentInput,
  PAGE_DEFAULTS,
  PageQuery,
  RecordEvaluationAreaEntryInput,
  UpdateEvaluationAreaInput,
  UpdateKpiInput,
  buildPaginationMeta,
} from '@pulse/contracts';
import { AppError } from '../../common/app-error';
import { paged } from '../../common/envelope.interceptor';
import { PrismaService } from '../../infra/prisma.service';

/** How many recent entries per area feed the dashboard's trend/aggregate views. */
const RECENT_ENTRIES_TAKE = 12;

/**
 * KPI definitions (just a name + Evaluation Areas), dynamic role/department/
 * stream mappings, and the per-person Evaluation Area score ingestion behind
 * dashboards. A KPI carries no score itself — each Evaluation Area under it
 * is scored 0-5 per evaluatee per period; see EvaluationAreaEntry.
 */
@Injectable()
export class KpisService {
  constructor(private readonly prisma: PrismaService) {}

  async createKpi(input: CreateKpiInput) {
    return this.prisma.kpi.create({ data: input });
  }

  async updateKpi(id: string, input: UpdateKpiInput) {
    const kpi = await this.prisma.kpi.findUnique({ where: { id } });
    if (!kpi) throw AppError.notFound('KPI', id);
    return this.prisma.kpi.update({ where: { id }, data: input });
  }

  /** Hard delete — cascades to its Evaluation Areas, their entries, and assignments. */
  async deleteKpi(id: string) {
    const kpi = await this.prisma.kpi.findUnique({ where: { id } });
    if (!kpi) throw AppError.notFound('KPI', id);
    await this.prisma.kpi.delete({ where: { id } });
    return null;
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
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          assignments: true,
          evaluationAreas: { where: { isActive: true }, orderBy: { name: 'asc' } },
        },
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
   * client cannot widen it. Each KPI comes with its Evaluation Areas and
   * each area's most recent entries (with the evaluatee's display name) —
   * enough for the dashboard to compute both a per-KPI aggregate and a
   * per-person breakdown client-side, no extra endpoint needed.
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
      orderBy: { name: 'asc' },
      include: {
        evaluationAreas: {
          where: { isActive: true },
          include: {
            entries: {
              orderBy: { periodStart: 'desc' },
              take: RECENT_ENTRIES_TAKE,
              include: { person: { select: { id: true, displayName: true } } },
            },
          },
        },
      },
    });
  }

  async createEvaluationArea(kpiId: string, input: CreateEvaluationAreaInput) {
    const kpi = await this.prisma.kpi.findUnique({ where: { id: kpiId } });
    if (!kpi) throw AppError.notFound('KPI', kpiId);
    return this.prisma.evaluationArea.create({ data: { kpiId, ...input } });
  }

  async updateEvaluationArea(kpiId: string, areaId: string, input: UpdateEvaluationAreaInput) {
    const area = await this.prisma.evaluationArea.findFirst({ where: { id: areaId, kpiId } });
    if (!area) throw AppError.notFound('Evaluation area', areaId);
    return this.prisma.evaluationArea.update({ where: { id: areaId }, data: input });
  }

  /** Hard delete — cascades to its entries. */
  async deleteEvaluationArea(kpiId: string, areaId: string) {
    const area = await this.prisma.evaluationArea.findFirst({ where: { id: areaId, kpiId } });
    if (!area) throw AppError.notFound('Evaluation area', areaId);
    await this.prisma.evaluationArea.delete({ where: { id: areaId } });
    return null;
  }

  async recordEntry(
    kpiId: string,
    areaId: string,
    input: RecordEvaluationAreaEntryInput,
    enteredById: string,
  ) {
    const area = await this.prisma.evaluationArea.findFirst({ where: { id: areaId, kpiId } });
    if (!area) throw AppError.notFound('Evaluation area', areaId);
    if (!area.isActive) {
      throw new AppError(
        'CONFLICT',
        `Evaluation area "${area.name}" is inactive and no longer accepts entries`,
      );
    }

    const person = await this.prisma.user.findUnique({ where: { id: input.personId } });
    if (!person) throw AppError.notFound('User', input.personId);

    const periodStart = new Date(input.periodStart);
    const periodEnd = new Date(input.periodEnd);

    const duplicate = await this.prisma.evaluationAreaEntry.findUnique({
      where: {
        evaluationAreaId_personId_periodStart_periodEnd: {
          evaluationAreaId: areaId,
          personId: input.personId,
          periodStart,
          periodEnd,
        },
      },
    });
    if (duplicate) {
      throw new AppError(
        'CONFLICT',
        `An entry for ${person.displayName} in "${area.name}" already exists for ${input.periodStart} → ${input.periodEnd}`,
      );
    }

    return this.prisma.evaluationAreaEntry.create({
      data: {
        evaluationAreaId: areaId,
        personId: input.personId,
        value: input.value,
        periodStart,
        periodEnd,
        enteredById,
        note: input.note,
      },
    });
  }

  /** Time series for one Evaluation Area, optionally scoped to a single evaluatee. */
  async getSeries(kpiId: string, areaId: string, personId?: string) {
    const area = await this.prisma.evaluationArea.findFirst({ where: { id: areaId, kpiId } });
    if (!area) throw AppError.notFound('Evaluation area', areaId);

    const entries = await this.prisma.evaluationAreaEntry.findMany({
      where: { evaluationAreaId: areaId, ...(personId ? { personId } : {}) },
      orderBy: { periodStart: 'asc' },
      select: {
        value: true,
        periodStart: true,
        periodEnd: true,
        note: true,
        person: { select: { id: true, displayName: true } },
      },
    });

    return {
      area: { id: area.id, name: area.name, cadence: area.cadence },
      entries,
    };
  }
}
