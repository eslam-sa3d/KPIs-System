import { Injectable } from '@nestjs/common';
import {
  CreateEvaluationAreaInput,
  CreateKpiInput,
  KpiAssignmentInput,
  PAGE_DEFAULTS,
  PageQuery,
  RecordEvaluationAreaEntryInput,
  UpdateEvaluationAreaEntryInput,
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

  async createKpi(input: CreateKpiInput, actorId: string) {
    const kpi = await this.prisma.kpi.create({ data: input });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'kpi.created', entity: 'Kpi', entityId: kpi.id, detail: input },
    });
    return kpi;
  }

  async updateKpi(id: string, input: UpdateKpiInput, actorId: string) {
    const kpi = await this.prisma.kpi.findUnique({ where: { id } });
    if (!kpi) throw AppError.notFound('KPI', id);
    const updated = await this.prisma.kpi.update({ where: { id }, data: input });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'kpi.updated', entity: 'Kpi', entityId: id, detail: input },
    });
    return updated;
  }

  /** Hard delete — cascades to its Evaluation Areas, their entries, and
   *  assignments. Blocked once any entry has ever been recorded under it, so
   *  scored history can't be silently destroyed — deactivate instead. */
  async deleteKpi(id: string, actorId: string) {
    const kpi = await this.prisma.kpi.findUnique({
      where: { id },
      include: { evaluationAreas: { include: { _count: { select: { entries: true } } } } },
    });
    if (!kpi) throw AppError.notFound('KPI', id);

    const entryCount = kpi.evaluationAreas.reduce((sum, area) => sum + area._count.entries, 0);
    if (entryCount > 0) {
      throw new AppError(
        'CONFLICT',
        `"${kpi.name}" has ${entryCount} recorded score(s) across its evaluation areas — deactivate it instead`,
      );
    }

    await this.prisma.kpi.delete({ where: { id } });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'kpi.deleted', entity: 'Kpi', entityId: id, detail: { name: kpi.name } },
    });
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

  async createEvaluationArea(kpiId: string, input: CreateEvaluationAreaInput, actorId: string) {
    const kpi = await this.prisma.kpi.findUnique({ where: { id: kpiId } });
    if (!kpi) throw AppError.notFound('KPI', kpiId);
    const area = await this.prisma.evaluationArea.create({ data: { kpiId, ...input } });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'evaluation_area.created', entity: 'EvaluationArea', entityId: area.id, detail: input },
    });
    return area;
  }

  async updateEvaluationArea(
    kpiId: string,
    areaId: string,
    input: UpdateEvaluationAreaInput,
    actorId: string,
  ) {
    const area = await this.prisma.evaluationArea.findFirst({ where: { id: areaId, kpiId } });
    if (!area) throw AppError.notFound('Evaluation area', areaId);
    const updated = await this.prisma.evaluationArea.update({ where: { id: areaId }, data: input });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'evaluation_area.updated', entity: 'EvaluationArea', entityId: areaId, detail: input },
    });
    return updated;
  }

  /** Hard delete — cascades to its entries. Blocked once it has any recorded
   *  entries, for the same reason as deleteKpi — deactivate instead. */
  async deleteEvaluationArea(kpiId: string, areaId: string, actorId: string) {
    const area = await this.prisma.evaluationArea.findFirst({
      where: { id: areaId, kpiId },
      include: { _count: { select: { entries: true } } },
    });
    if (!area) throw AppError.notFound('Evaluation area', areaId);
    if (area._count.entries > 0) {
      throw new AppError(
        'CONFLICT',
        `"${area.name}" has ${area._count.entries} recorded score(s) — deactivate it instead`,
      );
    }

    await this.prisma.evaluationArea.delete({ where: { id: areaId } });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'evaluation_area.deleted',
        entity: 'EvaluationArea',
        entityId: areaId,
        detail: { name: area.name },
      },
    });
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

    const entry = await this.prisma.evaluationAreaEntry.create({
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

    await this.prisma.auditLog.create({
      data: {
        actorId: enteredById,
        action: 'evaluation_area_entry.recorded',
        entity: 'EvaluationAreaEntry',
        entityId: entry.id,
        detail: { areaId, personId: input.personId, value: input.value },
      },
    });
    return entry;
  }

  /** Fix a mis-entered score without touching who it's for or which period —
   *  those are the entry's identity; re-record instead if either is wrong. */
  async updateEntry(
    kpiId: string,
    areaId: string,
    entryId: string,
    input: UpdateEvaluationAreaEntryInput,
    actorId: string,
  ) {
    const entry = await this.prisma.evaluationAreaEntry.findFirst({
      where: { id: entryId, evaluationAreaId: areaId, evaluationArea: { kpiId } },
    });
    if (!entry) throw AppError.notFound('Evaluation area entry', entryId);

    const updated = await this.prisma.evaluationAreaEntry.update({
      where: { id: entryId },
      data: input,
    });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'evaluation_area_entry.updated',
        entity: 'EvaluationAreaEntry',
        entityId: entryId,
        detail: input,
      },
    });
    return updated;
  }

  async deleteEntry(kpiId: string, areaId: string, entryId: string, actorId: string) {
    const entry = await this.prisma.evaluationAreaEntry.findFirst({
      where: { id: entryId, evaluationAreaId: areaId, evaluationArea: { kpiId } },
    });
    if (!entry) throw AppError.notFound('Evaluation area entry', entryId);

    await this.prisma.evaluationAreaEntry.delete({ where: { id: entryId } });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'evaluation_area_entry.deleted',
        entity: 'EvaluationAreaEntry',
        entityId: entryId,
        detail: { personId: entry.personId, value: entry.value.toString() },
      },
    });
    return null;
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
