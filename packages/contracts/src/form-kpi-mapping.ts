import { z } from 'zod';

/**
 * Maps a form to a KPI Evaluation Area: one field supplies the evaluatee
 * (a 'person' field), another supplies the score (rating/nps/slider — the
 * only types with a well-defined numeric range to normalize to 0-5). On
 * every submission, SubmissionsService resolves both and upserts an
 * EvaluationAreaEntry — this is the bridge that lets a QA evaluation survey
 * actually produce KPI scores instead of sitting next to them unconnected.
 *
 * Deliberately out of scope for this pass: 'likert'/'number' as score fields
 * (no well-defined bounds to normalize against), and more than one mapping
 * per (form, evaluationArea) pair.
 */

export const SCORE_FIELD_TYPES = ['rating', 'nps', 'slider'] as const;
export type ScoreFieldType = (typeof SCORE_FIELD_TYPES)[number];

/** Who a mapping's scores come from, relative to the evaluatee. Drives the
 *  dashboard's per-type breakdown and is copied onto every entry it produces. */
export const REVIEW_TYPES = ['self', 'peer', 'manager', '360'] as const;
export type ReviewType = (typeof REVIEW_TYPES)[number];

export const createFormKpiMappingSchema = z.object({
  evaluationAreaId: z.string().uuid(),
  evaluateeFieldKey: z.string().min(1).max(64),
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
  evaluateeFieldKey: string;
  scoreFieldKey: string;
  reviewType: ReviewType;
  anonymous: boolean;
  contextFieldKey: string | null;
  commentFieldKey: string | null;
  createdAt: string;
}

/**
 * Bulk variant: one shared evaluatee field, review type, anonymity setting,
 * and optional context/comment field (a form only ever names its respondent
 * — and represents one review relationship — once) paired with many
 * (scoreFieldKey, evaluationAreaId) pairs — the shape a large multi-question
 * evaluation form actually needs, instead of repeating
 * createFormKpiMappingSchema's single-pair call once per question. Partial
 * success is expected, not exceptional: a row whose Evaluation Area is
 * already mapped on this form is skipped, not fatal to the rest of the
 * batch — see BulkCreateFormKpiMappingResult.
 */
export const bulkCreateFormKpiMappingSchema = z.object({
  evaluateeFieldKey: z.string().min(1).max(64),
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
