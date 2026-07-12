import { z } from 'zod';
import { EvaluationAreaCadence } from './kpi';

/**
 * Maps a form to a KPI Evaluation Area: one field supplies the score. On
 * every submission, SubmissionsService normalizes that field's answer to
 * 0-5 and upserts an EvaluationAreaEntry — this is the bridge that lets a
 * QA evaluation survey actually produce KPI scores instead of sitting next
 * to them unconnected. Every type in SCORE_FIELD_TYPES has a well-defined
 * normalization (see submissions.service.ts's normalizeScore):
 * rating/nps/slider/number scale by their own configured range, boolean is
 * no=0/yes=5, select scores by the chosen option's position in the list,
 * multi_select by the fraction of options selected, likert by the average
 * statement position, and performance_level by the midpoint of the chosen
 * level's own configured score range. Every other type (short_text,
 * long_text, date, time, file, contact_info, hot_spot, person, ranking,
 * grid, section_header) has no numeric interpretation and can't be a score
 * field.
 *
 * `evaluateeFieldKey` optionally names a field whose answer is the
 * evaluatee's user id (a 'person' field, from an older form that still has
 * one). Omitted — the normal case now — means self-assessment: the
 * submitter scores themselves.
 *
 * Deliberately out of scope for this pass: more than one mapping per
 * (form, evaluationArea) pair.
 */

export const SCORE_FIELD_TYPES = [
  'rating',
  'nps',
  'slider',
  'number',
  'boolean',
  'select',
  'multi_select',
  'likert',
  'performance_level',
] as const;
export type ScoreFieldType = (typeof SCORE_FIELD_TYPES)[number];

/** Who a mapping's scores come from, relative to the evaluatee. Drives the
 *  dashboard's per-type breakdown and is copied onto every entry it produces. */
export const REVIEW_TYPES = ['self', 'peer', 'manager', '360'] as const;
export type ReviewType = (typeof REVIEW_TYPES)[number];

export const createFormKpiMappingSchema = z.object({
  evaluationAreaId: z.string().uuid(),
  evaluateeFieldKey: z.string().min(1).max(64).optional(),
  scoreFieldKey: z.string().min(1).max(64),
  reviewType: z.enum(REVIEW_TYPES).default('peer'),
  /** Withholds the evaluator's identity from anyone without kpis:manage
   *  when reading entries this mapping produces — for honest peer/360 input. */
  anonymous: z.boolean().default(false),
  /** Extra form field snapshotted onto each entry as free-text context,
   *  e.g. the evaluatee's level — any field type, read as its raw answer. */
  contextFieldKey: z.string().min(1).max(64).optional(),
  /** Extra form field (normally long_text) snapshotted onto each entry as
   *  its qualitative comment. */
  commentFieldKey: z.string().min(1).max(64).optional(),
});

export type CreateFormKpiMappingInput = z.infer<typeof createFormKpiMappingSchema>;

export interface FormKpiMapping {
  id: string;
  formId: string;
  evaluationAreaId: string;
  evaluateeFieldKey: string | null;
  scoreFieldKey: string;
  reviewType: ReviewType;
  anonymous: boolean;
  contextFieldKey: string | null;
  commentFieldKey: string | null;
  createdAt: string;
}

/** FormKpiMappingsService.list()'s row shape — a FormKpiMapping with its
 *  Evaluation Area's display fields joined in, so the mappings panel doesn't
 *  need a second round-trip to show what each mapping links to. Only list()
 *  returns this — create()/bulkCreate() return plain FormKpiMapping rows. */
export interface FormKpiMappingWithArea extends FormKpiMapping {
  evaluationArea: { id: string; name: string; kpiId: string; cadence: EvaluationAreaCadence };
}

/**
 * Bulk variant: one shared evaluatee field (or none — self-assessment),
 * review type, anonymity setting, and optional context/comment field (a form
 * only ever represents one review relationship at a time) paired with many
 * (scoreFieldKey, evaluationAreaId) pairs — the shape a large multi-question
 * evaluation form actually needs, instead of repeating
 * createFormKpiMappingSchema's single-pair call once per question. Partial
 * success is expected, not exceptional: a row whose Evaluation Area is
 * already mapped on this form is skipped, not fatal to the rest of the
 * batch — see BulkCreateFormKpiMappingResult.
 */
export const bulkCreateFormKpiMappingSchema = z.object({
  evaluateeFieldKey: z.string().min(1).max(64).optional(),
  reviewType: z.enum(REVIEW_TYPES).default('peer'),
  anonymous: z.boolean().default(false),
  contextFieldKey: z.string().min(1).max(64).optional(),
  commentFieldKey: z.string().min(1).max(64).optional(),
  mappings: z
    .array(
      z.object({
        evaluationAreaId: z.string().uuid(),
        scoreFieldKey: z.string().min(1).max(64),
      }),
    )
    .min(1)
    .max(200),
});

export type BulkCreateFormKpiMappingInput = z.infer<typeof bulkCreateFormKpiMappingSchema>;

export interface BulkCreateFormKpiMappingResult {
  created: FormKpiMapping[];
  skipped: Array<{ evaluationAreaId: string; reason: string }>;
}

/** Result of re-running a mapping against submissions that predate it —
 *  see FormKpiMappingsService.backfill. */
export interface BackfillResult {
  scored: number;
  skipped: number;
}
