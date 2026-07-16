import { readSheet } from 'read-excel-file/browser';
import type { FieldType } from '@pulse/contracts';

/**
 * Shape the "new form" builder maps 1:1 onto its DraftField/DraftSection state
 * (see apps/web/app/forms/new/page.tsx) after an import.
 */
interface ParsedFormField {
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
  /** page/section column value, or '' if the source didn't group questions into pages */
  page: string;
}

export interface ParsedFormWorkbook {
  fields: ParsedFormField[];
  /** row-level problems, e.g. "row 4: no question text" — shown to the user, not fatal on their own */
  issues: string[];
  /** only set by the .docx path, when the document opens with a title/description above the first question */
  title?: string;
  description?: string;
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
  'short text': 'short_text',
  short_text: 'short_text',
  text: 'short_text',
  'single line': 'short_text',
  'long text': 'long_text',
  long_text: 'long_text',
  paragraph: 'long_text',
  'multi line': 'long_text',
  number: 'number',
  date: 'date',
  boolean: 'boolean',
  'yes/no': 'boolean',
  'yes / no': 'boolean',
  rating: 'rating',
  nps: 'nps',
  'net promoter score': 'nps',
  select: 'select',
  choice: 'select',
  dropdown: 'select',
  'single choice': 'select',
  'choice (one answer)': 'select',
  multi_select: 'multi_select',
  'multi select': 'multi_select',
  'multiple choice': 'multi_select',
  checkbox: 'multi_select',
  'choice (multiple answers)': 'multi_select',
  likert: 'likert',
  matrix: 'likert',
  'likert matrix': 'likert',
  ranking: 'ranking',
  file: 'file',
  'file upload': 'file',
  attachment: 'file',
};

const DEFAULT_FIELD = {
  helpText: '',
  options: '',
  scale: 5,
  likertScale: 'disagree, neutral, agree',
  lowLabel: '',
  highLabel: '',
  acceptedMimeTypes: 'application/pdf, image/png, image/jpeg',
  maxSizeMb: 10,
  page: '',
};

function normalizeHeader(cell: unknown): string {
  return String(cell ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
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

/** Maps header-row + data-row cells (from a spreadsheet or CSV) onto ParsedFormField[]. */
export function mapRowsToFields(rows: unknown[][]): ParsedFormWorkbook {
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
      likertScale: cellToString(at('likertScale', row)) || DEFAULT_FIELD.likertScale,
      lowLabel: cellToString(at('lowLabel', row)),
      highLabel: cellToString(at('highLabel', row)),
      acceptedMimeTypes: cellToString(at('acceptedMimeTypes', row)) || DEFAULT_FIELD.acceptedMimeTypes,
      maxSizeMb: cellToNumber(at('maxSizeMb', row), 10, 1, 25),
      page: cellToString(at('page', row)),
    });
  }

  if (fields.length === 0 && issues.length === 0) {
    issues.push('no questions found in the file');
  }

  return { fields, issues };
}

/** Parses RFC4180-ish CSV text (quoted fields, embedded commas/newlines, "" escaping) into rows of cells. */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

const RATING_OPTION = /^\d/; // "1 - Needs Improvement" … "5 - Excellent"
const NUMBERED_LINE = /^\d+[.)]\s+(.+)/;
const LETTERED_LINE = /^[a-z][.)]\s+(.+)/i;
// a numbered question that opens a new rating category names it once:
// "SECTION 1 - Leadership & People Management: Coaching & Mentoring"
const SECTION_HEADER = /^SECTION\s+\d+\s*-\s*([^:]+):\s*(.+)$/i;

/**
 * Splits a trailing "(...)" off a question line into help text, e.g.
 * "Evaluatee Full Name (Enter the full name.)" -> label + helpText.
 */
function splitHelpText(text: string): { label: string; helpText: string } {
  const match = text.match(/^(.*\S)\s*\(([^()]+)\)\s*$/);
  return match ? { label: match[1]!.trim(), helpText: match[2]!.trim() } : { label: text, helpText: '' };
}

/**
 * A Word document has no columns, so structure has to be read from plain-text
 * conventions MS-Forms-style templates commonly use:
 *
 *  - a title line, then a description paragraph, before the first numbered question
 *  - numbered questions ("1. Question text (help text)"), each optionally
 *    followed by lettered answer options ("a. Option one", "b. Option two…")
 *  - a rating-scale question's options all start with a digit ("1 - Needs
 *    Improvement" … "5 - Excellent"); the FIRST such question in a group
 *    names its category once ("SECTION 1 - Leadership: Coaching &
 *    Mentoring") — every rating question after it, until the next SECTION
 *    marker, belongs to that same category and is a statement in one
 *    combined likert matrix rather than its own field
 *  - a non-rating question with 2+ lettered options becomes a select field;
 *    with none, a short-text field
 *
 * Falls back gracefully: unrecognized structure just becomes individual
 * short-text questions, same as before.
 */
