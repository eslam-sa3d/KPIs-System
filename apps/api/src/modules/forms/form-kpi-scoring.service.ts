import { Injectable, Logger } from '@nestjs/common';
import { FormDefinition, FormField, SubmissionAnswers } from '@pulse/contracts';
import { Prisma } from '@prisma/client';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../infra/prisma.service';
import { RedisService } from '../../infra/redis.service';
import { DASHBOARD_CACHE_GENERATION_KEY } from '../kpis/kpi-dashboard.service';
import { assertSyncReportSizeOk } from './submission-size-guard';
import { FormsService } from './forms.service';
import { answerToText, describeAnswer, normalizeScore, resolveEvaluateeId } from './score-resolution';

type PerformanceLevelLookup = { id: string; label: string; minScore: number; maxScore: number };
type ScoreLabelLookup = { id: string; label: string; score: number };

/** Every reason applyOneMapping can decline to score a submission, surfaced
 *  all the way out to backfillMapping's caller — see BackfillResult in
 *  @pulse/contracts for why this replaced a bare boolean. */
type ApplyOneMappingResult = { scored: true } | { scored: false; reason: string };

/**
 * The Forms→KPI bridge: applies a form's FormKpiMappings to a submission's
 * answers (live, on every submit/edit) or replays one mapping against every
 * pre-existing submission on its form (backfillMapping, for a mapping added
 * after data already exists).
 */
@Injectable()
export class FormKpiScoringService {
  private readonly logger = new Logger(FormKpiScoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly forms: FormsService,
    private readonly redis: RedisService,
  ) {}

  /** Bumps the dashboard cache generation (see kpi-dashboard.service.ts) so
   *  KpiDashboardService's cached aggregation reads stop serving stale data
   *  once this write can have changed them. Best-effort: a Redis outage here
   *  just means the dashboard's own short TTL is the only thing bounding
   *  staleness for this write, not a reason to fail the request that's doing
   *  real, already-committed work. */
  private async invalidateDashboardCache(): Promise<void> {
    try {
      await this.redis.incr(DASHBOARD_CACHE_GENERATION_KEY);
    } catch (err) {
      this.logger.warn(`Redis INCR failed, dashboard cache not invalidated: ${err}`);
    }
  }

  /**
   * For every FormKpiMapping on this form, resolves the evaluatee (the
   * answer at the first-answered of evaluateeFieldKeys — or, when empty, the
   * submitter themselves: self-assessment), normalizes the answer at
   * scoreFieldKey to 0-5, and upserts an EvaluationAreaEntry for the period
   * containing this submission — so editing a submission updates the same
   * period's entry rather than creating a duplicate.
   *
   * `enteredById` is the submission's own submitter — it's null for anonymous
   * public submissions, and a mapping is skipped entirely in that case since
   * EvaluationAreaEntry.enteredById can't be null (evaluation surveys feeding
   * a KPI are expected to be filled by an authenticated evaluator).
   *
   * Never throws: a bad/misconfigured mapping shouldn't fail the submission
   * itself, which is the primary thing the caller is waiting on.
   */
  async applyKpiMappings(
    formId: string,
    definition: FormDefinition,
    answers: SubmissionAnswers,
    enteredById: string | null,
    submissionId: string,
  ): Promise<void> {
    if (!enteredById) return;

    // Every submission — mapped or not — can change the dashboard now (an
    // unmapped form's raw activity is dashboard-visible too, see
    // KpiDashboardService.loadRawActivity), so this always invalidates, even
    // when there are zero mappings below.
    await this.invalidateDashboardCache();

    const mappings = await this.prisma.formKpiMapping.findMany({
      where: { formId },
      include: { evaluationArea: true },
    });
    if (!mappings.length) return;

    const fieldsByKey = new Map(definition.fields.map((f) => [f.key, f]));
    const getPerformanceLevels = this.memoizedPerformanceLevelsLoader();
    const getScoreLabels = this.memoizedScoreLabelsLoader();

    for (const mapping of mappings) {
      try {
        await this.applyOneMapping(
          mapping,
          fieldsByKey,
          answers,
          enteredById,
          submissionId,
          new Date(),
          getPerformanceLevels,
          getScoreLabels,
        );
      } catch (cause) {
        this.logger.warn(
          `form-kpi mapping ${mapping.id} failed for submission ${submissionId}: ${cause instanceof Error ? cause.message : cause}`,
        );
      }
    }
  }

