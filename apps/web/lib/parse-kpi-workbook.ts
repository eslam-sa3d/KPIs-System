import { readSheet } from 'read-excel-file/browser';

/**
 * Same shape the dashboard already expects from `/v1/kpis/my` — an uploaded
 * workbook is parsed into this so every widget (strip, charts, table, drawer)
 * works identically regardless of where the data came from.
 */
export interface RawKpi {
  id: string;
  code: string;
  name: string;
  unit: string;
  direction: 'higher_is_better' | 'lower_is_better';
  target: string | null;
  cadence: string;
  entries: Array<{ value: string; periodStart: string; periodEnd: string }>;
  /** job title / role, when the source data has one (e.g. an evaluation export's "Your Role") */
  title?: string;
}

export interface ParsedWorkbook {
  kpis: RawKpi[];
  /** row-level problems, e.g. "row 4: missing a value" — shown to the user, not fatal on their own */
  issues: string[];
}

type Row = readonly unknown[];

const CADENCES = new Set(['weekly', 'monthly', 'quarterly']);

function normalizeHeader(cell: unknown): string {
  return String(cell ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeDirection(raw: unknown): RawKpi['direction'] {
  const v = String(raw ?? '').trim().toLowerCase();
  return v.startsWith('lower') || v === 'down' ? 'lower_is_better' : 'higher_is_better';
}

function normalizeCadence(raw: unknown): string {
  const v = String(raw ?? '').trim().toLowerCase();
  return CADENCES.has(v) ? v : 'monthly';
}

function toIsoDate(raw: unknown, fallback: string): string {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString();
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return fallback;
}

function toNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw.trim().replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function slugify(text: string): string {
  return text.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'UNKNOWN';
}

function firstNonEmpty(row: Row, columns: number[]): unknown {
  for (const c of columns) {
    const v = row[c];
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return undefined;
}

// ── format 1: a simple tabular sheet — Code, Name, Value per row ──────────

const SIMPLE_COLUMN_ALIASES: Record<string, string[]> = {
  code: ['code', 'kpicode', 'kpi', 'id', 'kpiid'],
  name: ['name', 'kpiname', 'title', 'metric', 'metricname', 'kpititle', 'description'],
  unit: ['unit', 'units', 'uom', 'measure'],
  direction: ['direction', 'trend', 'goaldirection'],
  target: ['target', 'goal', 'targetvalue'],
  cadence: ['cadence', 'frequency', 'period', 'periodicity', 'interval'],
  periodStart: ['periodstart', 'start', 'startdate', 'from', 'periodfrom'],
  periodEnd: ['periodend', 'end', 'enddate', 'to', 'date', 'asof', 'asofdate', 'periodto', 'reportdate'],
  value: ['value', 'latest', 'latestvalue', 'actual', 'result', 'score', 'reading', 'current', 'currentvalue'],
};

const SIMPLE_REQUIRED = ['code', 'name', 'value'] as const;

type SimpleColumnIndex = Partial<Record<keyof typeof SIMPLE_COLUMN_ALIASES, number>>;

function matchSimpleColumns(headerRow: Row): SimpleColumnIndex {
  const columnIndex: SimpleColumnIndex = {};
  headerRow.forEach((cell, index) => {
    const normalized = normalizeHeader(cell);
    if (!normalized) return;
    for (const [key, aliases] of Object.entries(SIMPLE_COLUMN_ALIASES)) {
      if (aliases.includes(normalized)) columnIndex[key as keyof typeof SIMPLE_COLUMN_ALIASES] = index;
    }
  });
  return columnIndex;
}

function isSimpleTable(columnIndex: SimpleColumnIndex): boolean {
  return SIMPLE_REQUIRED.every((key) => columnIndex[key] !== undefined);
}

function parseSimpleTable(rows: Row[], headerRowIndex: number, columnIndex: SimpleColumnIndex): ParsedWorkbook {
  const issues: string[] = [];
  const byCode = new Map<string, RawKpi>();

  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (row.every((cell) => cell === null || cell === undefined || cell === '')) continue;

    const code = String(row[columnIndex.code!] ?? '').trim();
    const name = String(row[columnIndex.name!] ?? '').trim();
    const value = toNumber(row[columnIndex.value!]);

    if (!code) { issues.push(`row ${r + 1}: missing a code, skipped`); continue; }
    if (!name) { issues.push(`row ${r + 1}: missing a name, skipped`); continue; }
    if (value === null) { issues.push(`row ${r + 1}: missing or invalid value, skipped`); continue; }

    const periodEnd = toIsoDate(columnIndex.periodEnd !== undefined ? row[columnIndex.periodEnd] : undefined, new Date().toISOString());
    const periodStart = toIsoDate(columnIndex.periodStart !== undefined ? row[columnIndex.periodStart] : undefined, periodEnd);
    const target = columnIndex.target !== undefined ? toNumber(row[columnIndex.target]) : null;

    let kpi = byCode.get(code);
    if (!kpi) {
      kpi = {
        id: `upload-${code}`,
        code,
        name,
        unit: columnIndex.unit !== undefined ? String(row[columnIndex.unit] ?? '').trim() : '',
        direction: normalizeDirection(columnIndex.direction !== undefined ? row[columnIndex.direction] : undefined),
        target: target !== null ? String(target) : null,
        cadence: normalizeCadence(columnIndex.cadence !== undefined ? row[columnIndex.cadence] : undefined),
        entries: [],
      };
      byCode.set(code, kpi);
    }
    kpi.entries.push({ value: String(value), periodStart, periodEnd });
  }

  const kpis = [...byCode.values()].map((kpi) => ({
    ...kpi,
    entries: [...kpi.entries].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd)),
  }));
  return { kpis, issues };
}

