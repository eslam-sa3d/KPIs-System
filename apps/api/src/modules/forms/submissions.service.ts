import { Injectable } from '@nestjs/common';
import {
  FormDefinition,
  FormFieldSummary,
  FormResponseSummary,
  FormSettings,
  PAGE_DEFAULTS,
  PageQuery,
  SubmissionAnswers,
  buildPaginationMeta,
} from '@pulse/contracts';
import { ZodError } from 'zod';
import ExcelJS from 'exceljs';
import { AppError } from '../../common/app-error';
import { paged } from '../../common/envelope.interceptor';
import { PrismaService } from '../../infra/prisma.service';
import { compileAnswerValidator } from './answer-validator';
import { FormsService } from './forms.service';

/**
 * Submission engine: validates answers against the form version's compiled
 * schema, enforces the form's collection settings, persists, and serves the
 * list / summary / export views.
 */
@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly forms: FormsService,
  ) {}

  async submit(formSlug: string, rawAnswers: SubmissionAnswers, submittedById: string) {
    const { form, version, definition, settings } = await this.forms.getLatestVersion(formSlug);
    await this.enforceSettings(form.id, settings, submittedById, null);
    return this.persist(form.id, version.id, definition, rawAnswers, submittedById, null);
  }

  /** Anonymous submission via a public share link. `respondentFingerprint` is a random id the
   *  controller stores in a cookie — the only "identity" an anonymous filler has. */
  async submitPublic(token: string, rawAnswers: SubmissionAnswers, respondentFingerprint: string | null) {
    const { form, version, definition, settings } = await this.forms.getByPublicToken(token);
    await this.enforceSettings(form.id, settings, null, respondentFingerprint);
    return this.persist(form.id, version.id, definition, rawAnswers, null, respondentFingerprint);
  }

  private async enforceSettings(
    formId: string,
    settings: FormSettings,
    submittedById: string | null,
    respondentFingerprint: string | null,
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

  private async persist(
    formId: string,
    formVersionId: string,
    definition: FormDefinition,
    rawAnswers: SubmissionAnswers,
    submittedById: string | null,
    respondentFingerprint: string | null,
  ) {
    let answers: SubmissionAnswers;
    try {
      answers = compileAnswerValidator(definition).validate(rawAnswers);
    } catch (error) {
      if (error instanceof ZodError) {
        throw AppError.validation(
          error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        );
      }
      throw error;
    }

    // file answers are opaque upload ids — confirm they were actually
    // uploaded for THIS form before trusting them (the trust boundary
    // compileAnswerValidator can't cover, since it has no DB access)
    const fileFieldKeys = new Set(definition.fields.filter((f) => f.type === 'file').map((f) => f.key));
    const uploadIds = Object.entries(answers)
      .filter(([key]) => fileFieldKeys.has(key))
      .map(([, value]) => value as string);
    if (uploadIds.length) {
      const found = await this.prisma.formFileUpload.findMany({
        where: { id: { in: uploadIds }, formId },
        select: { id: true },
      });
      if (found.length !== uploadIds.length) {
        throw AppError.validation([{ path: 'file', message: 'one or more uploaded files could not be found' }]);
      }
    }

    const submission = await this.prisma.formSubmission.create({
      data: { formVersionId, submittedById, respondentFingerprint, answers },
    });
    if (uploadIds.length) {
      await this.prisma.formFileUpload.updateMany({
        where: { id: { in: uploadIds } },
        data: { submissionId: submission.id },
      });
    }
    return submission;
  }

  /** Paginated list with optional per-field equality filters (JSONB path query). */
  async list(formSlug: string, query: PageQuery, filters: Record<string, string> = {}) {
    const { version } = await this.forms.getLatestVersion(formSlug);

    const page = Math.max(Number(query.page ?? PAGE_DEFAULTS.page), 1);
    const pageSize = Math.min(
      Number(query.pageSize ?? PAGE_DEFAULTS.pageSize),
      PAGE_DEFAULTS.maxPageSize,
    );

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
    const submissions = await this.prisma.formSubmission.findMany({
      where: { formVersionId: version.id },
      select: { answers: true, createdAt: true },
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
            for (const v of arr) counts[v] = (counts[v] ?? 0) + 1;
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
        case 'number': {
          const nums = values as number[];
          return {
            ...base,
            average: answered ? nums.reduce((a, b) => a + b, 0) / answered : null,
            min: answered ? Math.min(...nums) : null,
            max: answered ? Math.max(...nums) : null,
          };
        }
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
          for (const order of values as string[][])
            order.forEach((v, i) => (positions[v] ??= []).push(i + 1));
          const averagePosition = Object.fromEntries(
            Object.entries(positions).map(([v, arr]) => [
              v,
              arr.reduce((a, b) => a + b, 0) / arr.length,
            ]),
          );
          return { ...base, averagePosition };
        }
        default: {
          return { ...base, samples: (values as string[]).slice(-5).reverse() };
        }
      }
    });

    return {
      responses: submissions.length,
      firstResponseAt: submissions[0]?.createdAt.toISOString() ?? null,
      lastResponseAt: submissions[submissions.length - 1]?.createdAt.toISOString() ?? null,
      fields,
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
  async exportCsv(formSlug: string, actorId: string): Promise<string> {
    const { header, rows } = await this.buildExportTable(formSlug, actorId);
    return [header, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
  }

  /** Same data as exportCsv, as an .xlsx workbook (audited separately). */
  async exportXlsx(formSlug: string, actorId: string): Promise<Buffer> {
    const { header, rows } = await this.buildExportTable(formSlug, actorId, 'submissions.exported_xlsx');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Responses');
    sheet.addRow(header);
    for (const row of rows) sheet.addRow(row);
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private async buildExportTable(
    formSlug: string,
    actorId: string,
    auditAction = 'submissions.exported',
  ): Promise<{ header: string[]; rows: string[][] }> {
    const { version, definition } = await this.forms.getLatestVersion(formSlug);
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

function serializeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join('; ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function escapeCsv(cell: string): string {
  return /[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}