  /** performanceLevel rows are global, unchanging for the lifetime of a single
   *  applyKpiMappings/backfillMapping call — memoized so scoring N mappings or
   *  N submissions in one pass fetches them at most once, not once per item,
   *  while still never fetching at all for forms that don't use them. */
  private memoizedPerformanceLevelsLoader(): () => Promise<PerformanceLevelLookup[]> {
    let cache: PerformanceLevelLookup[] | undefined;
    return async () => {
      if (!cache) {
        cache = (await this.prisma.performanceLevel.findMany()).map((l) => ({
          id: l.id,
          label: l.label,
          minScore: Number(l.minScore),
          maxScore: Number(l.maxScore),
        }));
      }
      return cache;
    };
  }

  /** Same memoization as memoizedPerformanceLevelsLoader, for ScoreLabel rows. */
  private memoizedScoreLabelsLoader(): () => Promise<ScoreLabelLookup[]> {
    let cache: ScoreLabelLookup[] | undefined;
    return async () => {
      if (!cache) {
        cache = await this.prisma.scoreLabel.findMany();
      }
      return cache;
    };
  }

  /** The single-mapping core of applyKpiMappings, factored out so backfillMapping
   *  can replay ONE mapping against every pre-existing submission on its form
   *  without re-deriving the other mappings each time. Returns whether it
   *  actually scored (false = skipped: inactive area, missing/invalid answer,
   *  inactive evaluatee). `at` is the moment used to resolve the calendar
   *  period — "now" for a live submission, but the submission's own
   *  createdAt for a backfill, so a stale submission scores into the period
   *  it was actually collected in, not today's. */
  private async applyOneMapping(
    mapping: Prisma.FormKpiMappingGetPayload<{ include: { evaluationArea: true } }>,
    fieldsByKey: Map<string, FormField>,
    answers: SubmissionAnswers,
    enteredById: string,
    submissionId: string,
    at: Date,
    getPerformanceLevels: () => Promise<PerformanceLevelLookup[]>,
    getScoreLabels: () => Promise<ScoreLabelLookup[]>,
  ): Promise<ApplyOneMappingResult> {
    if (!mapping.evaluationArea.isActive) return { scored: false, reason: 'evaluation area is inactive' };

    const evaluateeId = resolveEvaluateeId(mapping.evaluateeFieldKeys, answers, enteredById);
    if (evaluateeId === null) return { scored: false, reason: 'no evaluatee field was answered' };
    const rawScore = answers[mapping.scoreFieldKey];
    if (rawScore === undefined || rawScore === null) {
      return { scored: false, reason: 'score field was not answered' };
    }

    const scoreField = fieldsByKey.get(mapping.scoreFieldKey);
    if (!scoreField) return { scored: false, reason: 'score field no longer exists on this form' };
    const contextField = mapping.contextFieldKey ? fieldsByKey.get(mapping.contextFieldKey) : undefined;
    const commentField = mapping.commentFieldKey ? fieldsByKey.get(mapping.commentFieldKey) : undefined;
    // Only fetched when actually needed — a context/comment field can be ANY
    // field type (see form-kpi-mappings-panel.tsx), not just the score field.
    const performanceLevels =
      scoreField.type === 'performance_level' ||
      contextField?.type === 'performance_level' ||
      commentField?.type === 'performance_level'
        ? await getPerformanceLevels()
        : undefined;
    const scoreLabels =
      scoreField.type === 'score_label' || contextField?.type === 'score_label' || commentField?.type === 'score_label'
        ? await getScoreLabels()
        : undefined;
    const value = normalizeScore(scoreField, rawScore, performanceLevels, scoreLabels);
    if (value === null) {
      return {
        scored: false,
        reason: 'answer could not be scored (no matching Score Label/Performance Level configured)',
      };
    }

    const evaluatee = await this.prisma.user.findUnique({ where: { id: evaluateeId } });
    if (!evaluatee || !evaluatee.isActive) return { scored: false, reason: 'evaluatee is not an active user' };

    // A context/comment field can be a 'person' field too — resolve only the
    // (at most two) ids actually referenced rather than a broad lookup.
    const personIds = [
      contextField?.type === 'person' ? answers[mapping.contextFieldKey!] : undefined,
      commentField?.type === 'person' ? answers[mapping.commentFieldKey!] : undefined,
    ].filter((v): v is string => typeof v === 'string');
    const personNames = personIds.length
      ? new Map(
          (
            await this.prisma.user.findMany({
              where: { id: { in: personIds } },
              select: { id: true, displayName: true },
            })
          ).map((u) => [u.id, u.displayName]),
        )
      : undefined;

    const { periodStart, periodEnd } = computePeriod(mapping.evaluationArea.cadence, at);
    const resolveContextText = (key: string | null, field: FormField | undefined) => {
      if (!key) return null;
      const raw = answers[key] ?? null;
      const described = field && describeAnswer(field, raw, { performanceLevels, scoreLabels, personNames });
      return described?.display ?? answerToText(raw);
    };
    const context = resolveContextText(mapping.contextFieldKey, contextField);
    const comment = resolveContextText(mapping.commentFieldKey, commentField);

    // personId is part of the upsert's own unique key below, so if this same
    // submission+mapping previously resolved to a DIFFERENT evaluatee (a
    // mapping that used to be self-assessment and is now evaluatee-based, a
    // changed evaluatee-field answer on a resubmission, or a mapping's
    // evaluatee field being reconfigured before a backfill) the upsert would
    // silently leave that old entry behind under the wrong person instead of
    // moving it — nothing else in this codebase ever cleans that up.
    // Reconcile by submissionId+mappingId first: this submission owns at most
    // one entry PER MAPPING (two mappings sharing an Evaluation Area under
    // different subCriteria each own their own entry — see mappingId below).
    const stale = await this.prisma.evaluationAreaEntry.findFirst({
      where: { submissionId, mappingId: mapping.id, personId: { not: evaluateeId } },
      select: { id: true },
    });
    if (stale) await this.prisma.evaluationAreaEntry.delete({ where: { id: stale.id } });

    // enteredById is part of the key: one row PER EVALUATOR per period, so a
    // second rater scoring the same person/area/period adds a distinct entry
    // instead of overwriting the first — see EvaluationAreaEntry's schema
    // comment. mappingId is part of it too: two mappings sharing an
    // Evaluation Area (distinguished only by subCriteriaId) each get their
    // own entry instead of the second one's upsert overwriting the first's
    // score. Only a resubmission by the SAME evaluator on the SAME mapping
    // (e.g. editing their own response) updates in place.
    await this.prisma.evaluationAreaEntry.upsert({
      where: {
        evaluationAreaId_personId_periodStart_periodEnd_enteredById_mappingId: {
          evaluationAreaId: mapping.evaluationAreaId,
          personId: evaluateeId,
          periodStart,
          periodEnd,
          enteredById,
          mappingId: mapping.id,
        },
      },
      create: {
        evaluationAreaId: mapping.evaluationAreaId,
        personId: evaluateeId,
        value,
        periodStart,
        periodEnd,
        enteredById,
        reviewType: mapping.reviewType,
        anonymous: mapping.anonymous,
        context,
        comment,
        submissionId,
        mappingId: mapping.id,
      },
      update: {
        value,
        reviewType: mapping.reviewType,
        anonymous: mapping.anonymous,
        context,
        comment,
        submissionId,
      },
    });
    return { scored: true };
  }

