import { Injectable, Logger } from '@nestjs/common';
import {
  FormDefinition,
  FormField,
  FormFieldSummary,
  FormResponseSummary,
  FormSettings,
  PageQuery,
  SubmissionAnswers,
  buildPaginationMeta,
  resolvePageBounds,
} from '@pulse/contracts';
import { ZodError } from 'zod';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AppError } from '../../common/app-error';
import { paged } from '../../common/envelope.interceptor';
import { PrismaService } from '../../infra/prisma.service';
import { compileAnswerValidator } from './answer-validator';
import { FormsService } from './forms.service';
import { QuizScore, scoreSubmission } from './quiz-scoring';
import { TurnstileService } from './turnstile.service';

/**
 * summary() and buildExportTable() both load every submission for a form
 * into memory and reduce client-side — necessary because the aggregation
 * shape differs per field type (select counts, likert matrices, ranking
 * positions, quiz-score distributions, ...) and expressing all of that as
 * dynamic per-field-type SQL would be its own significant, error-prone
 * project. Below this cap that's a fine, simple design; above it, it's an
 * unbounded-memory risk with no ceiling. Rather than let it degrade
 * silently, both methods fail fast with a clear error once a form crosses
 * this line — the real fix at that point is a background export job, not a
 * bigger cap.
 */
const MAX_SUBMISSIONS_FOR_SYNC_REPORT = 20_000;

/**
 * Submission engine: validates answers against the form version's compiled
 * schema, enforces the form's collection settings, persists, and serves the
 * list / summary / export views.
 */
@Injectable()
export class SubmissionsService {
  private readonly logger = new Logger(SubmissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly forms: FormsService,
    private readonly turnstile: TurnstileService,
  ) {}

  async submit(formSlug: string, rawAnswers: SubmissionAnswers, submittedById: string) {
    const { form, version, definition, settings } = await this.forms.getLatestVersion(formSlug);
    await this.enforceSettings(form.id, settings, submittedById, null, rawAnswers);
    return this.persist(form.slug, form.id, version.id, definition, settings, rawAnswers, submittedById, null);
  }

  /** Anonymous submission via a public share link. `respondentFingerprint` is a random id the
   *  controller stores in a cookie — the only "identity" an anonymous filler has. */
  async submitPublic(
    token: string,
    rawAnswers: SubmissionAnswers,
    respondentFingerprint: string | null,
    turnstileToken?: string,
  ) {
    const { form, version, definition, settings } = await this.forms.getByPublicToken(token);
    await this.turnstile.verify(settings.requireCaptcha, turnstileToken);
    await this.enforceSettings(form.id, settings, null, respondentFingerprint, rawAnswers);
    return this.persist(form.slug, form.id, version.id, definition, settings, rawAnswers, null, respondentFingerprint);
  }

  /** Fetches a respondent's own previously-submitted answers to prefill the edit form. */
  async getByEditToken(formToken: string, editToken: string) {
    const { form } = await this.forms.getByPublicToken(formToken);
    const existing = await this.prisma.formSubmission.findFirst({
      where: { editToken, formVersion: { formId: form.id } },
      select: { answers: true },
    });
    if (!existing) throw AppError.notFound('Submission', editToken);
    return { answers: existing.answers as SubmissionAnswers };
  }

