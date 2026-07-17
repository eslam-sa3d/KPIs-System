import type { FormField, SubmissionAnswers } from '@pulse/contracts';

/** An empty evaluateeFieldKeys => self-assessment: the submitter is the
 *  evaluatee. Otherwise each candidate is tried in order and the first one
 *  with a string answer wins — candidates configured but none answered
 *  resolves to null (NOT a fallback to self; that was the bug this
 *  multi-candidate support replaces). Shared between the write path
 *  (FormKpiScoringService.applyOneMapping) and the dashboard's read path
 *  (KpiDashboardService) so the two can never resolve "who is this
 *  submission about" differently. */
export function resolveEvaluateeId(
  evaluateeFieldKeys: string[],
  answers: SubmissionAnswers,
  enteredById: string,
): string | null {
  if (evaluateeFieldKeys.length === 0) return enteredById;
  for (const key of evaluateeFieldKeys) {
    const value = answers[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

export interface AnswerDescription {
  raw: unknown;
  display: string;
}

export interface DescribeAnswerContext {
  performanceLevels?: Array<{ id: string; label: string }>;
  scoreLabels?: Array<{ id: string; label: string }>;
  /** userId -> displayName, for resolving a 'person' field's answer (that
   *  User's id) back to a name. Missing entries fall back to '(deleted
   *  user)', same as summary()'s own person resolution. */
  personNames?: Map<string, string>;
}

/** Renders any answer shape (string, number, boolean, array, or a likert
 *  index map) as display text for a mapping's context/comment snapshot —
 *  these fields are read verbatim, not type-checked against a field type,
 *  since a context field can legitimately be any question type. */
export function answerToText(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (Array.isArray(raw)) return raw.map((v) => String(v)).join(', ');
  return JSON.stringify(raw);
}

/**
 * Renders a score-field's raw answer for direct display, on its own native
 * scale — e.g. "4/5" for a rating, "8/10" for NPS. Never blended or
 * normalized against any other field's scale (see normalizeScore below for
 * that — this is deliberately its opposite: normalizeScore forces every type
 * onto a comparable 0-5 number for materialized scoring; this keeps each
 * answer legible on its own terms for the dashboard's read path, which shows
 * raw submissions, not blended scores). Mirrors normalizeScore's per-type
 * switch structurally so the two stay easy to compare, but every branch here
 * returns a human string instead of a forced number.
 */
export function describeAnswer(
  field: FormField,
  raw: SubmissionAnswers[string],
  ctx: DescribeAnswerContext = {},
): AnswerDescription | null {
  const { performanceLevels, scoreLabels, personNames } = ctx;
  switch (field.type) {
    case 'rating':
      if (typeof raw !== 'number') return null;
      return { raw, display: `${raw}/${field.scale}` };
    case 'nps':
      if (typeof raw !== 'number') return null;
      return { raw, display: `${raw}/10` };
    case 'slider':
      if (typeof raw !== 'number') return null;
      return { raw, display: `${raw}/${field.max}` };
    case 'number':
      if (typeof raw !== 'number') return null;
      return { raw, display: field.max !== undefined ? `${raw}/${field.max}` : `${raw}` };
    case 'boolean':
      if (typeof raw !== 'boolean') return null;
      return { raw, display: raw ? 'yes' : 'no' };
    case 'select': {
      if (typeof raw !== 'string') return null;
      if (raw.startsWith('other:')) return { raw, display: raw.slice(6) || '(other)' };
      const option = field.options.find((o) => o.value === raw);
      return option ? { raw, display: option.label } : null;
    }
    case 'multi_select': {
      if (!Array.isArray(raw)) return null;
      const labels = raw
        .map((v) =>
          typeof v === 'string' && v.startsWith('other:')
            ? v.slice(6)
            : field.options.find((o) => o.value === v)?.label,
        )
        .filter((l): l is string => Boolean(l));
      return { raw, display: labels.length > 0 ? labels.join(', ') : 'none selected' };
    }
    case 'likert': {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const answers = raw as Record<string, number>;
      const parts = field.statements
        .map((s) => {
          const idx = answers[s.value];
          return typeof idx === 'number' && field.scale[idx] !== undefined ? `${s.label}: ${field.scale[idx]}` : null;
        })
        .filter((p): p is string => Boolean(p));
      return parts.length > 0 ? { raw, display: parts.join('; ') } : null;
    }
    case 'performance_level': {
      if (typeof raw !== 'string' || !performanceLevels) return null;
      const level = performanceLevels.find((l) => l.id === raw);
      return level ? { raw, display: level.label } : null;
    }
    case 'score_label': {
      if (typeof raw !== 'string' || !scoreLabels) return null;
      const label = scoreLabels.find((l) => l.id === raw);
      return label ? { raw, display: label.label } : null;
    }
    case 'ranking': {
      if (!Array.isArray(raw)) return null;
      const labels = raw
        .map((v) => (typeof v === 'string' ? field.options.find((o) => o.value === v)?.label : undefined))
        .filter((l): l is string => Boolean(l));
      return labels.length > 0 ? { raw, display: labels.join(', ') } : null;
    }
    case 'person': {
      if (typeof raw !== 'string' || !personNames) return null;
      return { raw, display: personNames.get(raw) ?? '(deleted user)' };
    }
    default:
      return null;
  }
}

/** Normalizes a raw answer to a 0-5 KPI score using that field's own configured
 *  range/options. Returns null for a degenerate (zero-width, single-option) range,
 *  an answer shape that doesn't match the field type, an unrecognized option value
 *  (including a free-text "other:" answer — no fixed position to score), an
 *  unrecognized performance_level/score_label id, or a field type with no
 *  well-defined numeric interpretation at all (short_text, long_text, date,
 *  time, file, contact_info, hot_spot, person, ranking, grid, section_header).
 *
 *  `performanceLevels`/`scoreLabels` are only needed (and only fetched by the
 *  caller) when `field.type` is 'performance_level'/'score_label' respectively
 *  — every other case normalizes purely from the field definition. Shared
 *  between the write path (FormKpiScoringService, for EvaluationAreaEntry.value)
 *  and the dashboard's read path (KpiDashboardService, for each person's
 *  all-time total score). */
export function normalizeScore(
  field: FormField,
  raw: SubmissionAnswers[string],
  performanceLevels?: Array<{ id: string; minScore: number; maxScore: number }>,
  scoreLabels?: Array<{ id: string; score: number }>,
): number | null {
  switch (field.type) {
    case 'rating': {
      if (typeof raw !== 'number' || field.scale <= 1) return null;
      return clamp(((raw - 1) / (field.scale - 1)) * 5, 0, 5);
    }
    case 'nps':
      if (typeof raw !== 'number') return null;
      return clamp((raw / 10) * 5, 0, 5);
    case 'slider': {
      if (typeof raw !== 'number') return null;
      const range = field.max - field.min;
      if (range <= 0) return null;
      return clamp(((raw - field.min) / range) * 5, 0, 5);
    }
    case 'number': {
      if (typeof raw !== 'number') return null;
      // With a configured range, normalize against it like a slider; without one,
      // treat the raw value as already meant to sit on a 0-5 scale and just clamp.
      if (field.min !== undefined && field.max !== undefined) {
        const range = field.max - field.min;
        if (range <= 0) return null;
        return clamp(((raw - field.min) / range) * 5, 0, 5);
      }
      return clamp(raw, 0, 5);
    }
    case 'boolean':
      if (typeof raw !== 'boolean') return null;
      return raw ? 5 : 0;
    case 'select': {
      if (typeof raw !== 'string' || raw.startsWith('other:') || field.options.length <= 1) return null;
      const index = field.options.findIndex((o) => o.value === raw);
      if (index === -1) return null;
      return clamp((index / (field.options.length - 1)) * 5, 0, 5);
    }
    case 'multi_select': {
      if (!Array.isArray(raw) || field.options.length === 0) return null;
      return clamp((raw.length / field.options.length) * 5, 0, 5);
    }
    case 'likert': {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || field.scale.length <= 1) return null;
      const indices = Object.values(raw).filter((v): v is number => typeof v === 'number');
      if (indices.length === 0) return null;
      const average = indices.reduce((sum, v) => sum + v, 0) / indices.length;
      return clamp((average / (field.scale.length - 1)) * 5, 0, 5);
    }
    case 'performance_level': {
      if (typeof raw !== 'string' || !performanceLevels) return null;
      const level = performanceLevels.find((l) => l.id === raw);
      if (!level) return null;
      return clamp((level.minScore + level.maxScore) / 2, 0, 5);
    }
    case 'score_label': {
      if (typeof raw !== 'string' || !scoreLabels) return null;
      const label = scoreLabels.find((l) => l.id === raw);
      if (!label) return null;
      return clamp(label.score, 0, 5);
    }
    default:
      return null;
  }
}

/** A person's dashboard total score sums each submission's own configured
 *  value — a score_label's exact `score`, a performance_level's range
 *  midpoint, or a numeric field's raw answer — with no stretching onto a
 *  common 0-5 scale (unlike normalizeScore above, which the older
 *  EvaluationAreaEntry write path still depends on and this deliberately
 *  leaves untouched). A field type with no single well-defined configured
 *  number (select, multi_select, likert, ranking, and the rest normalizeScore
 *  also excludes) contributes nothing rather than a synthesized position-
 *  based value. */
export function rawFieldValue(
  field: FormField,
  raw: SubmissionAnswers[string],
  performanceLevels?: Array<{ id: string; minScore: number; maxScore: number }>,
  scoreLabels?: Array<{ id: string; score: number }>,
): number | null {
  switch (field.type) {
    case 'rating':
    case 'nps':
    case 'slider':
    case 'number':
      return typeof raw === 'number' ? raw : null;
    case 'boolean':
      return typeof raw === 'boolean' ? (raw ? 1 : 0) : null;
    case 'performance_level': {
      if (typeof raw !== 'string' || !performanceLevels) return null;
      const level = performanceLevels.find((l) => l.id === raw);
      return level ? (level.minScore + level.maxScore) / 2 : null;
    }
    case 'score_label': {
      if (typeof raw !== 'string' || !scoreLabels) return null;
      const label = scoreLabels.find((l) => l.id === raw);
      return label ? label.score : null;
    }
    default:
      return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
