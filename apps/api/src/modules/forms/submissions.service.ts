import { Injectable } from '@nestjs/common';
import { PAGE_DEFAULTS, PageQuery, SubmissionAnswers, buildPaginationMeta } from '@pulse/contracts';
import { ZodError } from 'zod';
import { AppError } from '../../common/app-error';
import { paged } from '../../common/envelope.interceptor';
import { PrismaService } from '../../infra/prisma.service';
import { compileAnswerValidator } from './answer-validator';
import { FormsService } from './forms.service';

/**
 * Submission engine: validates answers against the form version's compiled
 * schema, persists them, and serves the aggregate list/export views.
 */
@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly forms: FormsService,
  ) {}

  async submit(formSlug: string, rawAnswers: SubmissionAnswers, submittedById: string) {
    const { version, definition } = await this.forms.getLatestVersion(formSlug);

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

    return this.prisma.formSubmission.create({
      data: { formVersionId: version.id, submittedById, answers },
    });
  }

  /** Paginated list with optional per-field equality filters (JSONB path query). */
  async list(formSlug: string, query: PageQuery, filters: Record<string, string> = {}) {
    const { version } = await this.forms.getLatestVersion(formSlug);

    const page = Math.max(query.page ?? PAGE_DEFAULTS.page, 1);
    const pageSize = Math.min(query.pageSize ?? PAGE_DEFAULTS.pageSize, PAGE_DEFAULTS.maxPageSize);

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

  /** CSV export of all submissions for the latest version (audited). */
  async exportCsv(formSlug: string, actorId: string): Promise<string> {
    const { version, definition } = await this.forms.getLatestVersion(formSlug);
    const submissions = await this.prisma.formSubmission.findMany({
      where: { formVersionId: version.id },
      orderBy: { createdAt: 'asc' },
      include: { submittedBy: { select: { email: true } } },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId,
        action: 'submissions.exported',
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
        s.submittedBy.email,
        ...keys.map((k) => serializeCsvCell(answers[k])),
      ];
    });
    return [header, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
  }
}

function serializeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join('; ');
  return String(value);
}

function escapeCsv(cell: string): string {
  return /[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}
