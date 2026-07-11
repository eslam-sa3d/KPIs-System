import type { FormDefinition, FormField, Submission, SubmissionAnswerValue } from './types';

export interface FieldSummary {
  field: FormField;
  answered: number;
  /** multiple_choice / dropdown (pie) or checkboxes (bar): option label -> count */
  counts?: Record<string, number>;
  /** linear_scale: scale value -> count */
  scaleCounts?: Record<string, number>;
  average?: number;
  /** grid types: row -> column -> count */
  matrix?: Record<string, Record<string, number>>;
  /** short_answer / paragraph: recent non-empty answers, most recent first */
  samples?: string[];
}

function isEmpty(value: SubmissionAnswerValue | undefined): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function bucketLabel(raw: string): string {
  return raw.startsWith('other:') ? 'Other' : raw;
}

export function summarizeField(field: FormField, submissions: Submission[]): FieldSummary {
  const values = submissions.map((s) => s.answers[field.id]).filter((v) => !isEmpty(v));
  const answered = values.length;

  switch (field.type) {
    case 'multiple_choice':
    case 'dropdown': {
      const counts: Record<string, number> = {};
      for (const v of values as string[]) {
        const label = bucketLabel(v);
        counts[label] = (counts[label] ?? 0) + 1;
      }
      return { field, answered, counts };
    }
    case 'checkboxes': {
      const counts: Record<string, number> = {};
      for (const arr of values as string[][]) {
        for (const v of arr) {
          const label = bucketLabel(v);
          counts[label] = (counts[label] ?? 0) + 1;
        }
      }
      return { field, answered, counts };
    }
    case 'linear_scale': {
      const nums = (values as string[]).map(Number);
      const scaleCounts: Record<string, number> = {};
      for (const n of nums) scaleCounts[String(n)] = (scaleCounts[String(n)] ?? 0) + 1;
      const average = answered ? nums.reduce((a, b) => a + b, 0) / answered : undefined;
      return { field, answered, scaleCounts, average };
    }
    case 'multiple_choice_grid':
    case 'checkbox_grid': {
      const matrix: Record<string, Record<string, number>> = {};
      for (const rec of values as Array<Record<string, string | string[]>>) {
        for (const [row, cell] of Object.entries(rec)) {
          matrix[row] ??= {};
          const columns = Array.isArray(cell) ? cell : [cell];
          for (const col of columns) {
            if (!col) continue;
            matrix[row][col] = (matrix[row][col] ?? 0) + 1;
          }
        }
      }
      return { field, answered, matrix };
    }
    case 'short_answer':
    case 'paragraph': {
      const samples = (values as string[]).slice(-8).reverse();
      return { field, answered, samples };
    }
    case 'date':
    case 'time':
    case 'file_upload':
    default: {
      const samples = (values as string[]).slice(-8).reverse();
      return { field, answered, samples };
    }
  }
}

export function summarizeForm(form: FormDefinition, submissions: Submission[]): FieldSummary[] {
  return form.sections
    .flatMap((section) => section.fieldIds)
    .map((id) => form.fields[id])
    .filter((f): f is FormField => f !== undefined && f.type !== 'title_block') // display-only, never has an answer
    .map((field) => summarizeField(field, submissions));
}