// ── format 2: a wide MS-Forms-style evaluation export ──────────────────────
// One row per submission; dozens of "1 - Needs Improvement" .. "5 - Excellent"
// rating columns, plus a tester name / period / type that MS Forms branching
// often duplicates across columns ("Tester Name", "Tester Name2", …) — the
// first filled one per row is the real answer. One KPI per tester, valued as
// that submission's average rating; multiple submissions become that
// tester's history (trend across evaluation periods).

const RATING_PATTERN = /^(\d+(?:\.\d+)?)/;
const EVAL_METADATA_PREFIXES = [
  'id', 'starttime', 'completiontime', 'email', 'name', 'lastmodifiedtime',
  'projectname', 'testername', 'levels', 'evaluationperiod', 'evaluationtype',
  'yourrole', 'overallcomments',
];

function isEvaluationExport(headerRow: Row): boolean {
  const normalized = headerRow.map(normalizeHeader);
  const testerNameCols = normalized.filter((h) => h.startsWith('testername')).length;
  const periodCols = normalized.filter((h) => h.startsWith('evaluationperiod')).length;
  return testerNameCols >= 1 && periodCols >= 1;
}

function parseEvaluationExport(rows: Row[]): ParsedWorkbook {
  const header = rows[0]!.map(normalizeHeader);
  const issues: string[] = [];

  const testerNameCols: number[] = [];
  const periodCols: number[] = [];
  const roleCols: number[] = [];
  let completionTimeCol: number | undefined;
  let startTimeCol: number | undefined;
  const scoreCols: number[] = [];

  header.forEach((h, index) => {
    if (h.startsWith('testername')) testerNameCols.push(index);
    else if (h.startsWith('evaluationperiod')) periodCols.push(index);
    else if (h.startsWith('yourrole')) roleCols.push(index);
    else if (h === 'completiontime') completionTimeCol = index;
    else if (h === 'starttime') startTimeCol = index;
    else if (!EVAL_METADATA_PREFIXES.some((prefix) => h.startsWith(prefix))) scoreCols.push(index);
  });

  const byTester = new Map<string, RawKpi>();
  let skippedNoTester = 0;
  let skippedNoScores = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (row.every((cell) => cell === null || cell === undefined || cell === '')) continue;

    const testerName = String(firstNonEmpty(row, testerNameCols) ?? '').trim();
    if (!testerName) { skippedNoTester++; continue; }

    const scores: number[] = [];
    for (const c of scoreCols) {
      const match = RATING_PATTERN.exec(String(row[c] ?? '').trim());
      if (match) scores.push(Number(match[1]));
    }
    if (scores.length === 0) { skippedNoScores++; continue; }

    const average = scores.reduce((a, b) => a + b, 0) / scores.length;
    const dateRaw = (completionTimeCol !== undefined ? row[completionTimeCol] : undefined)
      ?? (startTimeCol !== undefined ? row[startTimeCol] : undefined);
    const date = toIsoDate(dateRaw, new Date().toISOString());
    const periodLabel = String(firstNonEmpty(row, periodCols) ?? '').trim();
    const cadence = /^q\d|^h\d|annual/i.test(periodLabel) ? 'quarterly' : 'monthly';

    const code = slugify(testerName);
    let kpi = byTester.get(code);
    if (!kpi) {
      kpi = {
        id: `upload-${code}`,
        code,
        name: testerName,
        unit: 'avg score (1–5)',
        direction: 'higher_is_better',
        // "3 - Meets Expectations" is this scale's own stated baseline — used
        // as a default target so status bands are meaningful, not a real
        // configured target. Surfaced in `issues` so it isn't silently assumed.
        target: '3',
        cadence,
        entries: [],
      };
      byTester.set(code, kpi);
    }
    const role = String(firstNonEmpty(row, roleCols) ?? '').trim();
    if (role) kpi.title = role; // most-recently-processed submission's role wins
    kpi.entries.push({ value: String(Math.round(average * 100) / 100), periodStart: date, periodEnd: date });
  }

  if (skippedNoTester > 0) issues.push(`${skippedNoTester} row(s) had no tester name, skipped`);
  if (skippedNoScores > 0) issues.push(`${skippedNoScores} row(s) had no rating answers, skipped`);
  if (byTester.size > 0) {
    issues.push('detected an evaluation-form export — one KPI per tester, valued as their average rating per submission (target defaulted to "3 - Meets Expectations", this scale\'s own baseline)');
  }

  const kpis = [...byTester.values()].map((kpi) => ({
    ...kpi,
    entries: [...kpi.entries].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd)),
  }));
  return { kpis, issues };
}

