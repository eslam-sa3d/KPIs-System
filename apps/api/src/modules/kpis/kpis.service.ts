import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CreateEvaluationAreaInput,
  CreateKpiInput,
  CreateSubCriteriaInput,
  KpiAssignmentInput,
  PageQuery,
  RecordEvaluationAreaEntryInput,
  TeamMemberBreakdown,
  TeamMemberKpiArea,
  TeamOverview,
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

/** How many recent entries per area feed the dashboard's trend/aggregate views.
 *  Multi-rater means several rows can now share one (person, period), so this
 *  is sized generously rather than assuming ~1 row per period. */
const RECENT_ENTRIES_TAKE = 60;

/** getTeamOverview only ever needs each area's *latest* period per person —
 *  but without a bound, that query pulls every EvaluationAreaEntry ever
 *  recorded org-wide into memory, growing unboundedly with tenure. A rolling
 *  window is safe rather than an arbitrary row LIMIT: it can't silently drop
 *  the true latest entry for a low-cadence (e.g. annual) area the way a
 *  per-row cap could, as long as no area goes longer than this between
 *  scores — generous on purpose for that reason. */
const TEAM_OVERVIEW_LOOKBACK_DAYS = 730;

function teamOverviewLookbackCutoff(): Date {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - TEAM_OVERVIEW_LOOKBACK_DAYS);
  return cutoff;
}

type EntryWithEvaluator = {
  anonymous: boolean;
  enteredById: string;
  enteredBy: { id: string; displayName: string };
};

/** Withholds the evaluator's identity on an anonymous entry from anyone
 *  without kpis:manage — `canSeeEvaluators` is resolved once per request,
 *  not per entry, since it's the same answer for every row in a response. */
function scrubAnonymousEntry<T extends EntryWithEvaluator>(entry: T, canSeeEvaluators: boolean): T {
  if (!entry.anonymous || canSeeEvaluators) return entry;
  return { ...entry, enteredById: '', enteredBy: { id: '', displayName: 'anonymous' } };
}

/** Blends a set of entries into a "latest period" value and a "period before
 *  that" value — the same multi-rater averaging as latestAreaValue/
 *  previousAreaValue client-side (apps/web/app/dashboard/scoring.ts) and
 *  getTeamOverview's own inline version, just for one already-known person's
 *  own entries rather than everyone's at once. */
function blendedAreaValues(entries: Array<{ value: Prisma.Decimal; periodStart: Date }>): {
  latestValue: number | null;
  previousValue: number | null;
} {
  if (entries.length === 0) return { latestValue: null, previousValue: null };
  const distinctPeriods = [...new Set(entries.map((e) => e.periodStart.getTime()))].sort((a, b) => b - a);
  const average = (periodTime: number) => {
    const inPeriod = entries.filter((e) => e.periodStart.getTime() === periodTime);
    return Math.round((inPeriod.reduce((sum, e) => sum + Number(e.value), 0) / inPeriod.length) * 100) / 100;
  };
  return {
    latestValue: average(distinctPeriods[0]!),
    previousValue: distinctPeriods.length > 1 ? average(distinctPeriods[1]!) : null,
  };
}

/** Prisma.Decimal's own toJSON() serializes to a string, so every KPI
 *  leaving this service must go through here — otherwise `weight` reaches
 *  the client as e.g. "20.00" and silently turns `sum + weight` client-side
 *  into string concatenation instead of addition. */
function serializeKpi<T extends { weight: Prisma.Decimal | number | null }>(
  kpi: T,
): Omit<T, 'weight'> & { weight: number | null } {
  return { ...kpi, weight: kpi.weight === null ? null : Number(kpi.weight) };
}

