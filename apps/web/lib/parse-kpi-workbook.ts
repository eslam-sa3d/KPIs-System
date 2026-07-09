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
}

export interface ParsedWorkbook {
  kpis: RawKpi[];
  /** row-level problems, e.g. "row 4: missing a value" — shown to the user, not fatal on their own */
  issues: string[];
}

const CADENCES = new Set(['weekly', 'monthly', 'quarterly']);

// header row cells are matched case/spacing-insensitively against these aliases
const COLUMN_ALIASES: Record<string, string[]> = {
  code: ['code', 'kpi code', 'kpi'],
  name: ['name', 'kpi name', 'title'],
  unit: ['unit', 'units'],
  direction: ['direction'],
  target: ['target'],
  cadence: ['cadence', 'frequency'],
  periodStart: ['period start', 'periodstart', 'start', 'start date'],
  periodEnd: ['period end', 'periodend', 'end', 'end date', 'date'],
  value: ['value', 'latest', 'latest value', 'actual'],
};

function normalizeHeader(cell: unknown): string {
  return String(cell ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
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
    const n = Number(raw.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Parses an uploaded .xlsx spreadsheet into the same RawKpi[] shape the
 * dashboard normally gets from the API. Expected columns (header row, any
 * order): Code, Name, Unit, Direction, Target, Cadence, Period Start,
 * Period End, Value. Only Code, Name, and Value are required per row —
 * everything else has a sane default. Rows with a problem are skipped and
 * reported, rather than failing the whole import (a spreadsheet with one
 * typo shouldn't block every other valid row).
 * Multiple rows sharing a Code become that KPI's entries (history), newest first.
 */
export async function parseKpiWorkbook(file: File): Promise<ParsedWorkbook> {
  const rows = await readSheet(file);
  const issues: string[] = [];

  if (rows.length === 0) {
    return { kpis: [], issues: ['the file has no rows'] };
  }

  const headerRow = rows[0]!;
  const columnIndex: Partial<Record<keyof typeof COLUMN_ALIASES, number>> = {};
  headerRow.forEach((cell, index) => {
    const normalized = normalizeHeader(cell);
    for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (aliases.includes(normalized)) columnIndex[key as keyof typeof COLUMN_ALIASES] = index;
    }
  });

  if (columnIndex.code === undefined || columnIndex.name === undefined || columnIndex.value === undefined) {
    return {
      kpis: [],
      issues: ['missing required column(s) — the header row needs at least Code, Name, and Value'],
    };
  }

  const byCode = new Map<string, RawKpi>();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (row.every((cell) => cell === null || cell === undefined || cell === '')) continue; // blank row

    const code = String(row[columnIndex.code] ?? '').trim();
    const name = String(row[columnIndex.name] ?? '').trim();
    const value = toNumber(row[columnIndex.value]);

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
