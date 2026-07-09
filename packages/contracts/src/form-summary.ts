import { FieldType } from './form-schema';

/**
 * Per-question response aggregate for the "response summary" dashboard.
 * Deliberately a single flat shape (not a discriminated union) — every
 * property beyond the base four is optional and populated only for the
 * question types it applies to. Shared verbatim between the API (producer)
 * and the web dashboard (consumer) so neither side re-derives the shape.
 */
export interface FormFieldSummary {
  key: string;
  label: string;
  type: FieldType;
  answered: number;
  /** choice / multi-choice / boolean: option (or "yes"/"no") → count */
  counts?: Record<string, number>;
  /** number / rating / nps */
  average?: number | null;
  /** number */
  min?: number | null;
  /** number */
  max?: number | null;
  /** nps: (%promoters - %detractors), -100..100 */
  npsScore?: number;
  /** likert: statement → scale-index → count */
  matrix?: Record<string, Record<string, number>>;
  /** likert: the scale labels, index-aligned with matrix keys */
  scale?: string[];
  /** ranking: option value → average 1-based position */
  averagePosition?: Record<string, number>;
  /** free-text types: a handful of recent answers, most recent first */
  samples?: string[];
}

export interface FormResponseSummary {
  responses: number;
  firstResponseAt: string | null;
  lastResponseAt: string | null;
  fields: FormFieldSummary[];
}
