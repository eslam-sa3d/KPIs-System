import { Injectable } from '@nestjs/common';
import {
  CreateEvaluationAreaInput,
  CreateKpiInput,
  CreateSubCriteriaInput,
  DashboardFormScope,
  DashboardFormScopeInput,
  KpiAssignmentInput,
  PageQuery,
  RecordEvaluationAreaEntryInput,
  SetEvaluationAreaStatusInput,
  SetKpiStatusInput,
  UpdateEvaluationAreaEntryInput,
  UpdateEvaluationAreaInput,
  UpdateKpiInput,
  UpdateSubCriteriaInput,
  buildPaginationMeta,
  resolvePageBounds,
} from '@pulse/contracts';
import { AppError } from '../../common/app-error';
import { paged } from '../../common/envelope.interceptor';
import { PrismaService } from '../../infra/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { myAssignmentFilter, serializeKpi } from './kpi-scope';

/**
 * KPI/EvaluationArea/SubCriteria admin CRUD, role/department assignments, the
 * dashboard-form-scope setting, and the legacy direct (non-forms) entry
 * recording API. The dashboard's own read/aggregation side (my dashboard,
 * team overview, person breakdown, measurement gaps, recent feedback,
 * activity trend) lives in KpiDashboardService instead — a KPI carries no
 * score itself; each Evaluation Area under it is scored 0-5 per evaluatee per
 * period, see EvaluationAreaEntry.
 */
