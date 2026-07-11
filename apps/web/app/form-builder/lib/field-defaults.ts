import type { ChoiceOption, FieldType, FormField, TitleBlockField } from './types';

let idCounter = 0;

/** Stable, unique ids for fields/sections/options — good enough for a
 *  client-only prototype (no server round-trip to collide with). */
export function makeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

export function makeOption(n: number): ChoiceOption {
  return { id: makeId('opt'), value: `Option ${n}` };
}

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  short_answer: 'Short answer',
  paragraph: 'Paragraph',
  multiple_choice: 'Multiple choice',
  checkboxes: 'Checkboxes',
  dropdown: 'Dropdown',
  file_upload: 'File upload',
  linear_scale: 'Linear scale',
  multiple_choice_grid: 'Multiple-choice grid',
  checkbox_grid: 'Checkbox grid',
  date: 'Date',
  time: 'Time',
};

export function createField(type: FieldType): FormField {
  const base = { id: makeId('field'), title: '', description: '', required: false };
  switch (type) {
    case 'short_answer':
      return { ...base, type, validation: { kind: 'none' } };
    case 'paragraph':
      return { ...base, type, validation: { kind: 'none' } };
    case 'multiple_choice':
      return { ...base, type, options: [makeOption(1)], allowOther: false, shuffleOptions: false, branching: {} };
    case 'checkboxes':
      return { ...base, type, options: [makeOption(1)], allowOther: false, shuffleOptions: false };
    case 'dropdown':
      return { ...base, type, options: [makeOption(1)], shuffleOptions: false, branching: {} };
    case 'file_upload':
      return { ...base, type, allowedTypes: [], maxFiles: 1, maxSizeMb: 10 };
    case 'linear_scale':
      return { ...base, type, min: 1, max: 5, minLabel: '', maxLabel: '' };
    case 'multiple_choice_grid':
      return { ...base, type, rows: ['Row 1'], columns: ['Column 1'], requireOneResponsePerRow: false };
    case 'checkbox_grid':
      return { ...base, type, rows: ['Row 1'], columns: ['Column 1'], requireOneResponsePerRow: false };
    case 'date':
      return { ...base, type, includeYear: true, includeTime: false };
    case 'time':
      return { ...base, type, isDuration: false };
  }
}

export function createTitleBlock(): TitleBlockField {
  return { id: makeId('field'), title: '', description: '', required: false, type: 'title_block' };
}
