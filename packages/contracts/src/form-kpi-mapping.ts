import { z } from 'zod';
import { EvaluationAreaCadence } from './kpi';
import type { FormField } from './form-schema';

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
 * statement position, performance_level by the midpoint of the chosen
 * level's own configured score range, and score_label by the chosen label's
 * own configured score directly. Every other type (short_text, long_text,
 * date, time, file, contact_info, hot_spot, person, ranking, grid,
 * section_header) has no numeric interpretation and can't be a score field.
 *
 * `evaluateeFieldKeys` optionally names one or more candidate fields whose
 * answer is the evaluatee's user id — each a 'person' field, or a 'select'
 * field with at least one user-linked option (see isEvaluateeField below).
 * They're tried in order and the first one actually answered wins — useful
 * when a form has several mutually-exclusive "who is this about" fields
 * (e.g. one per project) and only one is filled in per submission. Empty
 * means self-assessment: the submitter scores themselves.
 *
 * A form with at least one evaluatee-capable field must say which mode it
 * wants — `selfAssessment: true`, or a non-empty `evaluateeFieldKeys` — the
 * API rejects a request that supplies neither (see requireExplicitEvaluateeChoice
 * in form-kpi-mappings.service.ts). Leaving this ambiguous used to silently
 * default to self-assessment, which meant every submission scored whoever
 * filled the form out rather than whoever they were evaluating — a bug that
 * went undetected for a long time on a real form because nothing forced the
 * choice. A form with no evaluatee-capable field at all has no real
 * decision to make, so self-assessment is forced regardless of this flag.
 * If candidates are configured but none were answered on a submission, no
 * evaluatee resolves — scoring does NOT fall back to self in that case.
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
  'score_label',
] as const;
export type ScoreFieldType = (typeof SCORE_FIELD_TYPES)[number];

/** Who a mapping's scores come from, relative to the evaluatee. Drives the
 *  dashboard's per-type breakdown and is copied onto every entry it produces. */
export const REVIEW_TYPES = ['self', 'peer', 'manager', '360'] as const;
export type ReviewType = (typeof REVIEW_TYPES)[number];

export const createFormKpiMappingSchema = z.object({
  evaluationAreaId: z.string().uuid(),
  /** Purely descriptive — narrows which Sub-Criteria under evaluationAreaId
   *  this question is meant for. Never read by scoring; must belong to
   *  evaluationAreaId (validated server-side). */
  subCriteriaId: z.string().uuid().optional(),
  evaluateeFieldKeys: z.array(z.string().min(1).max(64)).max(20).optional(),
  /** Explicit opt-in to self-assessment — required (along with a non-empty
   *  evaluateeFieldKeys being the alternative) whenever the form has any
   *  evaluatee-capable field at all; see the module doc comment above. */
  selfAssessment: z.boolean().optional(),
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

/** Whether a field can supply a candidate `evaluateeFieldKeys` answer: a dedicated
 *  'person' field, or a 'select' field with at least one option that
 *  resolves to a real user's id (see optionItem.userId in form-schema.ts —
 *  the "select a user" option in the form builder). Shared between the
 *  mapping-creation UI (which fields) and the API's own validation (which
 *  fields, for real) so the two can't drift apart. */
export function isEvaluateeField(field: FormField): boolean {
  if (field.type === 'person') return true;
  if (field.type === 'select') return field.options.some((o) => o.userId);
  return false;
}

export interface FormKpiMapping {
  id: string;
  formId: string;
  evaluationAreaId: string;
  subCriteriaId: string | null;
  evaluateeFieldKeys: string[];
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
  subCriteria: { id: string; name: string } | null;
  /** Null when this mapping's score field can normalize right now. Non-null
   *  names the reason it can't — e.g. its scoreFieldKey is a 'score_label'
   *  field and Configuration → Score Labels has zero rows configured, so
   *  every submission through this mapping silently scores nothing until
   *  that's fixed. Computed fresh on every list() call — see
   *  FormKpiMappingsService.readinessWarningFor. */
  readinessWarning: string | null;
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
  evaluateeFieldKeys: z.array(z.string().min(1).max(64)).max(20).optional(),
  /** Same explicit opt-in as createFormKpiMappingSchema — required for the
   *  whole batch whenever the form has any evaluatee-capable field. */
  selfAssessment: z.boolean().optional(),
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

/** Result of re-running a mapping against submissions that predate it — see
 *  FormKpiScoringService.backfillMapping. `skippedReasons` breaks the raw
 *  `skipped` count down by why each submission didn't score (e.g. "answer
 *  could not be scored (no matching Score Label/Performance Level
 *  configured)") — surfacing this was the whole point of adding it:
 *  previously the only way to find out why a backfill scored 0 was to read
 *  the source and manually trace submissions by hand. */
export interface BackfillResult {
  scored: number;
  skipped: number;
  skippedReasons: Record<string, number>;
}
