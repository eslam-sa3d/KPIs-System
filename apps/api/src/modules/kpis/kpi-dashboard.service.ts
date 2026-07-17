import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ActivityTrend,
  EvaluationAreaCadence,
  FormDefinition,
  MeasurementGaps,
  RawActivityAnswer,
  RecentFeedback,
  SCORE_FIELD_TYPES,
  ScoreFieldType,
  SubmissionAnswers,
  TeamMemberBreakdown,
  TeamOverview,
} from '@pulse/contracts';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../infra/prisma.service';
import { RedisService } from '../../infra/redis.service';
import { answerToText, describeAnswer, normalizeScore, resolveEvaluateeId } from '../forms/score-resolution';
import { detectReferencedUserIds } from '../forms/submission-person-detection';
import { RbacService } from '../rbac/rbac.service';
import {
  allowedFormIds,
  canSeeAnonymousEvaluators,
  legacyEntryFormFilter,
  myAssignmentFilter,
  serializeKpi,
} from './kpi-scope';

/** Bumped (INCR'd) whenever a write can change what the dashboard aggregation
 *  methods below return — submission create/update, KPI-mapping backfill, KPI
 *  mapping create/delete (see submissions.service.ts / form-kpi-mappings.service.ts).
 *  Every cache key embeds the current generation, so a bump makes every
 *  previously-cached entry unreachable at once — no need to enumerate/delete
 *  individual keys (Redis' KEYS/SCAN-by-pattern is expensive and best avoided
 *  on a hot path). Stale entries simply age out via their own TTL. */
export const DASHBOARD_CACHE_GENERATION_KEY = 'dashboard:gen';

/** Short on purpose: this is a safety net for write paths that don't
 *  explicitly bump DASHBOARD_CACHE_GENERATION_KEY (e.g. KPI/EvaluationArea
 *  CRUD, assignment changes, role/department edits that affect scoping) —
 *  correctness self-heals within this window even if a call site is missed,
 *  rather than needing every affected write path enumerated up front. */
const DASHBOARD_CACHE_TTL_SECONDS = 30;

/** How many recent entries per area feed the dashboard's trend/aggregate views.
 *  Multi-rater means several rows can now share one (person, period), so this
 *  is sized generously rather than assuming ~1 row per period. */
const RECENT_ENTRIES_TAKE = 60;

/** loadScoredSubmissions loads every scored submission across the relevant
 *  forms into memory with no date/page bound — correct today, but with no
 *  ceiling it's an unbounded-memory risk as submission volume grows. Rather
 *  than degrade silently, fail fast with a clear error past this line, same
 *  posture as submission-size-guard.ts's MAX_SUBMISSIONS_FOR_SYNC_REPORT — the
 *  real fix at that point is date-windowing or a materialized aggregate, not a
 *  bigger cap. */
const MAX_SUBMISSIONS_FOR_DASHBOARD = 20_000;

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

const ACTIVITY_TREND_WEEKS = 12;

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
  /** The same raw answer normalized to a 0-5 KPI score (see normalizeScore)
   *  — null when the field/answer has no well-defined numeric interpretation
   *  (e.g. a context-only free-text field). Summed across all of a person's
   *  scored submissions, all-time, for their dashboard total score. */
  value: number | null;
  context: string | null;
  comment: string | null;
  submittedAt: Date;
  submissionId: string;
}

/** One (form, submission, named person) tuple from an UNMAPPED form — see
 *  loadRawActivity. Internal shape (carries `personId`/`submittedAt: Date`
 *  for grouping/sorting) that getTeamOverviewImpl/getPersonBreakdownImpl map
 *  down to the public RawActivityEntry contract shape, same relationship
 *  ScoredSubmission has to ScoredSubmissionSummary/PersonSubmission. */
export interface RawActivity {
  formId: string;
  formSlug: string;
  formTitle: string;
  personId: string;
  submittedByName: string | null;
  submissionId: string;
  submittedAt: Date;
  answers: RawActivityAnswer[];
}