/**
 * Parses an uploaded .xlsx spreadsheet into the same RawKpi[] shape the
 * dashboard normally gets from the API. Auto-detects two shapes:
 *
 *  1. A simple tabular sheet — one row per KPI reading, columns Code, Name,
 *     Unit, Direction, Target, Cadence, Period Start, Period End, Value
 *     (any order; only Code/Name/Value required). Multiple rows sharing a
 *     Code become that KPI's history.
 *
 *  2. A wide MS-Forms-style evaluation export — one row per submission, a
 *     "Tester Name" column (possibly duplicated as Tester Name2/3/4 by form
 *     branching), an "Evaluation Period" column, and dozens of "N - Label"
 *     rating columns. Produces one KPI per tester, valued as that
 *     submission's average rating; repeated submissions become history.
 *
 * Either way, rows with a problem are skipped and reported rather than
 * failing the whole import — a spreadsheet with one bad row shouldn't
 * block every other valid one.
 */
export async function parseKpiWorkbook(file: File): Promise<ParsedWorkbook> {
  const rows = (await readSheet(file)) as Row[];

  if (rows.length === 0) {
    return { kpis: [], issues: ['the file has no rows'] };
  }

  if (isEvaluationExport(rows[0]!)) {
    return parseEvaluationExport(rows);
  }

  // the header usually isn't row 1 if there's a title/merged cell above it —
  // scan the first few rows for the one that actually looks like a header
  let headerRowIndex = 0;
  let columnIndex = matchSimpleColumns(rows[0]!);
  for (let r = 0; r < Math.min(5, rows.length); r++) {
    const candidate = matchSimpleColumns(rows[r]!);
    if (isSimpleTable(candidate)) {
      headerRowIndex = r;
      columnIndex = candidate;
      break;
    }
  }

  if (!isSimpleTable(columnIndex)) {
    const detected = rows[0]!
      .map((c) => String(c ?? '').trim())
      .filter(Boolean)
      .join(', ');
    return {
      kpis: [],
      issues: [
        `missing required column(s) — need Code, Name, and Value. First row read as: ${detected || '(empty)'}`,
      ],
    };
  }

  return parseSimpleTable(rows, headerRowIndex, columnIndex);
}
