/**
 * KPI raw score (0–5 evaluation scale) → status band. Every KPI in this
 * system is scored 0–5 directly (matches the QA evaluation forms this
 * dashboard is built around) — status is banded from that raw score, not
 * from target-attainment ratio. Attainment (actual ÷ target) is still
 * computed separately (see attainmentOf) and shown as its own metric.
 */
export type StatusKey = 'outstanding' | 'meets' | 'improve' | 'below' | 'pending';

export const STATUS_LABEL: Record<StatusKey, string> = {
  outstanding: 'Outstanding',
  meets: 'Meet expectations',
  improve: 'Needs improvement',
  below: 'Below expectations',
  pending: 'Pending',
};

export const STATUS_ICON: Record<StatusKey, string> = {
  outstanding: '↑',
  meets: '✓',
  improve: '⚠',
  below: '●',
  pending: '…',
};

export interface KpiLike {
  target: string | number | null;
  direction: 'higher_is_better' | 'lower_is_better';
  entries: Array<{ value: string | number }>;
}

/** attainment = actual / target, direction-aware — 1.0 means exactly on target.
 *  A separate metric from status (see statusOf) — shown on its own, not banded. */
export function attainmentOf(kpi: KpiLike): number | null {
  const latest = kpi.entries[0];
  if (!latest || kpi.target === null) return null;
  const value = Number(latest.value);
  const target = Number(kpi.target);
  if (!Number.isFinite(value) || !Number.isFinite(target) || target === 0) return null;
  return kpi.direction === 'higher_is_better' ? value / target : target / value;
}

/** Bands a KPI's latest raw value (0–5 scale) into a status. Boundaries are
 *  exclusive on the low end / inclusive on the high end, except the bottom
 *  tier which catches everything at or below 2. */
export function statusOf(value: number | null): StatusKey {
  if (value === null) return 'pending';
  if (value > 4) return 'outstanding';
  if (value > 3) return 'meets';
  if (value > 2) return 'improve';
  return 'below';
}

export const STATUS_ORDER: StatusKey[] = ['outstanding', 'meets', 'improve', 'below', 'pending'];

/** Pulse brand colors per status band — the single source of truth for both
 *  CSS (via .p-status-* classes, see globals.css) and SVG chart fills
 *  (recharts needs real hex, not custom-property indirection). */
export const STATUS_COLOR: Record<StatusKey, string> = {
  outstanding: '#a54ee1', // moon-light
  meets: '#00c48c', // oasis
  improve: '#ff6a39', // sunset
  below: '#ff375e', // coral
  pending: '#8e9aa0', // silver
};
