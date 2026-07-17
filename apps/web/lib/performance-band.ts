import { chartSeries } from '@pulse/theme';

/** A configured Performance Level, as returned by GET /v1/performance-levels
 *  — the same shape the Configuration page's manager already uses locally. */
export interface PerformanceLevelOption {
  id: string;
  label: string;
  minScore: number;
  maxScore: number;
}

/** A dashboard "band" a team member's latestScore falls into — one per
 *  admin-configured Performance Level (highest range first), plus two fixed
 *  buckets: `UNRANKED_BAND` (has a real latestScore but no configured range
 *  covers it) and `PENDING_BAND` (no scored submission at all yet). Unlike
 *  the old fixed five-tier system, the count and labels here are always
 *  whatever's actually configured on the Configuration page. */
export type BandKey = string;

export const UNRANKED_BAND = 'unranked';
export const PENDING_BAND = 'pending';

export interface Band {
  key: BandKey;
  label: string;
}

const UNRANKED_COLOR = '#8e9aa0'; // palette.secondary.silver — same muted tone as "pending", a real color just not yet in a defined band
const PENDING_COLOR = '#8e9aa0'; // palette.secondary.silver

/** Highest range first, so rank 0 is always the top band regardless of the
 *  order the API returns levels in. */
export function sortLevelsDesc(levels: PerformanceLevelOption[]): PerformanceLevelOption[] {
  return [...levels].sort((a, b) => b.minScore - a.minScore);
}

/** Every band a status strip / filter pill list should show, in display
 *  order: each configured level (highest first), then Unranked, then
 *  Pending — always present even with zero current members, same as the
 *  old fixed five cards always showing. */
export function orderedBands(levels: PerformanceLevelOption[]): Band[] {
  return [
    ...sortLevelsDesc(levels).map((l) => ({ key: l.id, label: l.label })),
    { key: UNRANKED_BAND, label: 'Unranked' },
    { key: PENDING_BAND, label: 'Pending' },
  ];
}

/** Which band a member falls into — mirrors the exact same rule the API
 *  already applies for `performanceLevel` (see TeamMember.performanceLevel):
 *  a real matched level, else Unranked (has a latestScore but no range
 *  covers it), else Pending (no scored submission at all). */
export function bandOf(member: { latestScore: number | null; performanceLevel: { id: string; label: string } | null }): BandKey {
  if (member.performanceLevel) return member.performanceLevel.id;
  return member.latestScore !== null ? UNRANKED_BAND : PENDING_BAND;
}

/** Brand color for a band, assigned by rank (highest configured range
 *  first) from the theme's ordered categorical series — stable as long as
 *  the set of configured levels doesn't change, distinct color per band
 *  regardless of how many are configured. */
export function bandColor(key: BandKey, levels: PerformanceLevelOption[]): string {
  if (key === UNRANKED_BAND) return UNRANKED_COLOR;
  if (key === PENDING_BAND) return PENDING_COLOR;
  const rank = sortLevelsDesc(levels).findIndex((l) => l.id === key);
  return rank === -1 ? UNRANKED_COLOR : chartSeries[rank % chartSeries.length]!;
}

/** Inline style for a band Badge — bypasses Tailwind's utilities layer
 *  (which would otherwise win over any plain CSS class) so the real color
 *  always renders regardless of cascade order, same approach the old fixed
 *  statusBadgeStyle used. */
export function bandBadgeStyle(key: BandKey, levels: PerformanceLevelOption[]): { color: string; background: string } {
  const color = bandColor(key, levels);
  return { color, background: `color-mix(in srgb, ${color} 12%, transparent)` };
}
