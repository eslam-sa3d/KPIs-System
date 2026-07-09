import { readSheet } from 'read-excel-file/browser';
import type { FieldType } from '@pulse/contracts';

/**
 * Shape the "new form" builder maps 1:1 onto its DraftField/DraftSection state
 * (see apps/web/app/forms/new/page.tsx) after an import.
 */
export interface ParsedFormField {
  label: string;
  helpText: string;
  type: FieldType;
  required: boolean;
  options: string;
  scale: number;
  likertScale: string;
  lowLabel: string;
  highLabel: string;
  acceptedMimeTypes: string;
  maxSizeMb: number;
  /** page/section column value, or '' if the sheet didn't group questions into pages */
  page: string;
}

export interface ParsedFormWorkbook {
  fields: ParsedFormField[];
  /** row-level problems, e.g. "row 4: no question text" — shown to the user, not fatal on their own */
  issues: string[];
}

// header row cells are matched case/spacing-insensitively against these aliases
const COLUMN_ALIASES: Record<string, string[]> = {
  label: ['question', 'label', 'field label', 'title'],
  type: ['type', 'field type', 'question type'],
  required: ['required', 'mandatory'],
  options: ['options', 'choices', 'answers', 'statements'],
  helpText: ['help text', 'help', 'description', 'instructions'],
  scale: ['scale', 'rating scale'],
  likertScale: ['likert scale', 'scale labels'],
  lowLabel: ['low label', 'low-end label', 'min label'],
  highLabel: ['high label', 'high-end label', 'max label'],
  acceptedMimeTypes: ['accepted file types', 'file types', 'mime types'],
  maxSizeMb: ['max size mb', 'max file size', 'max file size mb'],
  page: ['page', 'section', 'page title'],
};

const TYPE_ALIASES: Record<string, FieldType> = {
  'short text': 'short_text', short_text: 'short_text', text: 'short_text', 'single line': 'short_text',
  'long text': 'long_text', long_text: 'long_text', paragraph: 'long_text', 'multi line': 'long_text',
  number: 'number',
  date: 'date',
  boolean: 'boolean', 'yes/no': 'boolean', 'yes / no': 'boolean',
  rating: 'rating',
  nps: 'nps', 'net promoter score': 'nps',
  select: 'select', choice: 'select', dropdown: 'select', 'single choice': 'select', 'choice (one answer)': 'select',
  multi_select: 'multi_select', 'multi select': 'multi_select', 'multiple choice': 'multi_select', checkbox: 'multi_select', 'choice (multiple answers)': 'multi_select',
  likert: 'likert', matrix: 'likert', 'likert matrix': 'likert',
  ranking: 'ranking',
  file: 'file', 'file upload': 'file', attachment: 'file',
};

function normalizeHeader(cell: unknown): string {
  return String(cell ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function cellToString(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString();
  return String(cell).trim();
}

function cellToBoolean(cell: unknown): boolean {
  if (typeof cell === 'boolean') return cell;
  return ['true', 'yes', 'y', '1', 'required'].includes(cellToString(cell).toLowerCase());
}

function cellToType(cell: unknown): FieldType {
  return TYPE_ALIASES[cellToString(cell).toLowerCase()] ?? 'short_text';
}

function cellToNumber(cell: unknown, fallback: number, min: number, max: number): number {
  const n = typeof cell === 'number' ? cell : Number(cellToString(cell));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

/**
 * Parses an uploaded spreadsheet into questions for the form builder. Expected
 * columns (header row, any order, only Question is required): Question, Type,
 * Required, Options, Help Text, Scale, Likert Scale, Low Label, High Label,
 * Accepted File Types, Max Size MB, Page. Unrecognized Type values default to
 * short text. Rows with no question text are skipped and reported rather than
 * failing the whole import.
 */
export async function parseFormWorkbook(file: File): Promise<ParsedFormWorkbook> {
  const rows = await readSheet(file);
  const issues: string[] = [];

  if (rows.length === 0) {
    return { fields: [], issues: ['the file has no rows'] };
  }

  const headerRow = rows[0]!;
  const columnIndex: Partial<Record<keyof typeof COLUMN_ALIASES, number>> = {};
  headerRow.forEach((cell, index) => {
    const normalized = normalizeHeader(cell);
    for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (aliases.includes(normalized)) columnIndex[key as keyof typeof COLUMN_ALIASES] = index;
    }
  });

  if (columnIndex.label === undefined) {
    return {
      fields: [],
      issues: ['missing required column — the header row needs a "question" column'],
    };
  }

  const fields: ParsedFormField[] = [];
  const at = (key: keyof typeof COLUMN_ALIASES, row: unknown[]) =>
    columnIndex[key] !== undefined ? row[columnIndex[key]!] : undefined;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (row.every((cell) => cell === null || cell === undefined || cell === '')) continue; // blank row

    const label = cellToString(at('label', row));
    if (!label) {
      issues.push(`row ${r + 1}: no question text, skipped`);
      continue;
    }

    fields.push({
      label,
      helpText: cellToString(at('helpText', row)),
      type: cellToType(at('type', row)),
      required: cellToBoolean(at('required', row)),
      options: cellToString(at('options', row)),
      scale: cellToNumber(at('scale', row), 5, 2, 10),
      likertScale: cellToString(at('likertScale', row)) || 'disagree, neutral, agree',
      lowLabel: cellToString(at('lowLabel', row)),
      highLabel: cellToString(at('highLabel', row)),
      acceptedMimeTypes: cellToString(at('acceptedMimeTypes', row)) || 'application/pdf, image/png, image/jpeg',
      maxSizeMb: cellToNumber(at('maxSizeMb', row), 10, 1, 25),
      page: cellToString(at('page', row)),
    });
  }

  if (fields.length === 0 && issues.length === 0) {
    issues.push('no questions found in the sheet');
  }

  return { fields, issues };
}