  /**
   * Retroactively scores every existing submission on this mapping's form
   * against this one mapping — for when a mapping is created after
   * submissions already exist (the normal order for a real rollout: collect
   * data first, wire up KPI scoring once the taxonomy is settled). Each
   * submission is scored into the calendar period it was actually collected
   * in (via its own createdAt), not the period containing today. Idempotent:
   * re-running it just re-upserts the same entries.
   */
  async backfillMapping(
    formId: string,
    mappingId: string,
  ): Promise<{ scored: number; skipped: number; skippedReasons: Record<string, number> }> {
    const mapping = await this.prisma.formKpiMapping.findFirst({
      where: { id: mappingId, formId },
      include: { evaluationArea: true },
    });
    if (!mapping) throw AppError.notFound('Form KPI mapping', mappingId);

    const form = await this.prisma.form.findUnique({ where: { id: formId } });
    if (!form) throw AppError.notFound('Form', formId);
    await assertSyncReportSizeOk(this.prisma, { formVersion: { formId } });
    const { definition } = await this.forms.getLatestVersion(form.slug);
    const fieldsByKey = new Map(definition.fields.map((f) => [f.key, f]));
    const getPerformanceLevels = this.memoizedPerformanceLevelsLoader();
    const getScoreLabels = this.memoizedScoreLabelsLoader();

    const submissions = await this.prisma.formSubmission.findMany({
      where: { formVersion: { formId } },
      select: { id: true, answers: true, submittedById: true, createdAt: true },
    });

    let scored = 0;
    const skippedReasons: Record<string, number> = {};
    const recordSkip = (reason: string) => {
      skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
    };
    for (const submission of submissions) {
      if (!submission.submittedById) {
        recordSkip('anonymous submission (no evaluator)'); // same rule as live submissions: anonymous public fills never score
        continue;
      }
      try {
        const result = await this.applyOneMapping(
          mapping,
          fieldsByKey,
          submission.answers as SubmissionAnswers,
          submission.submittedById,
          submission.id,
          submission.createdAt,
          getPerformanceLevels,
          getScoreLabels,
        );
        if (result.scored) scored++;
        else recordSkip(result.reason);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        recordSkip(`error: ${message}`);
        this.logger.warn(`backfill of mapping ${mappingId} failed for submission ${submission.id}: ${message}`);
      }
    }
    await this.invalidateDashboardCache();
    const skipped = submissions.length - scored;
    return { scored, skipped, skippedReasons };
  }
}

