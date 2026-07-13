import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ActivityTrend,
  CreateEvaluationAreaInput,
  CreateKpiInput,
  CreateSubCriteriaInput,
  EvaluationAreaCadence,
  FormDefinition,
  KpiAssignmentInput,
  MeasurementGaps,
  PageQuery,
  RecentFeedback,
  RecordEvaluationAreaEntryInput,
  SCORE_FIELD_TYPES,
  ScoreFieldType,
  SetEvaluationAreaStatusInput,
  SetKpiStatusInput,
  SubmissionAnswers,
  TeamMemberBreakdown,
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
import { answerToText, describeAnswer, resolveEvaluateeId } from '../forms/score-resolution';
import { RbacService } from '../rbac/rbac.service';

/** How many recent entries per area feed the dashboard's trend/aggregate views.
 *  Multi-rater means several rows can now share one (person, period), so this
 *  is sized generously rather than assuming ~1 row per period. */
const RECENT_ENTRIES_TAKE = 60;

/** How many recent context/comment entries the feedback digest returns. */
const RECENT_FEEDBACK_TAKE = 30;

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

/** "Stale" for an area means no score in longer than one full cycle plus a
 *  grace period at its own cadence — a yearly area going quiet for 45 days is
 *  normal; a weekly one is not. Same day-counts as demo-data.service.ts's
 *  stepDaysByCadence, doubled for the grace period. */
const STALE_GRACE_DAYS_BY_CADENCE: Record<EvaluationAreaCadence, number> = {
  weekly: 14,
  monthly: 60,
  quarterly: 180,
  yearly: 730,
};

/** How many unmapped questions / stale areas to return in full — callers
 *  needing the true count beyond that use the accompanying `total`. */
const MEASUREMENT_GAPS_ITEM_CAP = 25;

/** How many weeks of history the activity trend covers. */
const ACTIVITY_TREND_WEEKS = 12;

/** The Monday (UTC midnight) of the week containing `date` — a stable
 *  bucketing key independent of time-of-day, used to group entries into
 *  weekly counts for the activity trend. */
function mondayOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
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

/** One (FormKpiMapping, FormSubmission) pair that resolved to a real score —
 *  see loadScoredSubmissions. `enteredById`/`enteredBy` (not `evaluatorId`)
 *  to match EntryWithEvaluator/scrubAnonymousEntry's existing shape. */
export interface ScoredSubmission {
  /** The originating FormKpiMapping's own id — two submissions only compare
   *  meaningfully (e.g. for a trend) when they came through the SAME
   *  mapping, since different mappings can score different field types/
   *  scales even under the same Evaluation Area (a form-level, not
   *  area-level, uniqueness constraint). */
  mappingId: string;
  evaluationAreaId: string;
  evaluationAreaName: string;
  kpiId: string;
  kpiName: string;
  personId: string;
  personName: string;
  enteredById: string;
  enteredBy: { id: string; displayName: string };
  anonymous: boolean;
  reviewType: string;
  raw: unknown;
  display: string;
  context: string | null;
  comment: string | null;
  submittedAt: Date;
  submissionId: string;
}

