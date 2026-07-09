import { FormDefinition, FormField, SubmissionAnswers } from '@pulse/contracts';

/**
 * MS-Forms-style quiz scoring: sums points for gradable fields (select,
 * multi_select, boolean, short_text, number — the same subset MS Forms
 * itself allows a "correct answer" on) whose cleaned answer matches the
 * field's configured correct value. Pure and stateless — called once per
 * submission, right after answer validation, so the result can be stored
 * alongside the submission and never recomputed against a later form edit.
 */
export interface QuizScore {
  earnedPoints: number;
  totalPoints: number;
  /** null when no field on the form is actually gradable (no points to score) */
  percent: number | null;
  /** null unless a passThresholdPercent was configured */
  passed: boolean | null;
  /** per-gradable-question outcome, for the thank-you screen's "see feedback" section */
  perField: Record<string, { correct: boolean; feedback?: string }>;
}

function pointsFor(field: FormField): number {
  return 'points' in field && field.points ? field.points : 0;
}

function isGradable(field: FormField): boolean {
  if (!('points' in field) || !field.points) return false;
  switch (field.type) {
    case 'select':
      return field.correctValue !== undefined;
    case 'multi_select':
      return field.correctValues !== undefined;
    case 'boolean':
      return field.correctValue !== undefined;
    case 'short_text':
      return field.correctAnswers !== undefined && field.correctAnswers.length > 0;
    case 'number':
      return field.correctValue !== undefined;
    default:
      return false;
  }
}

function isCorrect(field: FormField, answer: SubmissionAnswers[string] | undefined): boolean {
  if (answer === undefined || answer === null) return false;
  switch (field.type) {
    case 'select':
      return typeof answer === 'string' && answer === field.correctValue;
    case 'multi_select': {
      if (!Array.isArray(answer) || !field.correctValues) return false;
      const given = [...answer].sort();
      const expected = [...field.correctValues].sort();
      return given.length === expected.length && given.every((v, i) => v === expected[i]);
    }
    case 'boolean':
      return typeof answer === 'boolean' && answer === field.correctValue;
    case 'short_text':
      return (
        typeof answer === 'string' &&
        (field.correctAnswers ?? []).some((c) => c.toLowerCase() === answer.toLowerCase())
      );
    case 'number':
      return typeof answer === 'number' && answer === field.correctValue;
    default:
      return false;
  }
}

function feedbackFor(field: FormField, correct: boolean): string | undefined {
  if (!('feedbackCorrect' in field)) return undefined;
  return correct ? field.feedbackCorrect : field.feedbackIncorrect;
}

export function scoreSubmission(
  definition: FormDefinition,
  answers: SubmissionAnswers,
  passThresholdPercent?: number,
): QuizScore | null {
  const gradableFields = definition.fields.filter(isGradable);
  if (gradableFields.length === 0) return null;

  let earnedPoints = 0;
  let totalPoints = 0;
  const perField: QuizScore['perField'] = {};
  for (const field of gradableFields) {
    const points = pointsFor(field);
    totalPoints += points;
    const correct = isCorrect(field, answers[field.key]);
    if (correct) earnedPoints += points;
    const feedback = feedbackFor(field, correct);
    perField[field.key] = { correct, ...(feedback ? { feedback } : {}) };
  }

  const percent = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : null;
  const passed =
    passThresholdPercent === undefined || percent === null ? null : percent >= passThresholdPercent;

  return { earnedPoints, totalPoints, percent, passed, perField };
}
