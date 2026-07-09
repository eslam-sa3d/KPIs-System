import { z } from 'zod';

/**
 * Maps a form to a KPI Evaluation Area: one field supplies the evaluatee
 * (a 'person' field), another supplies the score (rating/nps/slider — the
 * only types with a well-defined numeric range to normalize to 0-5). On
 * every submission, SubmissionsService resolves both and upserts an
 * EvaluationAreaEntry — this is the bridge that lets a QA evaluation survey
 * actually produce KPI scores instead of sitting next to them unconnected.
 *
 * Deliberately out of scope for this pass: retroactive backfill (a mapping
 * only affects submissions from the point it's created onward), 'likert'/
 * 'number' as score fields (no well-defined bounds to normalize against),
 * and more than one mapping per (form, evaluationArea) pair.
 */

export const SCORE_FIELD_TYPES = ['rating', 'nps', 'slider'] as const;
export type ScoreFieldType = (typeof SCORE_FIELD_TYPES)[number];

export const createFormKpiMappingSchema = z.object({
  evaluationAreaId: z.string().uuid(),
  evaluateeFieldKey: z.string().min(1).max(64),
  scoreFieldKey: z.string().min(1).max(64),
});

export type CreateFormKpiMappingInput = z.infer<typeof createFormKpiMappingSchema>;

export interface FormKpiMapping {
  id: string;
  formId: string;
  evaluationAreaId: string;
  evaluateeFieldKey: string;
  scoreFieldKey: string;
  createdAt: string;
}
