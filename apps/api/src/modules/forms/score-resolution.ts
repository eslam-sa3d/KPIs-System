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
 * normalized against any other field's scale (see normalizeScore in
 * submissions.service.ts for that — this is deliberately its opposite:
 * normalizeScore forces every type onto a comparable 0-5 number for
 * materialized scoring; this keeps each answer legible on its own terms for
 * the dashboard's read path, which shows raw submissions, not blended
 * scores). Mirrors normalizeScore's per-type switch structurally so the two
 * stay easy to compare, but every branch here returns a human string
 * instead of a forced number.
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