@Injectable()
export class KpisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

  async createKpi(input: CreateKpiInput, actorId: string) {
    const kpi = await this.prisma.kpi.create({ data: input });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'kpi.created', entity: 'Kpi', entityId: kpi.id, detail: input },
    });
    return serializeKpi(kpi);
  }

  async updateKpi(id: string, input: UpdateKpiInput, actorId: string) {
    const kpi = await this.prisma.kpi.findUnique({ where: { id } });
    if (!kpi) throw AppError.notFound('KPI', id);
    const updated = await this.prisma.kpi.update({ where: { id }, data: input });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'kpi.updated', entity: 'Kpi', entityId: id, detail: input },
    });
    return serializeKpi(updated);
  }

  /** Separate from updateKpi so activating/deactivating is its own permission
   *  (kpis:activate_deactivate) instead of bundled with editing. */
  async setKpiStatus(id: string, input: SetKpiStatusInput, actorId: string) {
    const kpi = await this.prisma.kpi.findUnique({ where: { id } });
    if (!kpi) throw AppError.notFound('KPI', id);
    const updated = await this.prisma.kpi.update({ where: { id }, data: { isActive: input.isActive } });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'kpi.status_changed', entity: 'Kpi', entityId: id, detail: input },
    });
    return serializeKpi(updated);
  }

  /** Hard delete — cascades to its Evaluation Areas, their entries, and
   *  assignments. Blocked once any entry has ever been recorded under it, so
   *  scored history can't be silently destroyed — deactivate instead, or
   *  pass force to delete it (and that history) anyway. Both paths require
   *  kpis:delete; force-deletes are audit-logged distinctly, with the
   *  destroyed entry count, since there's no undoing this one. */
  async deleteKpi(id: string, actorId: string, force = false) {
    const kpi = await this.prisma.kpi.findUnique({
      where: { id },
      include: { evaluationAreas: { include: { _count: { select: { entries: true } } } } },
    });
    if (!kpi) throw AppError.notFound('KPI', id);

    const entryCount = kpi.evaluationAreas.reduce((sum, area) => sum + area._count.entries, 0);
    if (entryCount > 0 && !force) {
      throw new AppError(
        'CONFLICT',
        `"${kpi.name}" has ${entryCount} recorded score(s) across its evaluation areas — deactivate it instead, or force delete to permanently destroy this history too`,
      );
    }

    await this.prisma.kpi.delete({ where: { id } });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: entryCount > 0 ? 'kpi.force_deleted' : 'kpi.deleted',
        entity: 'Kpi',
        entityId: id,
        detail: { name: kpi.name, ...(entryCount > 0 ? { destroyedEntryCount: entryCount } : {}) },
      },
    });
    return null;
  }

  async list(query: PageQuery, userId: string) {
    const { page, pageSize } = resolvePageBounds(query);

    // Unlike KpiDashboardService.listMine() (the respondent-facing dashboard,
    // which should only ever show active KPIs), this powers the admin
    // management page — the one place a deactivated KPI or Evaluation Area
    // needs to still be visible, or its own "reactivate" action would be
    // unreachable.
    const restricted = await this.rbac.isViewScopeRestricted(userId, 'kpis');
    const where = { ...(restricted ? await myAssignmentFilter(this.prisma, userId) : {}) };
    const [totalItems, items] = await this.prisma.$transaction([
      this.prisma.kpi.count({ where }),
      this.prisma.kpi.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          assignments: true,
          evaluationAreas: {
            orderBy: { name: 'asc' },
            include: { subCriteria: { orderBy: { name: 'asc' } } },
          },
        },
      }),
    ]);
    return paged(items.map(serializeKpi), buildPaginationMeta(page, pageSize, totalItems));
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

  async unassign(kpiId: string, assignmentId: string, actorId: string) {
    const assignment = await this.prisma.kpiAssignment.findFirst({ where: { id: assignmentId, kpiId } });
    if (!assignment) throw AppError.notFound('KPI assignment', assignmentId);

    await this.prisma.kpiAssignment.delete({ where: { id: assignmentId } });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'kpi.unassigned', entity: 'Kpi', entityId: kpiId, detail: { assignmentId } },
    });
    return null;
  }

  /** Which forms' submissions currently feed the dashboard — readable by
   *  anyone who can see the dashboard, so the picker can show the active
   *  state even to a viewer who can't change it. */
  async getDashboardFormScope(): Promise<DashboardFormScope> {
    const scope = await this.prisma.dashboardFormScope.findUnique({ where: { id: 1 } });
    return { formIds: scope?.formIds ?? [] };
  }

  /** Empty formIds means "unrestricted" — every form's submissions count
   *  again — rather than "restricted to nothing". */
  async setDashboardFormScope(input: DashboardFormScopeInput, actorId: string): Promise<DashboardFormScope> {
    await this.prisma.dashboardFormScope.upsert({
      where: { id: 1 },
      create: { id: 1, formIds: input.formIds },
      update: { formIds: input.formIds },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'dashboard_form_scope.updated',
        entity: 'DashboardFormScope',
        entityId: '1',
        detail: input,
      },
    });
    return { formIds: input.formIds };
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

  async updateEvaluationArea(kpiId: string, areaId: string, input: UpdateEvaluationAreaInput, actorId: string) {
    const area = await this.prisma.evaluationArea.findFirst({ where: { id: areaId, kpiId } });
    if (!area) throw AppError.notFound('Evaluation area', areaId);
    const updated = await this.prisma.evaluationArea.update({ where: { id: areaId }, data: input });
    await this.prisma.auditLog.create({
      data: { actorId, action: 'evaluation_area.updated', entity: 'EvaluationArea', entityId: areaId, detail: input },
    });
    return updated;
  }

  /** Separate from updateEvaluationArea — see setKpiStatus. */
  async setEvaluationAreaStatus(kpiId: string, areaId: string, input: SetEvaluationAreaStatusInput, actorId: string) {
    const area = await this.prisma.evaluationArea.findFirst({ where: { id: areaId, kpiId } });
    if (!area) throw AppError.notFound('Evaluation area', areaId);
    const updated = await this.prisma.evaluationArea.update({
      where: { id: areaId },
      data: { isActive: input.isActive },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'evaluation_area.status_changed',
        entity: 'EvaluationArea',
        entityId: areaId,
        detail: input,
      },
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

  async createSubCriteria(kpiId: string, areaId: string, input: CreateSubCriteriaInput, actorId: string) {
    const area = await this.prisma.evaluationArea.findFirst({ where: { id: areaId, kpiId } });
    if (!area) throw AppError.notFound('Evaluation area', areaId);

    const subCriteria = await this.prisma.subCriteria.create({
      data: { evaluationAreaId: areaId, ...input },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'sub_criteria.created',
        entity: 'SubCriteria',
        entityId: subCriteria.id,
        detail: input,
      },
    });
    return subCriteria;
  }

  async updateSubCriteria(
    kpiId: string,
    areaId: string,
    subCriteriaId: string,
    input: UpdateSubCriteriaInput,
    actorId: string,
  ) {
    const subCriteria = await this.prisma.subCriteria.findFirst({
      where: { id: subCriteriaId, evaluationAreaId: areaId, evaluationArea: { kpiId } },
    });
    if (!subCriteria) throw AppError.notFound('Sub-criteria', subCriteriaId);

    const updated = await this.prisma.subCriteria.update({ where: { id: subCriteriaId }, data: input });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'sub_criteria.updated',
        entity: 'SubCriteria',
        entityId: subCriteriaId,
        detail: input,
      },
    });
    return updated;
  }

  /** Plain hard delete — unlike deleteKpi/deleteEvaluationArea, there's no
   *  scored history recorded against a Sub-Criteria to protect, so no guard. */
  async deleteSubCriteria(kpiId: string, areaId: string, subCriteriaId: string, actorId: string) {
    const subCriteria = await this.prisma.subCriteria.findFirst({
      where: { id: subCriteriaId, evaluationAreaId: areaId, evaluationArea: { kpiId } },
    });
    if (!subCriteria) throw AppError.notFound('Sub-criteria', subCriteriaId);

    await this.prisma.subCriteria.delete({ where: { id: subCriteriaId } });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'sub_criteria.deleted',
        entity: 'SubCriteria',
        entityId: subCriteriaId,
        detail: { name: subCriteria.name },
      },
    });
    return null;
  }

  async recordEntry(kpiId: string, areaId: string, input: RecordEvaluationAreaEntryInput, enteredById: string) {
    const area = await this.prisma.evaluationArea.findFirst({ where: { id: areaId, kpiId } });
    if (!area) throw AppError.notFound('Evaluation area', areaId);
    if (!area.isActive) {
      throw new AppError('CONFLICT', `Evaluation area "${area.name}" is inactive and no longer accepts entries`);
    }

    const person = await this.prisma.user.findUnique({ where: { id: input.personId } });
    if (!person) throw AppError.notFound('User', input.personId);

    const periodStart = new Date(input.periodStart);
    const periodEnd = new Date(input.periodEnd);

    // Keyed by evaluator too: this only guards against the SAME evaluator
    // double-recording — a different evaluator scoring the same person/area/
    // period is a second, coexisting rater, not a duplicate. mappingId is
    // always null here (this is the direct, non-forms recording path) —
    // explicit in the filter so it matches only other manual entries, not one
    // produced by a form mapping (see EvaluationAreaEntry.mappingId).
    // findFirst, not findUnique: mappingId is nullable, and Prisma's compound
    // WhereUniqueInput type doesn't accept `null` for a nullable key component.
    const duplicate = await this.prisma.evaluationAreaEntry.findFirst({
      where: {
        evaluationAreaId: areaId,
        personId: input.personId,
        periodStart,
        periodEnd,
        enteredById,
        mappingId: null,
      },
    });
    if (duplicate) {
      throw new AppError(
        'CONFLICT',
        `You've already recorded an entry for ${person.displayName} in "${area.name}" for ${input.periodStart} → ${input.periodEnd}`,
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