  /** Lets a respondent revise their own submission — re-validates against the CURRENT
   *  version's compiled schema, same as admin edit, but gated by the token returned at
   *  submit time rather than an admin permission. */
  async updateByEditToken(formToken: string, editToken: string, rawAnswers: SubmissionAnswers) {
    const { form, definition, settings } = await this.forms.getByPublicToken(formToken);
    const existing = await this.prisma.formSubmission.findFirst({
      where: { editToken, formVersion: { formId: form.id } },
    });
    if (!existing) throw AppError.notFound('Submission', editToken);

    const { answers, uploadIds, score } = await this.validateAndScore(form.id, definition, settings, rawAnswers);
    const submission = await this.prisma.formSubmission.update({
      where: { id: existing.id },
      data: { answers, score: score ? (score as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
    });
    if (uploadIds.length) {
      await this.prisma.formFileUpload.updateMany({
        where: { id: { in: uploadIds } },
        data: { submissionId: submission.id },
      });
    }
    await this.applyKpiMappings(form.id, definition, answers, existing.submittedById, submission.id);
    return submission;
  }

  private async enforceSettings(
    formId: string,
    settings: FormSettings,
    submittedById: string | null,
    respondentFingerprint: string | null,
    rawAnswers: SubmissionAnswers,
  ) {
    const closed = new AppError('CONFLICT', 'This form is not accepting responses');
    if (!settings.acceptingResponses) throw closed;
    const now = new Date();
    if (settings.opensAt && now < new Date(settings.opensAt)) throw closed;
    if (settings.closesAt && now > new Date(settings.closesAt)) throw closed;

    if (settings.maxResponses) {
      const count = await this.prisma.formSubmission.count({ where: { formVersion: { formId } } });
      if (count >= settings.maxResponses) throw closed;
    }

    for (const quota of settings.quotas) {
      if (rawAnswers[quota.fieldKey] !== quota.equals) continue;
      const count = await this.prisma.formSubmission.count({
        where: { formVersion: { formId }, answers: { path: [quota.fieldKey], equals: quota.equals } },
      });
      if (count >= quota.limit) {
        throw new AppError('CONFLICT', `This form is no longer accepting responses of that kind`);
      }
    }

    if (settings.oneResponsePerUser && (submittedById || respondentFingerprint)) {
      const existing = await this.prisma.formSubmission.findFirst({
        where: {
          formVersion: { formId },
          OR: [
            ...(submittedById ? [{ submittedById }] : []),
            ...(respondentFingerprint ? [{ respondentFingerprint }] : []),
          ],
        },
        select: { id: true },
      });
      if (existing) {
        throw new AppError('CONFLICT', 'You have already responded to this form');
      }
    }
  }

  /** Validates raw answers, checks file-upload ids actually belong to this form (the
   *  trust boundary compileAnswerValidator can't cover, since it has no DB access), and
   *  computes the quiz score if applicable. Shared by both new submissions and edits. */
  private async validateAndScore(
    formId: string,
    definition: FormDefinition,
    settings: FormSettings,
    rawAnswers: SubmissionAnswers,
  ) {
    let answers: SubmissionAnswers;
    try {
      answers = compileAnswerValidator(definition).validate(rawAnswers);
    } catch (error) {
      if (error instanceof ZodError) {
        throw AppError.validation(error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
      }
      throw error;
    }

    const fileFieldKeys = new Set(definition.fields.filter((f) => f.type === 'file').map((f) => f.key));
    // maxFiles>1 answers are an array of upload ids rather than a single one — flatten either shape
    const uploadIds = Object.entries(answers)
      .filter(([key]) => fileFieldKeys.has(key))
      .flatMap(([, value]) => (Array.isArray(value) ? (value as string[]) : [value as string]));
    if (uploadIds.length) {
      const found = await this.prisma.formFileUpload.findMany({
        where: { id: { in: uploadIds }, formId },
        select: { id: true },
      });
      if (found.length !== uploadIds.length) {
        throw AppError.validation([{ path: 'file', message: 'one or more uploaded files could not be found' }]);
      }
    }

    const score = settings.quizMode ? scoreSubmission(definition, answers, settings.passThresholdPercent) : null;

    return { answers, uploadIds, score };
  }

  private async persist(
    formSlug: string,
    formId: string,
    formVersionId: string,
    definition: FormDefinition,
    settings: FormSettings,
    rawAnswers: SubmissionAnswers,
    submittedById: string | null,
    respondentFingerprint: string | null,
  ) {
    const { answers, uploadIds, score } = await this.validateAndScore(formId, definition, settings, rawAnswers);

    const submission = await this.prisma.formSubmission.create({
      data: {
        formVersionId,
        submittedById,
        respondentFingerprint,
        answers,
        score: score ? (score as unknown as Prisma.InputJsonValue) : undefined,
        editToken: settings.allowRespondentEdit ? randomBytes(24).toString('base64url') : undefined,
      },
    });
    if (settings.webhookUrl) {
      this.fireWebhook(settings.webhookUrl, {
        formSlug,
        submissionId: submission.id,
        answers,
        score,
        createdAt: submission.createdAt,
      });
    }
    if (uploadIds.length) {
      await this.prisma.formFileUpload.updateMany({
        where: { id: { in: uploadIds } },
        data: { submissionId: submission.id },
      });
    }
    await this.applyKpiMappings(formId, definition, answers, submittedById, submission.id);
    return submission;
  }

  /**
   * The Forms→KPI bridge: for every FormKpiMapping on this form, resolves the
   * evaluatee (the answer at evaluateeFieldKey — or, when unset, the
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
  private async applyKpiMappings(
    formId: string,
    definition: FormDefinition,
    answers: SubmissionAnswers,
    enteredById: string | null,
    submissionId: string,
  ): Promise<void> {
    if (!enteredById) return;

    const mappings = await this.prisma.formKpiMapping.findMany({
      where: { formId },
      include: { evaluationArea: true },
    });
    if (!mappings.length) return;

    const fieldsByKey = new Map(definition.fields.map((f) => [f.key, f]));

    for (const mapping of mappings) {
      try {
        await this.applyOneMapping(mapping, fieldsByKey, answers, enteredById, submissionId, new Date());
      } catch (cause) {
        this.logger.warn(
          `form-kpi mapping ${mapping.id} failed for submission ${submissionId}: ${cause instanceof Error ? cause.message : cause}`,
        );
      }
    }
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
  ): Promise<boolean> {
    if (!mapping.evaluationArea.isActive) return false;

    // no evaluateeFieldKey => self-assessment: the submitter scores themselves
    const evaluateeId = mapping.evaluateeFieldKey ? answers[mapping.evaluateeFieldKey] : enteredById;
    if (typeof evaluateeId !== 'string') return false;
    const rawScore = answers[mapping.scoreFieldKey];
    if (rawScore === undefined || rawScore === null) return false;

    const scoreField = fieldsByKey.get(mapping.scoreFieldKey);
    if (!scoreField) return false;
    // Only fetched when actually needed — every other score field type
    // normalizes from the field definition alone, no DB round-trip required.
    const performanceLevels =
      scoreField.type === 'performance_level'
        ? (await this.prisma.performanceLevel.findMany()).map((l) => ({
            id: l.id,
            minScore: Number(l.minScore),
            maxScore: Number(l.maxScore),
          }))
        : undefined;
    const value = normalizeScore(scoreField, rawScore, performanceLevels);
    if (value === null) return false;

    const evaluatee = await this.prisma.user.findUnique({ where: { id: evaluateeId } });
    if (!evaluatee || !evaluatee.isActive) return false;

    const { periodStart, periodEnd } = computePeriod(mapping.evaluationArea.cadence, at);
    const context = mapping.contextFieldKey ? answerToText(answers[mapping.contextFieldKey]) : null;
    const comment = mapping.commentFieldKey ? answerToText(answers[mapping.commentFieldKey]) : null;

    // personId is part of the upsert's own unique key below, so if this same
    // submission previously resolved to a DIFFERENT evaluatee (a mapping that
    // used to be self-assessment and is now evaluatee-based, a changed
    // evaluatee-field answer on a resubmission, or a mapping's evaluatee
    // field being reconfigured before a backfill) the upsert would silently
    // leave that old entry behind under the wrong person instead of moving
    // it — nothing else in this codebase ever cleans that up. Reconcile by
    // submissionId first: this submission owns at most one entry per area.
    const stale = await this.prisma.evaluationAreaEntry.findFirst({
      where: { submissionId, evaluationAreaId: mapping.evaluationAreaId, personId: { not: evaluateeId } },
      select: { id: true },
    });
    if (stale) await this.prisma.evaluationAreaEntry.delete({ where: { id: stale.id } });

    // enteredById is part of the key: one row PER EVALUATOR per period, so a
    // second rater scoring the same person/area/period adds a distinct entry
    // instead of overwriting the first — see EvaluationAreaEntry's schema
    // comment. Only a resubmission by the SAME evaluator (e.g. editing their
    // own response) updates in place.
    await this.prisma.evaluationAreaEntry.upsert({
      where: {
        evaluationAreaId_personId_periodStart_periodEnd_enteredById: {
          evaluationAreaId: mapping.evaluationAreaId,
          personId: evaluateeId,
          periodStart,
          periodEnd,
          enteredById,
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
    return true;
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
  async backfillMapping(formId: string, mappingId: string): Promise<{ scored: number; skipped: number }> {
    const mapping = await this.prisma.formKpiMapping.findFirst({
      where: { id: mappingId, formId },
      include: { evaluationArea: true },
    });
    if (!mapping) throw AppError.notFound('Form KPI mapping', mappingId);

    const form = await this.prisma.form.findUnique({ where: { id: formId } });
    if (!form) throw AppError.notFound('Form', formId);
    const { definition } = await this.forms.getLatestVersion(form.slug);
    const fieldsByKey = new Map(definition.fields.map((f) => [f.key, f]));

    const submissions = await this.prisma.formSubmission.findMany({
      where: { formVersion: { formId } },
      select: { id: true, answers: true, submittedById: true, createdAt: true },
    });

    let scored = 0;
    let skipped = 0;
    for (const submission of submissions) {
      if (!submission.submittedById) {
        skipped++; // same rule as live submissions: anonymous public fills never score
        continue;
      }
      try {
        const didScore = await this.applyOneMapping(
          mapping,
          fieldsByKey,
          submission.answers as SubmissionAnswers,
          submission.submittedById,
          submission.id,
          submission.createdAt,
        );
        if (didScore) scored++;
        else skipped++;
      } catch (cause) {
        skipped++;
        this.logger.warn(
          `backfill of mapping ${mappingId} failed for submission ${submission.id}: ${cause instanceof Error ? cause.message : cause}`,
        );
      }
    }
    return { scored, skipped };
  }

  /** Fire-and-forget: never awaited by callers, never blocks or fails the submission it fires
   *  for. A short timeout keeps a slow/unreachable endpoint from leaking sockets. */
  private fireWebhook(url: string, payload: object): void {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
      .catch((cause) => {
        this.logger.warn(`webhook delivery to ${url} failed: ${cause instanceof Error ? cause.message : cause}`);
      })
      .finally(() => clearTimeout(timeout));
  }

  /** Admin correction: re-validates against the CURRENT version's compiled schema (not the
   *  version the respondent originally submitted against) — editing is a forward-looking fix. */
  async updateSubmission(formSlug: string, submissionId: string, rawAnswers: SubmissionAnswers, actorId: string) {
    const { form, version, definition, settings } = await this.forms.getLatestVersion(formSlug);
    const existing = await this.prisma.formSubmission.findFirst({
      where: { id: submissionId, formVersionId: version.id },
    });
    if (!existing) throw AppError.notFound('Submission', submissionId);

    const { answers, uploadIds, score } = await this.validateAndScore(form.id, definition, settings, rawAnswers);

    const [submission] = await this.prisma.$transaction([
      this.prisma.formSubmission.update({
        where: { id: submissionId },
        data: { answers, score: score ? (score as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId,
          action: 'submission.updated',
          entity: 'FormSubmission',
          entityId: submissionId,
          detail: { formSlug },
        },
      }),
    ]);
    if (uploadIds.length) {
      await this.prisma.formFileUpload.updateMany({
        where: { id: { in: uploadIds } },
        data: { submissionId },
      });
    }
    await this.applyKpiMappings(form.id, definition, answers, existing.submittedById, submissionId);
    return submission;
  }

  /** Paginated list with optional per-field equality filters (JSONB path query). */
  async list(formSlug: string, query: PageQuery, filters: Record<string, string> = {}) {
    const { version } = await this.forms.getLatestVersion(formSlug);

    const { page, pageSize } = resolvePageBounds(query);

    const where = {
      formVersionId: version.id,
      AND: Object.entries(filters).map(([key, value]) => ({
        answers: { path: [key], equals: value },
      })),
    };

    const [totalItems, items] = await this.prisma.$transaction([
      this.prisma.formSubmission.count({ where }),
      this.prisma.formSubmission.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { submittedBy: { select: { id: true, displayName: true, email: true } } },
      }),
    ]);

    return paged(items, buildPaginationMeta(page, pageSize, totalItems));
  }

  /** MS-Forms-style per-question aggregates for the summary dashboard. */
  async summary(formSlug: string): Promise<FormResponseSummary> {
    const { version, definition } = await this.forms.getLatestVersion(formSlug);
    await this.assertSyncReportSizeOk(version.id);
    const submissions = await this.prisma.formSubmission.findMany({
      where: { formVersionId: version.id },
      select: { answers: true, createdAt: true, score: true },
      orderBy: { createdAt: 'asc' },
    });

    const fields: FormFieldSummary[] = definition.fields
      .filter((field) => field.type !== 'section_header') // display-only, never has an answer
      .map((field) => {
        const values = submissions
          .map((s) => (s.answers as SubmissionAnswers)[field.key])
          .filter((v) => v !== undefined && v !== null && v !== '');
        const answered = values.length;
        const base = { key: field.key, label: field.label, type: field.type, answered };

        switch (field.type) {
          case 'select': {
            const counts: Record<string, number> = {};
            for (const v of values as string[]) {
              const key = v.startsWith('other:') ? 'other' : v;
              counts[key] = (counts[key] ?? 0) + 1;
            }
            return { ...base, counts };
          }
          case 'multi_select': {
            const counts: Record<string, number> = {};
            for (const arr of values as string[][])
              for (const v of arr) {
                const key = v.startsWith('other:') ? 'other' : v;
                counts[key] = (counts[key] ?? 0) + 1;
              }
            return { ...base, counts };
          }
          case 'boolean': {
            const yes = (values as boolean[]).filter(Boolean).length;
            return { ...base, counts: { yes, no: answered - yes } };
          }
          case 'rating':
          case 'nps': {
            const nums = values as number[];
            const counts: Record<string, number> = {};
            for (const v of nums) counts[String(v)] = (counts[String(v)] ?? 0) + 1;
            const average = answered ? nums.reduce((a, b) => a + b, 0) / answered : null;
            if (field.type === 'nps' && answered) {
              const promoters = nums.filter((v) => v >= 9).length;
              const detractors = nums.filter((v) => v <= 6).length;
              return {
                ...base,
                counts,
                average,
                npsScore: Math.round(((promoters - detractors) / answered) * 100),
              };
            }
            return { ...base, counts, average };
          }
          case 'number':
          case 'slider': {
            const nums = values as number[];
            return {
              ...base,
              average: answered ? nums.reduce((a, b) => a + b, 0) / answered : null,
              min: answered ? Math.min(...nums) : null,
              max: answered ? Math.max(...nums) : null,
            };
          }
          case 'hot_spot': {
            const counts: Record<string, number> = {};
            for (const v of values as string[]) counts[v] = (counts[v] ?? 0) + 1;
            return { ...base, counts };
          }
          case 'contact_info':
            // a compound name/email/phone answer has no single chartable shape — the
            // headline "answered" count above is the useful signal for this type
            return { ...base };
          case 'likert': {
            // statement → scale-index → count
            const matrix: Record<string, Record<string, number>> = {};
            for (const rec of values as Array<Record<string, number>>)
              for (const [statement, idx] of Object.entries(rec)) {
                matrix[statement] ??= {};
                matrix[statement][String(idx)] = (matrix[statement][String(idx)] ?? 0) + 1;
              }
            return { ...base, matrix, scale: field.scale };
          }
          case 'ranking': {
            // average position per option (1-based; lower = ranked higher)
            const positions: Record<string, number[]> = {};
            for (const order of values as string[][]) order.forEach((v, i) => (positions[v] ??= []).push(i + 1));
            const averagePosition = Object.fromEntries(
              Object.entries(positions).map(([v, arr]) => [v, arr.reduce((a, b) => a + b, 0) / arr.length]),
            );
            return { ...base, averagePosition };
          }
          case 'grid': {
            // row -> column value -> count. `selection: 'multiple'` rows hold a
            // string[] instead of a single string; both flatten into the same matrix.
            const matrix: Record<string, Record<string, number>> = {};
            for (const rec of values as Array<Record<string, string | string[]>>) {
              for (const [row, answer] of Object.entries(rec)) {
                matrix[row] ??= {};
                const columns = Array.isArray(answer) ? answer : [answer];
                for (const col of columns) matrix[row][col] = (matrix[row][col] ?? 0) + 1;
              }
            }
            return { ...base, matrix };
          }
          default: {
            return { ...base, samples: (values as string[]).slice(-5).reverse() };
          }
        }
      });

    const scores = submissions
      .map((s) => s.score as unknown as QuizScore | null | undefined)
      .filter((s): s is QuizScore => s != null && s.percent !== null);
    const quiz = scores.length
      ? {
          averagePercent: Math.round(scores.reduce((a, s) => a + s.percent!, 0) / scores.length),
          ...(scores.every((s) => s.passed !== null)
            ? { passRate: scores.filter((s) => s.passed).length / scores.length }
            : {}),
          distribution: scores.reduce<Record<string, number>>((dist, s) => {
            const bucket = String(Math.round(s.percent! / 10) * 10);
            dist[bucket] = (dist[bucket] ?? 0) + 1;
            return dist;
          }, {}),
        }
      : undefined;

    return {
      responses: submissions.length,
      firstResponseAt: submissions[0]?.createdAt.toISOString() ?? null,
      lastResponseAt: submissions[submissions.length - 1]?.createdAt.toISOString() ?? null,
      fields,
      ...(quiz ? { quiz } : {}),
    };
  }

  async deleteSubmission(formSlug: string, submissionId: string, actorId: string) {
    const { version } = await this.forms.getLatestVersion(formSlug);
    const submission = await this.prisma.formSubmission.findFirst({
      where: { id: submissionId, formVersionId: version.id },
    });
    if (!submission) throw AppError.notFound('Submission', submissionId);

    await this.prisma.$transaction([
      this.prisma.formSubmission.delete({ where: { id: submissionId } }),
      this.prisma.auditLog.create({
        data: {
          actorId,
          action: 'submission.deleted',
          entity: 'FormSubmission',
          entityId: submissionId,
          detail: { formSlug },
        },
      }),
    ]);
    return null;
  }

  /** Bulk-clear every response on the current version (audited, count logged). */
  async deleteAllSubmissions(formSlug: string, actorId: string) {
    const { version } = await this.forms.getLatestVersion(formSlug);
    const { count } = await this.prisma.formSubmission.deleteMany({
      where: { formVersionId: version.id },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'submissions.deleted_all',
        entity: 'Form',
        entityId: formSlug,
        detail: { count },
      },
    });
    return { deleted: count };
  }

  /** CSV export of all submissions for the latest version (audited). */
  async exportCsv(formSlug: string, actorId: string | null): Promise<string> {
    const { header, rows } = await this.buildExportTable(formSlug, actorId);
    return [header, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
  }

  /** Same data as exportCsv, as an .xlsx workbook (audited separately). `actorId` is null for
   *  the token-gated live export link — an anonymous-to-the-DB but still access-controlled pull. */
  async exportXlsx(formSlug: string, actorId: string | null): Promise<Buffer> {
    const { header, rows } = await this.buildExportTable(formSlug, actorId, 'submissions.exported_xlsx');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Responses');
    sheet.addRow(header);
    for (const row of rows) sheet.addRow(row);
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /** See MAX_SUBMISSIONS_FOR_SYNC_REPORT — guards summary()/buildExportTable()
   *  against loading an unbounded submission set into memory in one request. */
  private async assertSyncReportSizeOk(formVersionId: string): Promise<void> {
    const count = await this.prisma.formSubmission.count({ where: { formVersionId } });
    if (count > MAX_SUBMISSIONS_FOR_SYNC_REPORT) {
      throw new AppError(
        'CONFLICT',
        `This form has ${count} responses, above the ${MAX_SUBMISSIONS_FOR_SYNC_REPORT}-response limit for on-demand summaries/exports — this needs a background export job rather than a synchronous request. Contact an administrator.`,
      );
    }
  }

  private async buildExportTable(
    formSlug: string,
    actorId: string | null,
    auditAction = 'submissions.exported',
  ): Promise<{ header: string[]; rows: string[][] }> {
    const { version, definition } = await this.forms.getLatestVersion(formSlug);
    await this.assertSyncReportSizeOk(version.id);
    const submissions = await this.prisma.formSubmission.findMany({
      where: { formVersionId: version.id },
      orderBy: { createdAt: 'asc' },
      include: { submittedBy: { select: { email: true } } },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: auditAction,
        entity: 'Form',
        entityId: formSlug,
        detail: { count: submissions.length },
      },
    });

    const keys = definition.fields.map((f) => f.key);
    const header = ['submitted_at', 'submitted_by', ...keys];
    const rows = submissions.map((s) => {
      const answers = s.answers as SubmissionAnswers;
      return [
        s.createdAt.toISOString(),
        s.submittedBy?.email ?? 'anonymous',
        ...keys.map((k) => serializeCsvCell(answers[k])),
      ];
    });
    return { header, rows };
  }
}

/** Normalizes a raw answer to a 0-5 KPI score using that field's own configured
 *  range/options. Returns null for a degenerate (zero-width, single-option) range,
 *  an answer shape that doesn't match the field type, an unrecognized option value
 *  (including a free-text "other:" answer — no fixed position to score), an
 *  unrecognized performance_level id, or a field type with no well-defined
 *  numeric interpretation at all (short_text, long_text, date, time, file,
 *  contact_info, hot_spot, person, ranking, grid, section_header).
 *
 *  `performanceLevels` is only needed (and only fetched by the caller) when
 *  `field.type === 'performance_level'` — every other case normalizes purely
 *  from the field definition. */
function normalizeScore(
  field: FormField,
  raw: SubmissionAnswers[string],
  performanceLevels?: Array<{ id: string; minScore: number; maxScore: number }>,
): number | null {
  switch (field.type) {
    case 'rating': {
      if (typeof raw !== 'number' || field.scale <= 1) return null;
      return clamp(((raw - 1) / (field.scale - 1)) * 5, 0, 5);
    }
    case 'nps':
      if (typeof raw !== 'number') return null;
      return clamp((raw / 10) * 5, 0, 5);
    case 'slider': {
      if (typeof raw !== 'number') return null;
      const range = field.max - field.min;
      if (range <= 0) return null;
      return clamp(((raw - field.min) / range) * 5, 0, 5);
    }
    case 'number': {
      if (typeof raw !== 'number') return null;
      // With a configured range, normalize against it like a slider; without one,
      // treat the raw value as already meant to sit on a 0-5 scale and just clamp.
      if (field.min !== undefined && field.max !== undefined) {
        const range = field.max - field.min;
        if (range <= 0) return null;
        return clamp(((raw - field.min) / range) * 5, 0, 5);
      }
      return clamp(raw, 0, 5);
    }
    case 'boolean':
      if (typeof raw !== 'boolean') return null;
      return raw ? 5 : 0;
    case 'select': {
      if (typeof raw !== 'string' || raw.startsWith('other:') || field.options.length <= 1) return null;
      const index = field.options.findIndex((o) => o.value === raw);
      if (index === -1) return null;
      return clamp((index / (field.options.length - 1)) * 5, 0, 5);
    }
    case 'multi_select': {
      if (!Array.isArray(raw) || field.options.length === 0) return null;
      return clamp((raw.length / field.options.length) * 5, 0, 5);
    }
    case 'likert': {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || field.scale.length <= 1) return null;
      const indices = Object.values(raw).filter((v): v is number => typeof v === 'number');
      if (indices.length === 0) return null;
      const average = indices.reduce((sum, v) => sum + v, 0) / indices.length;
      return clamp((average / (field.scale.length - 1)) * 5, 0, 5);
    }
    case 'performance_level': {
      if (typeof raw !== 'string' || !performanceLevels) return null;
      const level = performanceLevels.find((l) => l.id === raw);
      if (!level) return null;
      return clamp((level.minScore + level.maxScore) / 2, 0, 5);
    }
    default:
      return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Renders any answer shape (string, number, boolean, array, or a likert
 *  index map) as display text for a mapping's context/comment snapshot —
 *  these fields are read verbatim, not type-checked against a field type,
 *  since a context field can legitimately be any question type. */
function answerToText(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (Array.isArray(raw)) return raw.map((v) => String(v)).join(', ');
  return JSON.stringify(raw);
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

function serializeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join('; ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function escapeCsv(cell: string): string {
  return /[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}