function avg(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The configured Performance Level whose [minScore, maxScore] range
 *  contains a person's total score, or null when it falls in a gap between
 *  configured ranges (or nothing is configured at all) — not a fallback to
 *  the nearest range, since an admin-defined gap is a deliberate "unranked"
 *  zone, not an oversight for this code to paper over. */
function matchPerformanceLevel<T extends { id: string; label: string; minScore: number; maxScore: number }>(
  total: number,
  levels: T[],
): { id: string; label: string } | null {
  const match = levels.find((l) => total >= l.minScore && total <= l.maxScore);
  return match ? { id: match.id, label: match.label } : null;
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

/**
 * The dashboard's read side: everything that aggregates KPI/EvaluationArea
 * scoring data for display (my dashboard, team overview, person breakdown,
 * measurement gaps, recent feedback, activity trend). Split out of
 * KpisService (which stays KPI/EvaluationArea/SubCriteria CRUD) because these
 * methods are a genuinely separate responsibility — read-heavy, cached,
 * scoring-aggregation logic rather than admin CRUD.
 */
@Injectable()
export class KpiDashboardService {
  private readonly logger = new Logger(KpiDashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly redis: RedisService,
  ) {}

  /** Cache-aside wrapper for the dashboard aggregation methods below — computes
   *  fresh on a cache miss OR any Redis error (fail-open: a Redis outage must
   *  degrade to always-fresh reads, never a 500). `keyParts` must include every
   *  argument that can change the result (caller id, target person id, kpiId
   *  filter, ...) — see each call site's comment for why its own inputs are
   *  safe/unsafe to omit. */
  private async cachedDashboardRead<T>(keyParts: string[], compute: () => Promise<T>): Promise<T> {
    const generation = await this.dashboardCacheGeneration();
    const key = `dashboard:v${generation}:${keyParts.join(':')}`;

    const cached = generation === null ? null : await this.safeRedisGet(key);
    if (cached) return JSON.parse(cached) as T;

    const result = await compute();
    if (generation !== null) await this.safeRedisSet(key, JSON.stringify(result), DASHBOARD_CACHE_TTL_SECONDS);
    return result;
  }

  /** null means "Redis unavailable, skip caching entirely for this request"
   *  rather than caching under a fixed/stale generation number. */
  private async dashboardCacheGeneration(): Promise<number | null> {
    try {
      const raw = await this.redis.get(DASHBOARD_CACHE_GENERATION_KEY);
      return raw ? Number(raw) : 0;
    } catch (err) {
      this.logger.warn(`Redis GET failed, dashboard reads uncached for this request: ${err}`);
      return null;
    }
  }

  private async safeRedisGet(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch (err) {
      this.logger.warn(`Redis GET failed, falling back to a fresh computation: ${err}`);
      return null;
    }
  }

  private async safeRedisSet(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, value, ttlSeconds);
    } catch (err) {
      this.logger.warn(`Redis SET failed, dashboard cache not updated for ${key}: ${err}`);
    }
  }

  /**
   * Loads every (mapping, submission) pair that resolves to a real, active,
   * KPI-applicable evaluatee with a describable raw score — the read-side
   * equivalent of what FormKpiScoringService's applyOneMapping computes at write
   * time, without writing anything. Every dashboard widget that used to read
   * EvaluationAreaEntry sources from this instead, so what's shown is always
   * traceable to one real FormSubmission — never blended or normalized
   * across mappings (see describeAnswer). Optionally scoped to a set of
   * Evaluation Areas; every active mapping org-wide when omitted. Also
   * optionally scoped to the admin-configured dashboard-form-scope (see
   * allowedFormIds) — omit/null for unrestricted. Sorted
   * most-recent-submission-first.
   */
  private async loadScoredSubmissions(
    evaluationAreaIds?: string[],
    allowedFormIdList?: string[] | null,
  ): Promise<ScoredSubmission[]> {
    const mappings = await this.prisma.formKpiMapping.findMany({
      where: {
        ...(evaluationAreaIds ? { evaluationAreaId: { in: evaluationAreaIds } } : {}),
        ...(allowedFormIdList ? { formId: { in: allowedFormIdList } } : {}),
      },
      include: {
        evaluationArea: {
          select: { id: true, name: true, isActive: true, kpiId: true, kpi: { select: { name: true } } },
        },
      },
    });
    const activeMappings = mappings.filter((m) => m.evaluationArea.isActive);
    if (activeMappings.length === 0) return [];

    const formIds = [...new Set(activeMappings.map((m) => m.formId))];
    const scoredSubmissionsWhere = {
      formVersion: { formId: { in: formIds } },
      submittedById: { not: null },
    } satisfies Prisma.FormSubmissionWhereInput;

    const submissionCount = await this.prisma.formSubmission.count({ where: scoredSubmissionsWhere });
    if (submissionCount > MAX_SUBMISSIONS_FOR_DASHBOARD) {
      throw new AppError(
        'CONFLICT',
        `These KPIs' mapped forms have ${submissionCount} scoreable responses, above the ${MAX_SUBMISSIONS_FOR_DASHBOARD}-response limit for the live dashboard view — this needs date-windowing or a materialized aggregate rather than a synchronous full load. Contact an administrator.`,
      );
    }

    const [forms, submissions] = await Promise.all([
      this.prisma.form.findMany({
        where: { id: { in: formIds } },
        select: { id: true, versions: { orderBy: { version: 'desc' }, take: 1, select: { definition: true } } },
      }),
      this.prisma.formSubmission.findMany({
        where: scoredSubmissionsWhere,
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
    // table — only fetched when at least one mapping's score field, context
    // field, or comment field actually needs it (a context/comment field can
    // be ANY field type — see form-kpi-mappings-panel.tsx), same lazy-fetch
    // rule as FormKpiScoringService's applyOneMapping.
    const needsPerformanceLevels = activeMappings.some((m) => {
      const fields = definitionByFormId.get(m.formId)?.fields;
      return [m.scoreFieldKey, m.contextFieldKey, m.commentFieldKey].some(
        (key) => key && fields?.find((f) => f.key === key)?.type === 'performance_level',
      );
    });
    // Selected columns cover both describeAnswer's display-string needs
    // (label) and normalizeScore's numeric needs (minScore/maxScore/score,
    // for each submission's own contribution to a person's all-time total).
    const performanceLevels = needsPerformanceLevels
      ? await this.prisma.performanceLevel.findMany({ select: { id: true, label: true, minScore: true, maxScore: true } })
      : undefined;
    // score_label answers resolve against the live ScoreLabel table — same
    // lazy-fetch rule as performanceLevels above.
    const needsScoreLabels = activeMappings.some((m) => {
      const fields = definitionByFormId.get(m.formId)?.fields;
      return [m.scoreFieldKey, m.contextFieldKey, m.commentFieldKey].some(
        (key) => key && fields?.find((f) => f.key === key)?.type === 'score_label',
      );
    });
    const scoreLabels = needsScoreLabels
      ? await this.prisma.scoreLabel.findMany({ select: { id: true, label: true, score: true } })
      : undefined;
    const numericPerformanceLevels = performanceLevels?.map((l) => ({
      id: l.id,
      minScore: Number(l.minScore),
      maxScore: Number(l.maxScore),
    }));

    type Candidate = {
      mapping: (typeof activeMappings)[number];
      submission: (typeof submissions)[number];
      evaluateeId: string;
      described: { raw: unknown; display: string };
      value: number | null;
    };
    const candidates: Candidate[] = [];
    for (const mapping of activeMappings) {
      const definition = definitionByFormId.get(mapping.formId);
      const scoreField = definition?.fields.find((f) => f.key === mapping.scoreFieldKey);
      if (!scoreField) continue;
      for (const submission of submissionsByFormId.get(mapping.formId) ?? []) {
        const answers = submission.answers as SubmissionAnswers;
        const evaluateeId = resolveEvaluateeId(mapping.evaluateeFieldKeys, answers, submission.submittedById!);
        if (evaluateeId === null) continue;
        const rawScore = answers[mapping.scoreFieldKey];
        if (rawScore === undefined || rawScore === null) continue;
        const described = describeAnswer(scoreField, rawScore, { performanceLevels, scoreLabels });
        if (described === null) continue;
        const value = normalizeScore(scoreField, rawScore, numericPerformanceLevels, scoreLabels);
        candidates.push({ mapping, submission, evaluateeId, described, value });
      }
    }
    if (candidates.length === 0) return [];

    const userIds = new Set<string>();
    for (const c of candidates) {
      userIds.add(c.evaluateeId);
      userIds.add(c.submission.submittedById!);
      // a context/comment field can be a 'person' field too — collect its
      // answer so the resolution below isn't a raw user id.
      const fields = definitionByFormId.get(c.mapping.formId)?.fields;
      const answers = c.submission.answers as SubmissionAnswers;
      for (const key of [c.mapping.contextFieldKey, c.mapping.commentFieldKey]) {
        if (!key) continue;
        const v = answers[key];
        if (fields?.find((f) => f.key === key)?.type === 'person' && typeof v === 'string') userIds.add(v);
      }
    }
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, displayName: true, isActive: true, isKpiApplicable: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));
    const personNames = new Map(users.map((u) => [u.id, u.displayName]));

    const results: ScoredSubmission[] = [];
    for (const c of candidates) {
      const evaluatee = userById.get(c.evaluateeId);
      if (!evaluatee || !evaluatee.isActive || !evaluatee.isKpiApplicable) continue;
      const evaluatorId = c.submission.submittedById!;
      const evaluator = userById.get(evaluatorId);
      const answers = c.submission.answers as SubmissionAnswers;
      const fields = definitionByFormId.get(c.mapping.formId)?.fields;
      const resolveContextText = (key: string | null) => {
        if (!key) return null;
        const field = fields?.find((f) => f.key === key);
        const raw = answers[key] ?? null;
        const described = field && describeAnswer(field, raw, { performanceLevels, scoreLabels, personNames });
        return described?.display ?? answerToText(raw);
      };
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
        value: c.value,
        context: resolveContextText(c.mapping.contextFieldKey),
        comment: resolveContextText(c.mapping.commentFieldKey),
        submittedAt: c.submission.createdAt,
        submissionId: c.submission.id,
      });
    }
    return results.sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
  }

  /**
   * loadScoredSubmissions' counterpart for forms with NO active FormKpiMapping
   * at all (a form with only inactive-area mappings counts as unmapped too,
   * same as loadScoredSubmissions ignoring those) — real form activity that
   * never reaches the scoring pipeline, but still names a real person via any
   * 'person' field or any field whose answer is a real user id (see
   * detectReferencedUserIds — the same generic detection that already makes a
   * 'select' field with a "select a user" option resolve a name on the Forms →
   * Responses page, with no mapping required there either). One
   * RawActivityEntry PER named person, since a submission can name several
   * (e.g. a QC checklist). Optionally scoped to the admin-configured
   * dashboard-form-scope, same as loadScoredSubmissions. Unlike
   * loadScoredSubmissions, silently caps out rather than throwing past
   * MAX_SUBMISSIONS_FOR_DASHBOARD — this is an additive secondary signal
   * riding on the same synchronous dashboard load as the primary scored path,
   * which already has its own fail-loud guard.
   */
  private async loadRawActivity(allowedFormIdList?: string[] | null): Promise<RawActivity[]> {
    const forms = await this.prisma.form.findMany({
      where: {
        status: 'published',
        ...(allowedFormIdList ? { id: { in: allowedFormIdList } } : {}),
      },
      select: {
        id: true,
        slug: true,
        versions: { orderBy: { version: 'desc' }, take: 1, select: { definition: true } },
        kpiMappings: { select: { evaluationArea: { select: { isActive: true } } } },
      },
    });
    const unmappedForms = forms.filter((f) => !f.kpiMappings.some((m) => m.evaluationArea.isActive));
    if (unmappedForms.length === 0) return [];

    const formIds = unmappedForms.map((f) => f.id);
    const submissionCount = await this.prisma.formSubmission.count({
      where: { formVersion: { formId: { in: formIds } } },
    });
    if (submissionCount === 0 || submissionCount > MAX_SUBMISSIONS_FOR_DASHBOARD) return [];

    const submissions = await this.prisma.formSubmission.findMany({
      where: { formVersion: { formId: { in: formIds } } },
      select: {
        id: true,
        answers: true,
        submittedById: true,
        createdAt: true,
        formVersion: { select: { formId: true } },
      },
    });

    const formById = new Map(unmappedForms.map((f) => [f.id, f]));
    const definitionByFormId = new Map(
      unmappedForms.map((f) => [f.id, f.versions[0]?.definition as unknown as FormDefinition | undefined]),
    );

    // Same lazy performanceLevels/scoreLabels fetch rule as loadScoredSubmissions.
    const allFields = [...definitionByFormId.values()].flatMap((d) => d?.fields ?? []);
    const performanceLevels = allFields.some((f) => f.type === 'performance_level')
      ? await this.prisma.performanceLevel.findMany({ select: { id: true, label: true } })
      : undefined;
    const scoreLabels = allFields.some((f) => f.type === 'score_label')
      ? await this.prisma.scoreLabel.findMany({ select: { id: true, label: true } })
      : undefined;

    type Candidate = {
      form: (typeof unmappedForms)[number];
      definition: FormDefinition;
      submission: (typeof submissions)[number];
      personIds: Set<string>;
    };
    const candidates: Candidate[] = [];
    const referencedUserIds = new Set<string>();
    for (const s of submissions) {
      const form = formById.get(s.formVersion.formId);
      const definition = definitionByFormId.get(s.formVersion.formId);
      if (!form || !definition) continue;
      const answers = s.answers as SubmissionAnswers;
      const personIds = detectReferencedUserIds(definition.fields, answers);
      if (s.submittedById) referencedUserIds.add(s.submittedById);
      for (const id of personIds) referencedUserIds.add(id);
      if (personIds.size === 0) continue; // nothing to attribute this to — skip, don't guess
      candidates.push({ form, definition, submission: s, personIds });
    }
    if (candidates.length === 0) return [];

    const users = await this.prisma.user.findMany({
      where: { id: { in: [...referencedUserIds] } },
      select: { id: true, displayName: true, isActive: true, isKpiApplicable: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));
    const personNames = new Map(users.map((u) => [u.id, u.displayName]));

    const results: RawActivity[] = [];
    for (const c of candidates) {
      const submitter = c.submission.submittedById ? userById.get(c.submission.submittedById) : undefined;
      const answers = c.submission.answers as SubmissionAnswers;
      const describedAnswers = c.definition.fields
        .filter((f) => f.type !== 'section_header')
        .map((f) => {
          const raw = answers[f.key];
          if (raw === undefined) return null;
          const described = describeAnswer(f, raw, { performanceLevels, scoreLabels, personNames });
          const display = described?.display ?? answerToText(raw);
          return display !== null ? { fieldKey: f.key, fieldLabel: f.label, display } : null;
        })
        .filter((a): a is RawActivityAnswer => a !== null);

      // One entry PER named person — a submission naming several people
      // shows up in each of their drawers/counts, same "one submission, several
      // people" rule as summary()'s own userId narrowing.
      for (const personId of c.personIds) {
        const person = userById.get(personId);
        if (!person || !person.isActive || !person.isKpiApplicable) continue;
        results.push({
          formId: c.form.id,
          formSlug: c.form.slug,
          formTitle: c.definition.title,
          personId,
          submittedByName: submitter?.displayName ?? null,
          submissionId: c.submission.id,
          submittedAt: c.submission.createdAt,
          answers: describedAnswers,
        });
      }
    }
    return results.sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
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
    return this.cachedDashboardRead(['listMine', userId], () => this.listMineImpl(userId));
  }

  private async listMineImpl(userId: string) {
    const [kpis, canSeeEvaluators, allowedFormIdList] = await Promise.all([
      this.prisma.kpi.findMany({
        where: { isActive: true, ...(await myAssignmentFilter(this.prisma, userId)) },
        orderBy: { name: 'asc' },
        include: {
          evaluationAreas: {
            where: { isActive: true },
            include: { subCriteria: { orderBy: { name: 'asc' } } },
          },
        },
      }),
      canSeeAnonymousEvaluators(this.prisma, userId),
      allowedFormIds(this.prisma),
    ]);

    const areaIds = kpis.flatMap((kpi) => kpi.evaluationAreas.map((a) => a.id));
    const [scored, legacyEntries] = await Promise.all([
      this.loadScoredSubmissions(areaIds, allowedFormIdList),
      this.prisma.evaluationAreaEntry.findMany({
        where: {
          evaluationAreaId: { in: areaIds },
          person: { isKpiApplicable: true },
          ...legacyEntryFormFilter(allowedFormIdList),
        },
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
    return this.cachedDashboardRead(['getTeamOverview', userId], () => this.getTeamOverviewImpl(userId));
  }

  private async getTeamOverviewImpl(userId: string): Promise<TeamOverview> {
    // null = unrestricted; [] = restricted with nothing selected (sees no one);
    // non-empty = restricted to whichever Performance Level bands are allowed.
    // The gate runs on the old normalized 0-5 blend — also returned to the
    // client as `score` now, to power the dashboard's status cards — because
    // a Performance Level range is defined on that same 0-5 scale and has
    // nothing else to compare a raw, per-mapping answer against.
    const [allowedLevelIds, performanceLevelRows] = await Promise.all([
      this.rbac.allowedDashboardLevelIds(userId),
      this.prisma.performanceLevel.findMany({ select: { id: true, label: true, minScore: true, maxScore: true } }),
    ]);
    const allPerformanceLevels = performanceLevelRows.map((l) => ({
      id: l.id,
      label: l.label,
      minScore: Number(l.minScore),
      maxScore: Number(l.maxScore),
    }));
    const allowedRanges = allowedLevelIds === null ? null : allPerformanceLevels.filter((l) => allowedLevelIds.includes(l.id));

    const allowedFormIdList = await allowedFormIds(this.prisma);
    const [users, kpis, legacyEntries, scored, rawActivity] = await Promise.all([
      this.prisma.user.findMany({
        where: { isActive: true, isKpiApplicable: true },
        select: {
          id: true,
          displayName: true,
          email: true,
          departmentId: true,
          department: { select: { name: true } },
          jobTitle: { select: { label: true } },
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
        where: {
          person: { isActive: true },
          periodStart: { gte: teamOverviewLookbackCutoff() },
          ...legacyEntryFormFilter(allowedFormIdList),
        },
        select: { personId: true, evaluationAreaId: true, value: true, periodStart: true },
      }),
      this.loadScoredSubmissions(undefined, allowedFormIdList),
      this.loadRawActivity(allowedFormIdList),
    ]);

    const scoredByPerson = new Map<string, ScoredSubmission[]>();
    for (const s of scored) {
      const list = scoredByPerson.get(s.personId);
      if (list) list.push(s);
      else scoredByPerson.set(s.personId, [s]);
    }

    const rawActivityCountByPerson = new Map<string, number>();
    // loadRawActivity returns most-recent-first, so the first entry seen per
    // person here is their latest — feeds lastUpdated below alongside their
    // latest scored submission, so a person with only unmapped-form activity
    // (no scored submission at all) still shows a real last-updated date.
    const rawActivityLatestByPerson = new Map<string, Date>();
    for (const a of rawActivity) {
      rawActivityCountByPerson.set(a.personId, (rawActivityCountByPerson.get(a.personId) ?? 0) + 1);
      if (!rawActivityLatestByPerson.has(a.personId)) rawActivityLatestByPerson.set(a.personId, a.submittedAt);
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

      // All-time sum of every one of this person's scored submissions (not
      // just recent ones, and not blended/averaged) — grows as they're
      // evaluated more, matched against the admin-configured Performance
      // Level ranges below rather than the fixed 0-5 status bands.
      const totalScoreValues = personScored.map((s) => s.value).filter((v): v is number => v !== null);
      const totalScore = totalScoreValues.length > 0 ? round2(totalScoreValues.reduce((a, b) => a + b, 0)) : null;
      const legacyScore = legacyFinalScore(user.id);
      // Match against the real, admin-configured Performance Level ranges —
      // totalScore when there's a real scored submission, otherwise the
      // older EvaluationAreaEntry blend (also 0-5) rather than a hardcoded
      // status band, so the label shown is always one the admin actually
      // defined on the Configuration page, never a static fallback string.
      const scoreForLevelMatch = totalScore ?? legacyScore;
      const performanceLevel = scoreForLevelMatch !== null ? matchPerformanceLevel(scoreForLevelMatch, allPerformanceLevels) : null;

      // The more recent of this person's latest scored submission and their
      // latest raw-activity one (an unmapped form can be more recent than
      // any scored submission, or be the only activity they have at all).
      const rawActivityLatest = rawActivityLatestByPerson.get(user.id) ?? null;
      const lastUpdated =
        latest && rawActivityLatest
          ? (latest.submittedAt > rawActivityLatest ? latest.submittedAt : rawActivityLatest)
          : (latest?.submittedAt ?? rawActivityLatest);

      return {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        department: user.department?.name ?? null,
        jobTitle: user.jobTitle?.label ?? null,
        roles: user.roles.map((r) => r.role.name),
        hasKpi,
        score: legacyScore,
        totalScore,
        performanceLevel,
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
        lastUpdated: lastUpdated ? lastUpdated.toISOString() : null,
        rawActivityCount: rawActivityCountByPerson.get(user.id) ?? 0,
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
        : members.filter((m) => m.score !== null && allowedRanges.some((r) => m.score! >= r.minScore && m.score! <= r.maxScore));

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
    return this.cachedDashboardRead(['getPersonBreakdown', personId, callerId], () =>
      this.getPersonBreakdownImpl(personId, callerId),
    );
  }

  private async getPersonBreakdownImpl(personId: string, callerId: string): Promise<TeamMemberBreakdown> {
    const person = await this.prisma.user.findUnique({
      where: { id: personId },
      select: { id: true, displayName: true },
    });
    if (!person) throw AppError.notFound('User', personId);

    const [kpis, canSeeEvaluators, allowedFormIdList, performanceLevelRows] = await Promise.all([
      this.prisma.kpi.findMany({
        where: { isActive: true, ...(await myAssignmentFilter(this.prisma, personId)) },
        select: { evaluationAreas: { where: { isActive: true }, select: { id: true } } },
      }),
      canSeeAnonymousEvaluators(this.prisma, callerId),
      allowedFormIds(this.prisma),
      this.prisma.performanceLevel.findMany({ select: { id: true, label: true, minScore: true, maxScore: true } }),
    ]);
    const areaIds = kpis.flatMap((kpi) => kpi.evaluationAreas.map((a) => a.id));
    const allPerformanceLevels = performanceLevelRows.map((l) => ({
      id: l.id,
      label: l.label,
      minScore: Number(l.minScore),
      maxScore: Number(l.maxScore),
    }));

    // Same legacy 0-5 blend as getTeamOverviewImpl's legacyFinalScore, for
    // the same "fall back until this person has a real scored submission"
    // rule below.
    const legacyEntries = await this.prisma.evaluationAreaEntry.findMany({
      where: { personId, person: { isActive: true }, ...legacyEntryFormFilter(allowedFormIdList) },
      select: { evaluationAreaId: true, value: true, periodStart: true },
    });
    const legacyByArea = new Map<string, typeof legacyEntries>();
    for (const entry of legacyEntries) {
      const list = legacyByArea.get(entry.evaluationAreaId);
      if (list) list.push(entry);
      else legacyByArea.set(entry.evaluationAreaId, [entry]);
    }
    const legacyAreaValues = [...legacyByArea.values()]
      .map((areaEntries) => blendedAreaValues(areaEntries).latestValue)
      .filter((v): v is number => v !== null);
    const legacyScore = legacyAreaValues.length > 0 ? round2(avg(legacyAreaValues)) : null;

    const [scored, rawActivity] = await Promise.all([
      this.loadScoredSubmissions(areaIds, allowedFormIdList),
      this.loadRawActivity(allowedFormIdList),
    ]);
    const allPersonScored = scored.filter((s) => s.personId === personId);
    const personScored = allPersonScored.slice(0, RECENT_ENTRIES_TAKE);
    const personRawActivity = rawActivity.filter((a) => a.personId === personId).slice(0, RECENT_ENTRIES_TAKE);

    // Same all-time-sum rule as getTeamOverviewImpl — every scored
    // submission this person has, not just the recent ones shown below.
    const totalScoreValues = allPersonScored.map((s) => s.value).filter((v): v is number => v !== null);
    const totalScore = totalScoreValues.length > 0 ? round2(totalScoreValues.reduce((a, b) => a + b, 0)) : null;
    const scoreForLevelMatch = totalScore ?? legacyScore;
    const performanceLevel = scoreForLevelMatch !== null ? matchPerformanceLevel(scoreForLevelMatch, allPerformanceLevels) : null;

    return {
      personId: person.id,
      displayName: person.displayName,
      score: legacyScore,
      totalScore,
      performanceLevel,
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
      rawActivity: personRawActivity.map((a) => ({
        formId: a.formId,
        formSlug: a.formSlug,
        formTitle: a.formTitle,
        submittedByName: a.submittedByName,
        submissionId: a.submissionId,
        submittedAt: a.submittedAt.toISOString(),
        answers: a.answers,
      })),
    };
  }

  /**
   * Two silent measurement gaps, org-wide: score-eligible questions on a
   * published form that no FormKpiMapping points at yet, and active
   * Evaluation Areas that haven't been scored recently enough for their own
   * cadence. Distinct from the per-person "pending evaluation" signal, which
   * only catches a gap for one person at a time, not a KPI stale across
   * everyone or a form whose answers never reach a KPI at all. Deliberately
   * ignores the dashboard-form-scope (see allowedFormIds) — this is a
   * completeness audit over the whole org's setup, not a display of the
   * dashboard's current data, so a form hidden from the dashboard still
   * needs to show up here if it has an unmapped question or feeds a stale area.
   */
  async getMeasurementGaps(): Promise<MeasurementGaps> {
    return this.cachedDashboardRead(['getMeasurementGaps'], () => this.getMeasurementGapsImpl());
  }

  /** No caller-scoped filtering anywhere in this method (allowedFormIds() is
   *  the org-wide DashboardFormScope singleton, not per-user) — safe to share
   *  one cache entry across every caller. */
  private async getMeasurementGapsImpl(): Promise<MeasurementGaps> {
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
    return this.cachedDashboardRead(['getRecentFeedback', kpiId ?? 'all'], () => this.getRecentFeedbackImpl(kpiId));
  }

  /** Same no-per-caller-scoping reasoning as getMeasurementGapsImpl — safe to
   *  share across callers, keyed only by the kpiId filter. */
  private async getRecentFeedbackImpl(kpiId?: string): Promise<RecentFeedback> {
    const scored = await this.loadScoredSubmissions(undefined, await allowedFormIds(this.prisma));
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
        display: s.display,
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
    return this.cachedDashboardRead(['getActivityTrend'], () => this.getActivityTrendImpl());
  }

  /** Same no-per-caller-scoping reasoning as getMeasurementGapsImpl. Caching
   *  the "current week" computation below at a 30s TTL is safe — the week
   *  boundary can't move within that window. */
  private async getActivityTrendImpl(): Promise<ActivityTrend> {
    const currentWeekStart = mondayOf(new Date());
    const earliestWeekStart = new Date(currentWeekStart);
    earliestWeekStart.setUTCDate(earliestWeekStart.getUTCDate() - (ACTIVITY_TREND_WEEKS - 1) * 7);

    const allowedFormIdList = await allowedFormIds(this.prisma);
    const mappedFormIds = await this.prisma.formKpiMapping.findMany({
      where: {
        evaluationArea: { isActive: true },
        ...(allowedFormIdList ? { formId: { in: allowedFormIdList } } : {}),
      },
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
}
