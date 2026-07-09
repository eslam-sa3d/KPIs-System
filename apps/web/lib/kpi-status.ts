/**
 * KPI attainment → status band, generalizing the reference dashboard's
 * fixed 0–5 evaluation-score tiers to any KPI's unit via target-attainment
 * ratio (works identically for "%", "days", "points"…).
 */
export type StatusKey = 'exceed' | 'high' | 'track' | 'improve' | 'critical' | 'pending';

export const STATUS_LABEL: Record<StatusKey, string> = {
  exceed: 'Exceed',
  high: 'High performer',
  track: 'On track',
  improve: 'Needs improvement',
  critical: 'Critical',
  pending: 'Pending',
};

export const STATUS_ICON: Record<StatusKey, string> = {
  exceed: '↑',
  high: '★',
  track: '✓',
  improve: '⚠',
  critical: '●',
  pending: '…',
};

export interface KpiLike {
  target: string | number | null;
  direction: 'higher_is_better' | 'lower_is_better';
  entries: Array<{ value: string | number }>;
}

/** attainment = actual / target, direction-aware — 1.0 means exactly on target. */
export function attainmentOf(kpi: KpiLike): number | null {
  const latest = kpi.entries[0];
  if (!latest || kpi.target === null) return null;
  const value = Number(latest.value);
  const target = Number(kpi.target);
  if (!Number.isFinite(value) || !Number.isFinite(target) || target === 0) return null;
  return kpi.direction === 'higher_is_better' ? value / target : target / value;
}

export function statusOf(attainment: number | null): StatusKey {
  if (attainment === null) return 'pending';
  if (attainment >= 1.15) return 'exceed';
  if (attainment >= 1.0) return 'high';
  if (attainment >= 0.85) return 'track';
  if (attainment >= 0.7) return 'improve';
  return 'critical';
}

export const STATUS_ORDER: StatusKey[] = ['exceed', 'high', 'track', 'improve', 'critical', 'pending'];