/** Calendar-boundary period containing `at`, in UTC, for the given Evaluation Area cadence. */
function computePeriod(cadence: string, at: Date): { periodStart: Date; periodEnd: Date } {
  const y = at.getUTCFullYear();
  const m = at.getUTCMonth();
  const d = at.getUTCDate();
  switch (cadence) {
    case 'weekly': {
      const dayOfWeek = at.getUTCDay(); // 0=Sun..6=Sat
      const daysSinceMonday = (dayOfWeek + 6) % 7;
      return {
        periodStart: new Date(Date.UTC(y, m, d - daysSinceMonday)),
        periodEnd: new Date(Date.UTC(y, m, d - daysSinceMonday + 6, 23, 59, 59, 999)),
      };
    }
    case 'monthly':
      return {
        periodStart: new Date(Date.UTC(y, m, 1)),
        periodEnd: new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999)),
      };
    case 'quarterly': {
      const quarterStartMonth = Math.floor(m / 3) * 3;
      return {
        periodStart: new Date(Date.UTC(y, quarterStartMonth, 1)),
        periodEnd: new Date(Date.UTC(y, quarterStartMonth + 3, 0, 23, 59, 59, 999)),
      };
    }
    case 'yearly':
    default:
      return {
        periodStart: new Date(Date.UTC(y, 0, 1)),
        periodEnd: new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999)),
      };
  }
}