/**
 * KPI definitions (just a name + Evaluation Areas), dynamic role/department/
 * stream mappings, and the per-person Evaluation Area score ingestion behind
 * dashboards. A KPI carries no score itself — each Evaluation Area under it
 * is scored 0-5 per evaluatee per period; see EvaluationAreaEntry.
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

  /** Hard delete — cascades to its Evaluation Areas, their entries, and
   *  assignments. Blocked once any entry has ever been recorded under it, so
   *  scored history can't be silently destroyed — deactivate instead, or
   *  pass force to delete it (and that history) anyway. Both paths require
   *  kpis:manage; force-deletes are audit-logged distinctly, with the
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

  /** Whether this caller holds kpis:manage in any role — gates seeing the
   *  evaluator identity on entries their originating mapping marked anonymous. */
  private async canSeeAnonymousEvaluators(userId: string): Promise<boolean> {
    const grant = await this.prisma.rolePermission.findFirst({
      where: {
        role: { isActive: true, users: { some: { userId } } },
        permission: { resource: 'kpis', action: 'manage' },
      },
      select: { roleId: true },
    });
    return grant !== null;
  }

  /** { assignments: { some: { OR: [...] } } } scoped to a user's own roles/department. */
  private async myAssignmentFilter(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { departmentId: true, roles: { select: { roleId: true } } },
    });
    if (!user) throw AppError.notFound('User', userId);

    const roleIds = user.roles.map((r) => r.roleId);
    const scope: object[] = [{ roleId: { in: roleIds } }];
    if (user.departmentId) scope.push({ departmentId: user.departmentId });
    return { assignments: { some: { OR: scope } } };
  }

  async list(query: PageQuery, userId: string) {
    const { page, pageSize } = resolvePageBounds(query);

    // Unlike listMine() (the respondent-facing dashboard, which should only
    // ever show active KPIs), this powers the admin management page — the
    // one place a deactivated KPI or Evaluation Area needs to still be
    // visible, or its own "reactivate" action would be unreachable.
    const restricted = await this.rbac.isReadScopeRestricted(userId, 'kpis');
    const where = { ...(restricted ? await this.myAssignmentFilter(userId) : {}) };
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

  /**
   * The KPIs relevant to the caller: assigned to any of their roles OR their
   * department. Scope is derived server-side from the user record — the
   * client cannot widen it. Each KPI comes with its Evaluation Areas and
   * each area's most recent entries (with the evaluatee's display name) —
   * enough for the dashboard to compute both a per-KPI aggregate and a
   * per-person breakdown client-side, no extra endpoint needed.
   */
  async listMine(userId: string) {
    const [kpis, canSeeEvaluators] = await Promise.all([
      this.prisma.kpi.findMany({
        where: { isActive: true, ...(await this.myAssignmentFilter(userId)) },
        orderBy: { name: 'asc' },
        include: {
          evaluationAreas: {
            where: { isActive: true },
            include: {
              entries: {
                // Historical entries can outlive a person's isKpiApplicable
                // flag being turned off — exclude them here so a no-longer-
                // applicable person doesn't linger in the dashboard's
                // aggregate/per-person breakdowns.
                where: { person: { isKpiApplicable: true } },
                orderBy: { periodStart: 'desc' },
                take: RECENT_ENTRIES_TAKE,
                include: {
                  person: { select: { id: true, displayName: true } },
                  enteredBy: { select: { id: true, displayName: true } },
                },
              },
              subCriteria: { orderBy: { name: 'asc' } },
            },
          },
        },
      }),
      this.canSeeAnonymousEvaluators(userId),
    ]);
    return kpis.map((kpi) => ({
      ...serializeKpi(kpi),
      evaluationAreas: kpi.evaluationAreas.map((area) => ({
        ...area,
        entries: area.entries.map((entry) => scrubAnonymousEntry(entry, canSeeEvaluators)),
      })),
    }));
  }

  /**
   * Org-wide team roster for the dashboard's admin view: every active,
   * KPI-applicable user (User.isKpiApplicable — set at creation, editable
   * after; excludes people who shouldn't be tracked at all regardless of
   * role/department) with whether an active KPI covers their role/department
   * on top of that (the same matching myAssignmentFilter uses for a single
   * caller, just run for everyone at once), plus a final score blended the
   * same way computeKpi does client-side — each of the person's evaluation
   * areas contributes its own latest-period average, then those area
   * averages are themselves averaged. finalScore stays null (not zero) for
   * anyone never scored, so the dashboard can tell "pending" apart from
   * "scored a 0".
   */
  async getTeamOverview(): Promise<TeamOverview> {
    const [users, kpis, entries] = await Promise.all([
      this.prisma.user.findMany({
        where: { isActive: true, isKpiApplicable: true },
        select: {
          id: true,
          displayName: true,
          email: true,
          departmentId: true,
          department: { select: { name: true } },
          roles: { select: { roleId: true, role: { select: { name: true } } } },
        },
        orderBy: { displayName: 'asc' },
      }),
      this.prisma.kpi.findMany({
        where: { isActive: true },
        select: {
          assignments: { select: { roleId: true, departmentId: true } },
          evaluationAreas: { where: { isActive: true }, select: { id: true } },
        },
      }),
      this.prisma.evaluationAreaEntry.findMany({
        where: { person: { isActive: true }, periodStart: { gte: teamOverviewLookbackCutoff() } },
        select: {
          personId: true,
          evaluationAreaId: true,
          value: true,
          periodStart: true,
          periodEnd: true,
          createdAt: true,
        },
      }),
    ]);

    const entriesByPerson = new Map<string, typeof entries>();
    for (const entry of entries) {
      const list = entriesByPerson.get(entry.personId);
      if (list) list.push(entry);
      else entriesByPerson.set(entry.personId, [entry]);
    }

    const members = users.map((user) => {
      const roleIds = new Set(user.roles.map((r) => r.roleId));
      const hasKpi = kpis.some(
        (kpi) =>
          kpi.evaluationAreas.length > 0 &&
          kpi.assignments.some(
            (a) => (a.roleId && roleIds.has(a.roleId)) || (a.departmentId && a.departmentId === user.departmentId),
          ),
      );

      const personEntries = entriesByPerson.get(user.id) ?? [];
      const byArea = new Map<string, typeof personEntries>();
      for (const entry of personEntries) {
        const list = byArea.get(entry.evaluationAreaId);
        if (list) list.push(entry);
        else byArea.set(entry.evaluationAreaId, [entry]);
      }
      const areaLatestValues = [...byArea.values()].map((areaEntries) => {
        const maxPeriodStart = areaEntries.reduce(
          (max, e) => (e.periodStart > max ? e.periodStart : max),
          areaEntries[0]!.periodStart,
        );
        const latest = areaEntries.filter((e) => e.periodStart.getTime() === maxPeriodStart.getTime());
        return latest.reduce((sum, e) => sum + Number(e.value), 0) / latest.length;
      });
      const finalScore =
        areaLatestValues.length > 0
          ? Math.round((areaLatestValues.reduce((a, b) => a + b, 0) / areaLatestValues.length) * 100) / 100
          : null;
      // The date this person was last actually scored (when the entry was
      // submitted), not periodEnd — periodEnd is the scoring period's own
      // boundary and can be backdated/future-dated relative to when the
      // rater actually entered the score.
      const lastUpdated = personEntries.reduce<Date | null>(
        (max, e) => (max === null || e.createdAt > max ? e.createdAt : max),
        null,
      );

      return {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        department: user.department?.name ?? null,
        roles: user.roles.map((r) => r.role.name),
        hasKpi,
        finalScore,
        lastUpdated: lastUpdated ? lastUpdated.toISOString() : null,
      };
    });

    return { totalActiveUsers: users.length, members };
  }

  /**
   * One team member's own rate across every KPI that covers them — the
   * team-overview table's row, expanded. Each area's value is the same
   * blended (multi-rater) average used everywhere else, never split out by
   * who entered which score.
   */
  async getPersonBreakdown(personId: string): Promise<TeamMemberBreakdown> {
    const person = await this.prisma.user.findUnique({
      where: { id: personId },
      select: { id: true, displayName: true },
    });
    if (!person) throw AppError.notFound('User', personId);

    const kpis = await this.prisma.kpi.findMany({
      where: { isActive: true, ...(await this.myAssignmentFilter(personId)) },
      orderBy: { name: 'asc' },
      include: {
        evaluationAreas: {
          where: { isActive: true },
          orderBy: { name: 'asc' },
          include: {
            entries: {
              where: { personId },
              orderBy: { periodStart: 'desc' },
              take: RECENT_ENTRIES_TAKE,
              select: { value: true, periodStart: true },
            },
          },
        },
      },
    });

    return {
      personId: person.id,
      displayName: person.displayName,
      kpis: kpis.map((kpi) => ({
        id: kpi.id,
        name: kpi.name,
        areas: kpi.evaluationAreas.map((area) => {
          const { latestValue, previousValue } = blendedAreaValues(area.entries);
          return {
            id: area.id,
            name: area.name,
            cadence: area.cadence as TeamMemberKpiArea['cadence'],
            latestValue,
            previousValue,
          };
        }),
      })),
    };
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
    // period is a second, coexisting rater, not a duplicate.
    const duplicate = await this.prisma.evaluationAreaEntry.findUnique({
      where: {
        evaluationAreaId_personId_periodStart_periodEnd_enteredById: {
          evaluationAreaId: areaId,
          personId: input.personId,
          periodStart,
          periodEnd,
          enteredById,
        },
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
