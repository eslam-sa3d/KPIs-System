import { FieldType, FormSettings } from './form-schema';

export const FORM_STATUSES = ['draft', 'published', 'archived'] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];

/** Row of FormsService.listForms() — the admin forms list, one row per form
 *  showing its latest version's title/field count rather than the full
 *  definition. Shared verbatim so the forms list page doesn't re-derive it. */
export interface FormListItem {
  id: string;
  slug: string;
  status: FormStatus;
  title: string;
  fieldCount: number;
  version: number;
  hasPublicLink: boolean;
  settings: FormSettings;
  folder: string | null;
  createdAt: string;
}

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

/** Present only for quiz-mode forms with at least one gradable response. */
export interface QuizResponseSummary {
  averagePercent: number;
  /** fraction (0–1) of scored responses meeting the pass threshold — undefined if none was set */
  passRate?: number;
  /** score percent (rounded to the nearest 10) -> response count, for a simple distribution chart */
  distribution: Record<string, number>;
}

export interface FormResponseSummary {
  responses: number;
  firstResponseAt: string | null;
  lastResponseAt: string | null;
  fields: FormFieldSummary[];
  quiz?: QuizResponseSummary;
}

/**
 * MS-Forms-style quiz result for a single submission — computed once at
 * submit time by quiz-scoring.ts and stored alongside it. Shared verbatim so
 * the thank-you screen's "see feedback" section doesn't re-derive the shape
 * (perField is always populated, even to `{}`, once a QuizScore exists at
 * all — never omit it optionally on the consuming side).
 */
export interface QuizScore {
  earnedPoints: number;
  totalPoints: number;
  /** null when no field on the form is actually gradable (no points to score) */
  percent: number | null;
  /** null unless a passThresholdPercent was configured */
  passed: boolean | null;
  perField: Record<string, { correct: boolean; feedback?: string }>;
}