function avg(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
    return round2(avg(inPeriod.map((e) => Number(e.value))));
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

  /**
   * Loads every (mapping, submission) pair that resolves to a real, active,
   * KPI-applicable evaluatee with a describable raw score — the read-side
   * equivalent of what SubmissionsService.applyOneMapping computes at write
   * time, without writing anything. Every dashboard widget that used to read
   * EvaluationAreaEntry sources from this instead, so what's shown is always
   * traceable to one real FormSubmission — never blended or normalized
   * across mappings (see describeAnswer). Optionally scoped to a set of
   * Evaluation Areas; every active mapping org-wide when omitted. Sorted
   * most-recent-submission-first.
   */
  private async loadScoredSubmissions(evaluationAreaIds?: string[]): Promise<ScoredSubmission[]> {
    const mappings = await this.prisma.formKpiMapping.findMany({
      where: evaluationAreaIds ? { evaluationAreaId: { in: evaluationAreaIds } } : undefined,
      include: {
        evaluationArea: {
          select: { id: true, name: true, isActive: true, kpiId: true, kpi: { select: { name: true } } },
        },
      },
    });
    const activeMappings = mappings.filter((m) => m.evaluationArea.isActive);
    if (activeMappings.length === 0) return [];

    const formIds = [...new Set(activeMappings.map((m) => m.formId))];
    const [forms, submissions] = await Promise.all([
      this.prisma.form.findMany({
        where: { id: { in: formIds } },
        select: { id: true, versions: { orderBy: { version: 'desc' }, take: 1, select: { definition: true } } },
      }),
      this.prisma.formSubmission.findMany({
        where: { formVersion: { formId: { in: formIds } }, submittedById: { not: null } },
        select: {
          id: true,
          answers: true,
          submittedById: true,
          createdAt: true,
          formVersion: { select: { formId: true } },
        },
      }),
    ]);

    const definitionByFormId = new Map(
      forms.map((f) => [f.id, f.versions[0]?.definition as unknown as FormDefinition | undefined]),
    );
    const submissionsByFormId = new Map<string, typeof submissions>();
    for (const s of submissions) {
      const list = submissionsByFormId.get(s.formVersion.formId);
      if (list) list.push(s);
      else submissionsByFormId.set(s.formVersion.formId, [s]);
    }

    // performance_level answers resolve against the live PerformanceLevel
    // table — only fetched when at least one mapping's score field actually
    // needs it, same lazy-fetch rule as SubmissionsService.applyOneMapping.
    const needsPerformanceLevels = activeMappings.some((m) => {
      const field = definitionByFormId.get(m.formId)?.fields.find((f) => f.key === m.scoreFieldKey);
      return field?.type === 'performance_level';
    });
    const performanceLevels = needsPerformanceLevels
      ? await this.prisma.performanceLevel.findMany({ select: { id: true, label: true } })
      : undefined;

    type Candidate = {
      mapping: (typeof activeMappings)[number];
      submission: (typeof submissions)[number];
      evaluateeId: string;
      described: { raw: unknown; display: string };
    };
    const candidates: Candidate[] = [];
    for (const mapping of activeMappings) {
      const definition = definitionByFormId.get(mapping.formId);
      const scoreField = definition?.fields.find((f) => f.key === mapping.scoreFieldKey);
      if (!scoreField) continue;
      for (const submission of submissionsByFormId.get(mapping.formId) ?? []) {
        const answers = submission.answers as SubmissionAnswers;
        const evaluateeId = resolveEvaluateeId(mapping.evaluateeFieldKey, answers, submission.submittedById!);
        if (evaluateeId === null) continue;
        const rawScore = answers[mapping.scoreFieldKey];
        if (rawScore === undefined || rawScore === null) continue;
        const described = describeAnswer(scoreField, rawScore, performanceLevels);
        if (described === null) continue;
        candidates.push({ mapping, submission, evaluateeId, described });
      }
    }
    if (candidates.length === 0) return [];

    const userIds = new Set<string>();
    for (const c of candidates) {
      userIds.add(c.evaluateeId);
      userIds.add(c.submission.submittedById!);
    }
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, displayName: true, isActive: true, isKpiApplicable: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    const results: ScoredSubmission[] = [];
    for (const c of candidates) {
      const evaluatee = userById.get(c.evaluateeId);
      if (!evaluatee || !evaluatee.isActive || !evaluatee.isKpiApplicable) continue;
      const evaluatorId = c.submission.submittedById!;
      const evaluator = userById.get(evaluatorId);
      const answers = c.submission.answers as SubmissionAnswers;
      results.push({
        mappingId: c.mapping.id,
        evaluationAreaId: c.mapping.evaluationAreaId,
        evaluationAreaName: c.mapping.evaluationArea.name,
        kpiId: c.mapping.evaluationArea.kpiId,
        kpiName: c.mapping.evaluationArea.kpi.name,
        personId: evaluatee.id,
        personName: evaluatee.displayName,
        enteredById: evaluatorId,
        enteredBy: { id: evaluatorId, displayName: evaluator?.displayName ?? 'unknown' },
        anonymous: c.mapping.anonymous,
        reviewType: c.mapping.reviewType,
        raw: c.described.raw,
        display: c.described.display,
        context: c.mapping.contextFieldKey ? answerToText(answers[c.mapping.contextFieldKey]) : null,
        comment: c.mapping.commentFieldKey ? answerToText(answers[c.mapping.commentFieldKey]) : null,
        submittedAt: c.submission.createdAt,
        submissionId: c.submission.id,
      });
    }
    return results.sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
  }

  async list(query: PageQuery, userId: string) {
    const { page, pageSize } = resolvePageBounds(query);

    // Unlike listMine() (the respondent-facing dashboard, which should only
    // ever show active KPIs), this powers the admin management page — the
    // one place a deactivated KPI or Evaluation Area needs to still be
    // visible, or its own "reactivate" action would be unreachable.
    const restricted = await this.rbac.isViewScopeRestricted(userId, 'kpis');
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
   * The KPIs relevant to the caller: assigned to any of their roles or their
   * department. Each Evaluation Area comes with its own recent raw
   * submissions (see loadScoredSubmissions) — each one traceable to a real
   * FormSubmission, never blended into one number — so the dashboard can
   * render both a per-KPI view and a per-person breakdown from one fetch,
   * same as before, just sourced from submissions instead of materialized
   * EvaluationAreaEntry rows.
   *
   * Each KPI also carries `latestValue` — the old normalized 0-5 blend,
   * still read from EvaluationAreaEntry (which the write path keeps
   * populating regardless) — purely so the dashboard's status strip can
   * bucket KPIs into Outstanding/Meets/Needs improvement/Below/Pending.
   * That bucketing has no equivalent on raw, cross-type submission values,
   * so this stays a second, parallel signal rather than replacing
   * `recentSubmissions` — display data is raw everywhere else.
   */
  async listMine(userId: string) {
    const [kpis, canSeeEvaluators] = await Promise.all([
      this.prisma.kpi.findMany({
        where: { isActive: true, ...(await this.myAssignmentFilter(userId)) },
        orderBy: { name: 'asc' },
        include: {
          evaluationAreas: {
            where: { isActive: true },
            include: { subCriteria: { orderBy: { name: 'asc' } } },
          },
        },
      }),
      this.canSeeAnonymousEvaluators(userId),
    ]);

    const areaIds = kpis.flatMap((kpi) => kpi.evaluationAreas.map((a) => a.id));
    const [scored, legacyEntries] = await Promise.all([
      this.loadScoredSubmissions(areaIds),
      this.prisma.evaluationAreaEntry.findMany({
        where: { evaluationAreaId: { in: areaIds }, person: { isKpiApplicable: true } },
        select: { evaluationAreaId: true, value: true, periodStart: true },
      }),
    ]);
    const scoredByArea = new Map<string, ScoredSubmission[]>();
    for (const s of scored) {
      const list = scoredByArea.get(s.evaluationAreaId);
      if (list) list.push(s);
      else scoredByArea.set(s.evaluationAreaId, [s]);
    }
    const legacyEntriesByArea = new Map<string, typeof legacyEntries>();
    for (const e of legacyEntries) {
      const list = legacyEntriesByArea.get(e.evaluationAreaId);
      if (list) list.push(e);
      else legacyEntriesByArea.set(e.evaluationAreaId, [e]);
    }

    return kpis.map((kpi) => {
      const areaLatestValues = kpi.evaluationAreas
        .map((area) => blendedAreaValues(legacyEntriesByArea.get(area.id) ?? []).latestValue)
        .filter((v): v is number => v !== null);
      return {
        ...serializeKpi(kpi),
        latestValue: areaLatestValues.length > 0 ? round2(avg(areaLatestValues)) : null,
        evaluationAreas: kpi.evaluationAreas.map((area) => ({
          ...area,
          recentSubmissions: (scoredByArea.get(area.id) ?? [])
            .slice(0, RECENT_ENTRIES_TAKE)
            .map((s) => scrubAnonymousEntry(s, canSeeEvaluators)),
        })),
      };
    });
  }

  /**
   * Org-wide team roster for the dashboard's admin view: every active,
   * KPI-applicable user (User.isKpiApplicable — set at creation, editable
   * after; excludes people who shouldn't be tracked at all regardless of
   * role/department) with whether an active KPI covers their role/department
   * on top of that (the same matching myAssignmentFilter uses for a single
   * caller, just run for everyone at once), plus their single most recent
   * scored submission — raw, on its own scale, never blended with any other
   * mapping's — and, when the submission before that came through the SAME
   * mapping, that one too (for the trend indicator). `latestSubmission` is
   * null (not a zero) for anyone never scored, so the dashboard can tell
   * "pending" apart from "scored a 0". Also carries `score` — the normalized
   * 0-5 blend across all their EvaluationAreaEntry rows — which powers the
   * status cards, distinct from every other raw, per-submission field here.
   */
  async getTeamOverview(userId: string): Promise<TeamOverview> {
    // null = unrestricted; [] = restricted with nothing selected (sees no one);
    // non-empty = restricted to whichever Performance Level bands are allowed.
    // The gate runs on the old normalized 0-5 blend — also returned to the
    // client as `score` now, to power the dashboard's status cards — because
    // a Performance Level range is defined on that same 0-5 scale and has
    // nothing else to compare a raw, per-mapping answer against.
    const allowedLevelIds = await this.rbac.allowedDashboardLevelIds(userId);
    const allowedRanges =
      allowedLevelIds === null
        ? null
        : await this.prisma.performanceLevel.findMany({
            where: { id: { in: allowedLevelIds } },
            select: { minScore: true, maxScore: true },
          });

    const [users, kpis, legacyEntries, scored] = await Promise.all([
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
        select: { personId: true, evaluationAreaId: true, value: true, periodStart: true },
      }),
      this.loadScoredSubmissions(),
    ]);

    const scoredByPerson = new Map<string, ScoredSubmission[]>();
    for (const s of scored) {
      const list = scoredByPerson.get(s.personId);
      if (list) list.push(s);
      else scoredByPerson.set(s.personId, [s]);
    }

    // Visibility-gate-only blend, exactly as before — see the comment above.
    const legacyEntriesByPerson = new Map<string, typeof legacyEntries>();
    for (const entry of legacyEntries) {
      const list = legacyEntriesByPerson.get(entry.personId);
      if (list) list.push(entry);
      else legacyEntriesByPerson.set(entry.personId, [entry]);
    }
    const legacyFinalScore = (personId: string): number | null => {
      const personEntries = legacyEntriesByPerson.get(personId) ?? [];
      const byArea = new Map<string, typeof personEntries>();
      for (const entry of personEntries) {
        const list = byArea.get(entry.evaluationAreaId);
        if (list) list.push(entry);
        else byArea.set(entry.evaluationAreaId, [entry]);
      }
      const latestValues = [...byArea.values()]
        .map((areaEntries) => blendedAreaValues(areaEntries).latestValue)
        .filter((v): v is number => v !== null);
      return latestValues.length > 0 ? round2(avg(latestValues)) : null;
    };

    const members = users.map((user) => {
      const roleIds = new Set(user.roles.map((r) => r.roleId));
      const hasKpi = kpis.some(
        (kpi) =>
          kpi.evaluationAreas.length > 0 &&
          kpi.assignments.some(
            (a) => (a.roleId && roleIds.has(a.roleId)) || (a.departmentId && a.departmentId === user.departmentId),
          ),
      );

      // Most recent first (loadScoredSubmissions' own sort order).
      const personScored = scoredByPerson.get(user.id) ?? [];
      const latest = personScored[0] ?? null;
      // Only meaningful as a trend when it came through the exact same
      // mapping as latest — a different mapping can be a different field
      // type/scale even under the same Evaluation Area.
      const previous = latest ? (personScored.find((s, i) => i > 0 && s.mappingId === latest.mappingId) ?? null) : null;

      return {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        department: user.department?.name ?? null,
        roles: user.roles.map((r) => r.role.name),
        hasKpi,
        score: legacyFinalScore(user.id),
        latestSubmission: latest
          ? {
              raw: latest.raw,
              display: latest.display,
              areaName: latest.evaluationAreaName,
              kpiName: latest.kpiName,
              submittedAt: latest.submittedAt.toISOString(),
            }
          : null,
        previousSubmission: previous
          ? { raw: previous.raw, display: previous.display, submittedAt: previous.submittedAt.toISOString() }
          : null,
        lastUpdated: latest ? latest.submittedAt.toISOString() : null,
      };
    });

    // dashboards:view scope='level': narrow the roster to people whose
    // blended score falls inside one of the caller's allowed Performance
    // Level ranges. allowedRanges === null means unrestricted (skip
    // filtering entirely); [] means restricted-but-nothing-selected, so
    // everyone with no matching range (i.e. everyone) is dropped.
    const visibleMembers =
      allowedRanges === null
        ? members
        : members.filter(
            (m) =>
              m.score !== null &&
              allowedRanges.some((r) => m.score! >= Number(r.minScore) && m.score! <= Number(r.maxScore)),
          );

    return { totalActiveUsers: visibleMembers.length, members: visibleMembers };
  }

  /**
   * One team member's own scored submissions across every KPI that covers
   * them, most recent first — the team-overview table's row, expanded into
   * a chronological feed rather than one blended value per area, since two
   * submissions are only comparable when they came through the same mapping
   * (see loadScoredSubmissions). `callerId` decides whether an anonymous
   * mapping's evaluator identity is withheld, same rule as listMine — this
   * endpoint is dashboards:view, broader than kpis:manage, so unlike
   * getRecentFeedback it can't assume every caller is already entitled to
   * see every evaluator.
   */
  async getPersonBreakdown(personId: string, callerId: string): Promise<TeamMemberBreakdown> {
    const person = await this.prisma.user.findUnique({
      where: { id: personId },
      select: { id: true, displayName: true },
    });
    if (!person) throw AppError.notFound('User', personId);

    const [kpis, canSeeEvaluators] = await Promise.all([
      this.prisma.kpi.findMany({
        where: { isActive: true, ...(await this.myAssignmentFilter(personId)) },
        select: { evaluationAreas: { where: { isActive: true }, select: { id: true } } },
      }),
      this.canSeeAnonymousEvaluators(callerId),
    ]);
    const areaIds = kpis.flatMap((kpi) => kpi.evaluationAreas.map((a) => a.id));

    const scored = await this.loadScoredSubmissions(areaIds);
    const personScored = scored.filter((s) => s.personId === personId).slice(0, RECENT_ENTRIES_TAKE);

    return {
      personId: person.id,
      displayName: person.displayName,
      submissions: personScored.map((s) => {
        const scrubbed = scrubAnonymousEntry(s, canSeeEvaluators);
        return {
          kpiId: scrubbed.kpiId,
          kpiName: scrubbed.kpiName,
          areaId: scrubbed.evaluationAreaId,
          areaName: scrubbed.evaluationAreaName,
          raw: scrubbed.raw,
          display: scrubbed.display,
          submittedAt: scrubbed.submittedAt.toISOString(),
          evaluatorName: scrubbed.enteredBy.displayName,
          anonymous: scrubbed.anonymous,
          reviewType: scrubbed.reviewType,
          context: scrubbed.context,
          comment: scrubbed.comment,
        };
      }),
    };
  }

  /**
   * Two silent measurement gaps, org-wide: score-eligible questions on a
   * published form that no FormKpiMapping points at yet, and active
   * Evaluation Areas that haven't been scored recently enough for their own
   * cadence. Distinct from the per-person "pending evaluation" signal, which
   * only catches a gap for one person at a time, not a KPI stale across
   * everyone or a form whose answers never reach a KPI at all.
   */
  async getMeasurementGaps(): Promise<MeasurementGaps> {
    const [forms, kpis, scored] = await Promise.all([
      this.prisma.form.findMany({
        where: { status: 'published' },
        select: {
          slug: true,
          versions: { orderBy: { version: 'desc' }, take: 1, select: { definition: true } },
          kpiMappings: { select: { scoreFieldKey: true } },
        },
      }),
      this.prisma.kpi.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          evaluationAreas: { where: { isActive: true }, select: { id: true, name: true, cadence: true } },
        },
      }),
      // Most-recent-submission-per-area — see loadScoredSubmissions; it's
      // already sorted most-recent-first, so the first hit per area is its latest.
      this.loadScoredSubmissions(),
    ]);
    const latestByArea = new Map<string, Date>();
    for (const s of scored) {
      if (!latestByArea.has(s.evaluationAreaId)) latestByArea.set(s.evaluationAreaId, s.submittedAt);
    }

    const unmappedQuestions: MeasurementGaps['unmappedQuestions']['items'] = [];
    for (const form of forms) {
      const latest = form.versions[0];
      if (!latest) continue;
      const definition = latest.definition as unknown as FormDefinition;
      const mappedKeys = new Set(form.kpiMappings.map((m) => m.scoreFieldKey));
      for (const field of definition.fields) {
        if (!SCORE_FIELD_TYPES.includes(field.type as ScoreFieldType)) continue;
        if (mappedKeys.has(field.key)) continue;
        unmappedQuestions.push({
          formSlug: form.slug,
          formTitle: definition.title,
          fieldKey: field.key,
          fieldLabel: field.label,
        });
      }
    }

    const now = Date.now();
    const staleAreas: MeasurementGaps['staleAreas']['items'] = [];
    for (const kpi of kpis) {
      for (const area of kpi.evaluationAreas) {
        const cadence = area.cadence as EvaluationAreaCadence;
        const graceDays = STALE_GRACE_DAYS_BY_CADENCE[cadence] ?? STALE_GRACE_DAYS_BY_CADENCE.monthly;
        const lastScoredAt = latestByArea.get(area.id) ?? null;
        const isStale = !lastScoredAt || now - lastScoredAt.getTime() > graceDays * 24 * 60 * 60 * 1000;
        if (!isStale) continue;
        staleAreas.push({
          kpiId: kpi.id,
          kpiName: kpi.name,
          areaId: area.id,
          areaName: area.name,
          cadence,
          lastScoredAt: lastScoredAt ? lastScoredAt.toISOString() : null,
        });
      }
    }

    return {
      unmappedQuestions: {
        total: unmappedQuestions.length,
        items: unmappedQuestions.slice(0, MEASUREMENT_GAPS_ITEM_CAP),
      },
      staleAreas: { total: staleAreas.length, items: staleAreas.slice(0, MEASUREMENT_GAPS_ITEM_CAP) },
    };
  }

  /**
   * The free-text context/comment an evaluator leaves alongside a score,
   * across the org (or one KPI), most recent first — real qualitative
   * signal that today only exists one entry at a time inside a person's own
   * drawer. Gated on dashboards:view at the controller (pre-existing —
   * unchanged by this rewrite): evaluator identity isn't scrubbed here even
   * for an anonymous-marked entry, same as before; `anonymous` is just
   * returned as a label for the UI.
   */
  async getRecentFeedback(kpiId?: string): Promise<RecentFeedback> {
    const scored = await this.loadScoredSubmissions();
    const withFeedback = scored
      .filter((s) => (s.context !== null || s.comment !== null) && (!kpiId || s.kpiId === kpiId))
      .slice(0, RECENT_FEEDBACK_TAKE);

    return {
      entries: withFeedback.map((s) => ({
        // Synthetic: one submission can feed more than one mapping/area, so
        // submissionId alone isn't unique across this list.
        id: `${s.submissionId}-${s.mappingId}`,
        kpiId: s.kpiId,
        kpiName: s.kpiName,
        areaName: s.evaluationAreaName,
        personName: s.personName,
        evaluatorName: s.enteredBy.displayName,
        anonymous: s.anonymous,
        context: s.context,
        comment: s.comment,
        createdAt: s.submittedAt.toISOString(),
      })),
    };
  }

  /**
   * A weekly count of new submissions to a KPI-mapped form, org-wide, over
   * the last ACTIVITY_TREND_WEEKS weeks — every submission to a mapped form,
   * not just ones that resolved to a real score (an inactive evaluatee or an
   * unanswered score field still represents real evaluation activity, just
   * activity that didn't land anywhere yet), which is a more honest signal
   * than counting only successfully-scored ones. Every week in the window is
   * present even at 0, so a gap in activity reads as a flat line, not a
   * missing bar.
   */
  async getActivityTrend(): Promise<ActivityTrend> {
    const currentWeekStart = mondayOf(new Date());
    const earliestWeekStart = new Date(currentWeekStart);
    earliestWeekStart.setUTCDate(earliestWeekStart.getUTCDate() - (ACTIVITY_TREND_WEEKS - 1) * 7);

    const mappedFormIds = await this.prisma.formKpiMapping.findMany({
      where: { evaluationArea: { isActive: true } },
      select: { formId: true },
      distinct: ['formId'],
    });
    const submissions = mappedFormIds.length
      ? await this.prisma.formSubmission.findMany({
          where: {
            formVersion: { formId: { in: mappedFormIds.map((m) => m.formId) } },
            submittedById: { not: null },
            createdAt: { gte: earliestWeekStart },
          },
          select: { createdAt: true },
        })
      : [];

    const counts = new Map<string, number>();
    for (const submission of submissions) {
      const key = mondayOf(submission.createdAt).toISOString().slice(0, 10);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const points: ActivityTrend['points'] = [];
    for (let i = 0; i < ACTIVITY_TREND_WEEKS; i++) {
      const weekStart = new Date(earliestWeekStart);
      weekStart.setUTCDate(weekStart.getUTCDate() + i * 7);
      const key = weekStart.toISOString().slice(0, 10);
      points.push({ weekStart: key, count: counts.get(key) ?? 0 });
    }

    return { points };
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
