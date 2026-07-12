/**
 * Evaluation Area raw score (0–5 scale) → status band. Every score in this
 * system is a direct 0–5 rating (matching the QA evaluation forms this
 * dashboard is built around) — no target/attainment concept: a KPI is just
 * a named container for Evaluation Areas, each scored per person per period.
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

/** Bands a raw value (0–5 scale) into a status. Boundaries are
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

/** Inline style for a status Badge (Lozenge's `style` prop only accepts
 *  `backgroundColor`/`color`, not the `background` shorthand). */
export function statusBadgeStyle(status: StatusKey): { color: string; backgroundColor: string } {
  const color = STATUS_COLOR[status];
  return { color, backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` };
}
