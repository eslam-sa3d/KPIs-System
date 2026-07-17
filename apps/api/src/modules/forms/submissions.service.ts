import { Injectable, Logger } from '@nestjs/common';
import {
  FormDefinition,
  FormSettings,
  PageQuery,
  SubmissionAnswers,
  buildPaginationMeta,
  resolvePageBounds,
} from '@pulse/contracts';
import { ZodError, z } from 'zod';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AppError } from '../../common/app-error';
import { paged } from '../../common/envelope.interceptor';
import { PrismaService } from '../../infra/prisma.service';
import { compileAnswerValidator } from './answer-validator';
import { FormKpiScoringService } from './form-kpi-scoring.service';
import { FormsService } from './forms.service';
import { scoreSubmission } from './quiz-scoring';
import { TurnstileService } from './turnstile.service';

/**
 * Submission engine: validates answers against the form version's compiled
 * schema, enforces the form's collection settings, persists, and serves the
 * list view. Scoring against KPI mappings is delegated to
 * FormKpiScoringService; summary/export aggregate reads live in
 * SubmissionReportingService.
 */
@Injectable()
export class SubmissionsService {
  private readonly logger = new Logger(SubmissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly forms: FormsService,
    private readonly turnstile: TurnstileService,
    private readonly kpiScoring: FormKpiScoringService,
  ) {}

  async submit(formSlug: string, rawAnswers: SubmissionAnswers, submittedById: string) {
    const { form, version, definition, settings } = await this.forms.getLatestVersion(formSlug);
    await this.enforceSettings(form.id, settings, submittedById, null, rawAnswers);
    return this.persist(form.slug, form.id, version.id, definition, settings, rawAnswers, submittedById, null);
  }

  /** Anonymous submission via a public share link. `respondentFingerprint` is a random id the
   *  controller stores in a cookie — the only "identity" an anonymous filler has.
   *  `respondentName`/`respondentEmail` come from the pre-form gate screen (see
   *  assertRespondentInfoAllowed) — undefined when the form's requireRespondentInfo
   *  setting is off, since the gate never showed. */
  async submitPublic(
    token: string,
    rawAnswers: SubmissionAnswers,
    respondentFingerprint: string | null,
    turnstileToken?: string,
    respondentName?: string,
    respondentEmail?: string,
  ) {
    const { form, version, definition, settings } = await this.forms.getByPublicToken(token);
    await this.turnstile.verify(settings.requireCaptcha, turnstileToken);
    this.assertRespondentInfoAllowed(
      settings.requireRespondentInfo,
      settings.allowedEmailDomains,
      respondentName,
      respondentEmail,
    );
    await this.enforceSettings(form.id, settings, null, respondentFingerprint, rawAnswers);
    return this.persist(
      form.slug,
      form.id,
      version.id,
      definition,
      settings,
      rawAnswers,
      null,
      respondentFingerprint,
      respondentName,
      respondentEmail,
    );
  }

  /** Enforces the pre-form gate: when the form requires it, a non-empty name and a
   *  domain-allowed email must both be present — checked server-side regardless of
   *  what the gate screen already validated client-side, since that's only a UX
   *  convenience, not a trust boundary. `allowedDomains` is this form's own
   *  settings.allowedEmailDomains — empty means unrestricted. No-op when the
   *  requireRespondentInfo setting is off. */
  private assertRespondentInfoAllowed(
    required: boolean,
    allowedDomains: string[],
    respondentName: string | undefined,
    respondentEmail: string | undefined,
  ) {
    if (!required) return;
    const name = respondentName?.trim();
    if (!name) throw AppError.validation([{ path: 'respondentName', message: 'name is required' }]);

    const email = respondentEmail?.trim();
    if (!email || !z.string().email().safeParse(email).success) {
      throw AppError.validation([{ path: 'respondentEmail', message: 'enter a valid email address' }]);
    }
    const emailDomain = email.split('@')[1]?.toLowerCase();
    if (allowedDomains.length > 0 && !allowedDomains.includes(emailDomain ?? '')) {
      const domains = allowedDomains.map((d) => `@${d}`).join(', ');
      throw AppError.validation([
        { path: 'respondentEmail', message: `email must be from an approved domain (${domains})` },
      ]);
    }
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
    await this.kpiScoring.applyKpiMappings(form.id, definition, answers, existing.submittedById, submission.id);
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
    respondentName?: string,
    respondentEmail?: string,
  ) {
    const { answers, uploadIds, score } = await this.validateAndScore(formId, definition, settings, rawAnswers);

    const submission = await this.prisma.formSubmission.create({
      data: {
        formVersionId,
        submittedById,
        respondentFingerprint,
        respondentName: respondentName?.trim() || null,
        respondentEmail: respondentEmail?.trim() || null,
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
    await this.kpiScoring.applyKpiMappings(formId, definition, answers, submittedById, submission.id);
    return submission;
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
   *  version the respondent originally submitted against) — editing is a forward-looking fix.
   *  The submission itself can be from any version — list() surfaces every version's
   *  submissions (see its own comment), so this lookup isn't limited to the latest one either. */
  async updateSubmission(formSlug: string, submissionId: string, rawAnswers: SubmissionAnswers, actorId: string) {
    const { form, definition, settings } = await this.forms.getLatestVersion(formSlug);
    const existing = await this.prisma.formSubmission.findFirst({
      where: { id: submissionId, formVersion: { formId: form.id } },
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
    await this.kpiScoring.applyKpiMappings(form.id, definition, answers, existing.submittedById, submissionId);
    return submission;
  }

  /** Paginated list with optional per-field equality filters (JSONB path query).
   *  Spans every version of the form, not just the latest — publishing an
   *  edit creates a new FormVersion (see FormsService.publishNewVersion) so
   *  that historical submissions keep validating against the schema they
   *  were created with; scoping this list to only the latest version's id
   *  would make every submission from before the most recent edit vanish
   *  from this view even though the rows are untouched in the database. */
  async list(formSlug: string, query: PageQuery, filters: Record<string, string> = {}) {
    const { form } = await this.forms.getLatestVersion(formSlug);

    const { page, pageSize } = resolvePageBounds(query);

    const where = {
      formVersion: { formId: form.id },
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

  async deleteSubmission(formSlug: string, submissionId: string, actorId: string) {
    // Scoped by form, not just the latest version — list() now surfaces
    // submissions from every version (see its own comment), so a delete
    // request for an older-version row must be able to find it too.
    const { form } = await this.forms.getLatestVersion(formSlug);
    const submission = await this.prisma.formSubmission.findFirst({
      where: { id: submissionId, formVersion: { formId: form.id } },
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
}
