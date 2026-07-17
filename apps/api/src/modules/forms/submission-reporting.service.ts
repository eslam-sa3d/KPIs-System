import { Injectable } from '@nestjs/common';
import { FormField, FormFieldSummary, FormResponseSummary, SubmissionAnswers } from '@pulse/contracts';
import ExcelJS from 'exceljs';
import { PrismaService } from '../../infra/prisma.service';
import { FormsService } from './forms.service';
import { QuizScore } from './quiz-scoring';
import { assertSyncReportSizeOk } from './submission-size-guard';

/** Detects a raw User id stored where a display name is expected — a 'person' field's
 *  answer always matches; some forms also store a per-area evaluatee id in an ordinary
 *  text field, so this is checked against every field, not just ones typed 'person'. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * MS-Forms-style aggregate reads over a form's submissions: the per-question
 * summary dashboard and CSV/xlsx exports. Both load every matching
 * submission into memory and reduce client-side — see
 * submission-size-guard.ts for why, and the shared size cap that guards it.
 */
@Injectable()
export class SubmissionReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly forms: FormsService,
  ) {}

  /** Context/metadata questions (evaluation type, period, respondent's own role) carry
   *  no meaningful response distribution — every submission answers them the same
   *  routine way, so a chart card is just noise next to the actual evaluation questions.
   *  Matched with whitespace collapsed so incidental spacing differences around the
   *  parenthetical example (e.g. "Q2 , H1" vs "Q2, H1") don't slip past the filter. */
  private static readonly SUMMARY_EXCLUDED_LABELS = new Set(
    ['evaluation type', 'period (e.g., q2, h1, annual 2026)', 'your role'].map(normalizeLabel),
  );

  /** MS-Forms-style per-question aggregates for the summary dashboard.
   *  `userId` optionally narrows every aggregate to only the submissions that
   *  name that person as the answer to ANY question — not just a dedicated
   *  'person' field, since one submission on a form like a QC checklist can
   *  name several different people across several different questions. */
  async summary(formSlug: string, userId?: string): Promise<FormResponseSummary> {
    const { version, definition } = await this.forms.getLatestVersion(formSlug);
    await assertSyncReportSizeOk(this.prisma, { formVersionId: version.id });
    const allSubmissions = await this.prisma.formSubmission.findMany({
      where: { formVersionId: version.id },
      select: { answers: true, createdAt: true, score: true },
      orderBy: { createdAt: 'asc' },
    });

    // 'person' answers are a User's id, not a displayable string — resolve every
    // one referenced by this form's submissions in one batch instead of N+1. Also
    // scan every OTHER field's raw values (including inside multi_select/ranking
    // arrays, where a "link to a user" option stores that user's id as its value)
    // for a UUID shape: some forms store a per-area evaluatee id in an ordinary
    // text field rather than a dedicated 'person' field, and those need the same
    // name resolution to avoid leaking a raw user id into a summary card. This
    // scan is always over the FULL, unfiltered submission set — `respondents`
    // below is meant to stay the complete filter-dropdown option list even once
    // `userId` narrows everything else in this response.
    const personFieldKeys = new Set(definition.fields.filter((f) => f.type === 'person').map((f) => f.key));
    const candidateIds = new Set<string>();
    for (const s of allSubmissions) {
      const answers = s.answers as SubmissionAnswers;
      for (const field of definition.fields) {
        const v = answers[field.key];
        if (typeof v === 'string' && v && (personFieldKeys.has(field.key) || UUID_PATTERN.test(v))) {
          candidateIds.add(v);
        } else if (Array.isArray(v)) {
          for (const item of v) if (typeof item === 'string' && UUID_PATTERN.test(item)) candidateIds.add(item);
        }
      }
    }
    const personNames = candidateIds.size
      ? new Map(
          (
            await this.prisma.user.findMany({
              where: { id: { in: [...candidateIds] } },
              select: { id: true, displayName: true },
            })
          ).map((u) => [u.id, u.displayName]),
        )
      : new Map<string, string>();
    const respondents = [...personNames]
      .map(([id, displayName]) => ({ id, displayName }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    const submissions = userId
      ? allSubmissions.filter((s) => {
          const answers = s.answers as SubmissionAnswers;
          return Object.values(answers).some((v) => v === userId || (Array.isArray(v) && v.includes(userId)));
        })
      : allSubmissions;

    // performance_level answers store a PerformanceLevel id — fetched lazily,
    // same rule as normalizeScore/describeAnswer, only when this form
    // actually has one of these fields.
    const needsPerformanceLevels = definition.fields.some((f) => f.type === 'performance_level');
    const performanceLevels = needsPerformanceLevels
      ? await this.prisma.performanceLevel.findMany({ select: { id: true, label: true } })
      : [];
    // score_label answers store a ScoreLabel id — same lazy-fetch rule.
    const needsScoreLabels = definition.fields.some((f) => f.type === 'score_label');
    const scoreLabels = needsScoreLabels
      ? await this.prisma.scoreLabel.findMany({ select: { id: true, label: true } })
      : [];

    const fields: FormFieldSummary[] = definition.fields
      .filter((field) => field.type !== 'section_header') // display-only, never has an answer
      .filter((field) => !SubmissionReportingService.SUMMARY_EXCLUDED_LABELS.has(normalizeLabel(field.label)))
      .map((field) => {
        const values = submissions
          .map((s) => (s.answers as SubmissionAnswers)[field.key])
          .filter((v) => v !== undefined && v !== null && v !== '');
        const answered = values.length;
        const base = {
          key: field.key,
          label: field.label,
          type: field.type,
          answered,
          optionLabels: optionLabelsFor(field, performanceLevels, scoreLabels),
        };

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
          case 'person': {
            const names = (values as string[]).map((id) => personNames.get(id) ?? '(deleted user)');
            return { ...base, samples: names.slice(-5).reverse() };
          }
          case 'performance_level':
          case 'score_label': {
            // same counts-by-raw-value shape as 'select' — optionLabels (built
            // with performanceLevels/scoreLabels above) resolves each id to its label.
            const counts: Record<string, number> = {};
            for (const v of values as string[]) counts[v] = (counts[v] ?? 0) + 1;
            return { ...base, counts };
          }
          default: {
            // A UUID-shaped answer in a non-'person' field is still, in practice, someone's
            // id (see the candidateIds scan above) — resolve it the same way rather than
            // showing the raw id just because this field wasn't built as a dedicated picker.
            const samples = (values as string[]).map((v) => (UUID_PATTERN.test(v) ? (personNames.get(v) ?? v) : v));
            return { ...base, samples: samples.slice(-5).reverse() };
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
      respondents,
    };
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

  private async buildExportTable(
    formSlug: string,
    actorId: string | null,
    auditAction = 'submissions.exported',
  ): Promise<{ header: string[]; rows: string[][] }> {
    const { version, definition } = await this.forms.getLatestVersion(formSlug);
    await assertSyncReportSizeOk(this.prisma, { formVersionId: version.id });
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

    // Same batch id -> displayName resolution as summary() — an exported 'person'
    // answer (or a UUID-shaped answer in any other field) should read as who was
    // picked, not the User row's opaque id.
    const personFieldKeys = new Set(definition.fields.filter((f) => f.type === 'person').map((f) => f.key));
    const candidateIds = new Set<string>();
    for (const s of submissions) {
      const answers = s.answers as SubmissionAnswers;
      for (const field of definition.fields) {
        const v = answers[field.key];
        if (typeof v !== 'string' || !v) continue;
        if (personFieldKeys.has(field.key) || UUID_PATTERN.test(v)) candidateIds.add(v);
      }
    }
    const personNames = candidateIds.size
      ? new Map(
          (
            await this.prisma.user.findMany({
              where: { id: { in: [...candidateIds] } },
              select: { id: true, displayName: true },
            })
          ).map((u) => [u.id, u.displayName]),
        )
      : new Map<string, string>();

    // performance_level/score_label answers store a PerformanceLevel/ScoreLabel id, and
    // select/multi_select/ranking options built via the "link to a user" picker store
    // that user's id AS the option value — same resolution as summary(), reused here
    // so an export doesn't leak any of these raw ids.
    const needsPerformanceLevels = definition.fields.some((f) => f.type === 'performance_level');
    const performanceLevels = needsPerformanceLevels
      ? await this.prisma.performanceLevel.findMany({ select: { id: true, label: true } })
      : [];
    const needsScoreLabels = definition.fields.some((f) => f.type === 'score_label');
    const scoreLabels = needsScoreLabels
      ? await this.prisma.scoreLabel.findMany({ select: { id: true, label: true } })
      : [];
    const optionLabelsByKey = new Map(
      definition.fields.map((f) => [f.key, optionLabelsFor(f, performanceLevels, scoreLabels)]),
    );

    const keys = definition.fields.map((f) => f.key);
    const header = ['submitted_at', 'submitted_by', 'respondent_name', 'respondent_email', ...keys];
    const rows = submissions.map((s) => {
      const answers = s.answers as SubmissionAnswers;
      return [
        s.createdAt.toISOString(),
        s.submittedBy?.email ?? 'anonymous',
        s.respondentName ?? '',
        s.respondentEmail ?? '',
        ...keys.map((k) => {
          const v = answers[k];
          const optionLabels = optionLabelsByKey.get(k);
          if (optionLabels) {
            if (Array.isArray(v)) return (v as string[]).map((item) => optionLabels[item] ?? item).join('; ');
            if (typeof v === 'string') return optionLabels[v] ?? v;
          }
          if (personFieldKeys.has(k)) return personNames.get(v as string) ?? (v ? '(deleted user)' : '');
          if (typeof v === 'string' && UUID_PATTERN.test(v)) return personNames.get(v) ?? v;
          if (Array.isArray(v)) {
            return (v as unknown[])
              .map((item) =>
                typeof item === 'string' && UUID_PATTERN.test(item) ? (personNames.get(item) ?? item) : item,
              )
              .join('; ');
          }
          return serializeCsvCell(v);
        }),
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

/** All whitespace stripped, not just collapsed — "Q2 , H1" and "Q2, H1" must
 *  compare equal, and this is only ever used for exact-match lookups, never displayed. */
function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, '');
}

/** value -> label for every field type whose summary() case above keys its
 *  counts/matrix/averagePosition by a raw stored value — a select option
 *  built via the form builder's "link to a user" picker stores that user's
 *  id AS the value (see apps/web's field-transforms.ts), so this is what
 *  lets FormFieldSummary.optionLabels resolve it back to a name. Returns
 *  undefined for field types with nothing to resolve. `performanceLevels`/
 *  `scoreLabels` are only consulted for a 'performance_level'/'score_label'
 *  field respectively — their options live in the global PerformanceLevel/
 *  ScoreLabel tables, not the field definition itself, unlike every other
 *  case here. */
function optionLabelsFor(
  field: FormField,
  performanceLevels: Array<{ id: string; label: string }>,
  scoreLabels: Array<{ id: string; label: string }> = [],
): Record<string, string> | undefined {
  switch (field.type) {
    case 'select':
    case 'multi_select':
    case 'ranking':
      return Object.fromEntries(field.options.map((o) => [o.value, o.label]));
    case 'likert':
      return Object.fromEntries(field.statements.map((s) => [s.value, s.label]));
    case 'grid':
      return Object.fromEntries([...field.rows, ...field.columns].map((o) => [o.value, o.label]));
    case 'hot_spot':
      return Object.fromEntries(field.regions.map((r) => [r.value, r.label]));
    case 'performance_level':
      return Object.fromEntries(performanceLevels.map((l) => [l.id, l.label]));
    case 'score_label':
      return Object.fromEntries(scoreLabels.map((l) => [l.id, l.label]));
    default:
      return undefined;
  }
}