export function parseDocxLines(rawText: string): ParsedFormWorkbook {
  const issues: string[] = [];
  const fields: ParsedFormField[] = [];
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { fields, issues: ['the document has no content'] };
  }

  let i = 0;
  let title: string | undefined;
  let description: string | undefined;

  // a title line precedes the first numbered/lettered content
  if (!NUMBERED_LINE.test(lines[0]!) && !LETTERED_LINE.test(lines[0]!)) {
    title = lines[0];
    i = 1;
    const descLines: string[] = [];
    while (i < lines.length && !NUMBERED_LINE.test(lines[i]!) && !LETTERED_LINE.test(lines[i]!)) {
      descLines.push(lines[i]!);
      i++;
    }
    if (descLines.length > 0) description = descLines.join(' ');
  }

  // statements accumulate here for the category currently being read; flushed
  // into a single likert field the moment a DIFFERENT category starts (or a
  // non-rating question is hit) — flushing inline, rather than batching all
  // groups at the end, keeps the resulting field order matching the
  // document's reading order (so a trailing question ends up after the
  // categories, not before them)
  let currentCategory: string | null = null;
  let currentStatements: string[] = [];
  let currentScale: string[] = [];
  let seenAnySection = false;

  function flushCurrentCategory() {
    if (currentCategory && currentStatements.length > 0) {
      fields.push({
        ...DEFAULT_FIELD,
        label: currentCategory,
        type: 'likert',
        required: false,
        options: currentStatements.join(', '),
        likertScale: currentScale.join(', '),
        page: currentCategory,
      });
    }
    currentCategory = null;
    currentStatements = [];
    currentScale = [];
  }

  while (i < lines.length) {
    const qMatch = lines[i]!.match(NUMBERED_LINE);
    if (!qMatch) {
      // stray line outside the expected question/option structure — ignore rather than guess
      i++;
      continue;
    }
    let questionText = qMatch[1]!.trim();
    i++;

    const options: string[] = [];
    while (i < lines.length) {
      const optMatch = lines[i]!.match(LETTERED_LINE);
      if (!optMatch) break;
      options.push(optMatch[1]!.trim());
      i++;
    }

    const split = splitHelpText(questionText);
    questionText = split.label;

    const isRatingScale = options.length >= 4 && options.every((o) => RATING_OPTION.test(o));
    const sectionHeader = questionText.match(SECTION_HEADER);

    if (sectionHeader && isRatingScale) {
      const category = sectionHeader[1]!.trim();
      if (category !== currentCategory) flushCurrentCategory();
      currentCategory = category;
      currentScale = options;
      seenAnySection = true;
      currentStatements.push(sectionHeader[2]!.trim());
      continue;
    }

    if (isRatingScale && currentCategory) {
      // a continuation question in the current category — no marker of its own
      currentStatements.push(questionText);
      continue;
    }

    // not part of a rating group — flush whatever category was open so it
    // lands before this field, not after
    flushCurrentCategory();

    fields.push({
      ...DEFAULT_FIELD,
      label: questionText,
      helpText: split.helpText,
      type: options.length >= 2 ? 'select' : 'short_text',
      required: false,
      options: options.join(', '),
      page: seenAnySection ? 'Comments' : 'Overview',
    });
  }

  flushCurrentCategory();

  if (fields.length === 0) issues.push('no question lines found in the document');
  return { fields, issues, title, description };
}

/**
 * Parses an uploaded file into questions for the form builder.
 *
 * .xlsx/.xls/.csv: expected columns (header row, any order, only Question is
 * required): Question, Type, Required, Options, Help Text, Scale, Likert
 * Scale, Low Label, High Label, Accepted File Types, Max Size MB, Page.
 * Unrecognized Type values default to short text; rows with no question text
 * are skipped and reported rather than failing the whole import.
 *
 * .docx: one question per non-empty line/paragraph, in reading order; an
 * optional "(type)" hint at the end of a line sets that question's type.
 */
export async function parseFormWorkbook(file: File): Promise<ParsedFormWorkbook> {
  const name = file.name.toLowerCase();

  if (name.endsWith('.csv')) {
    const text = await file.text();
    return mapRowsToFields(parseCsvText(text));
  }

  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const arrayBuffer = await file.arrayBuffer();
    const { value: rawText } = await mammoth.extractRawText({ arrayBuffer });
    return parseDocxLines(rawText);
  }

  const rows = await readSheet(file);
  return mapRowsToFields(rows);
}
