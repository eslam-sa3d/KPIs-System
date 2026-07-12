import { statusOf, type StatusKey } from '../../lib/kpi-status';

export interface RawEntry {
  value: string | number;
  periodStart: string;
  periodEnd: string;
  note: string | null;
  reviewType: string | null;
  anonymous: boolean;
  context: string | null;
  comment: string | null;
  person: { id: string; displayName: string };
  enteredBy: { id: string; displayName: string };
}

export interface RawEvaluationArea {
  id: string;
  name: string;
  cadence: string;
  isActive: boolean;
  entries: RawEntry[];
}

export interface RawKpi {
  id: string;
  name: string;
  isActive: boolean;
  /** relative importance 0-100; null means "no weight set" — see compositeScore. */
  weight: string | number | null;
  evaluationAreas: RawEvaluationArea[];
}

export interface ComputedKpi {
  id: string;
  name: string;
  isActive: boolean;
  areas: RawEvaluationArea[];
  weight: number | null;
  /** average across every area's most recent PERIOD, itself averaged across every rater/evaluatee scored in that period */
  latestValue: number | null;
  status: StatusKey;
  lastUpdated: string | null;
}

export function avg(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Entries arrive ordered periodStart desc (see KpisService.listMine). Multi-rater
 *  means several entries can share one (person, period) slot, so "the latest" is
 *  every entry whose periodStart equals the area's own most recent one — not just
 *  entries[0], which would arbitrarily pick a single rater/evaluatee and ignore the rest. */
export function latestPeriodEntries(area: RawEvaluationArea): RawEntry[] {
  if (area.entries.length === 0) return [];
  const maxPeriodStart = area.entries.reduce(
    (max, e) => (e.periodStart > max ? e.periodStart : max),
    area.entries[0]!.periodStart,
  );
  return area.entries.filter((e) => e.periodStart === maxPeriodStart);
}

/** An area's blended latest score: every rater's and every evaluatee's entry in its most recent period, averaged. */
export function latestAreaValue(area: RawEvaluationArea): number | null {
  const entries = latestPeriodEntries(area);
  return entries.length > 0 ? avg(entries.map((e) => Number(e.value))) : null;
}

/** The period immediately before the area's latest one, for a period-over-period delta. */
export function previousAreaValue(area: RawEvaluationArea): number | null {
  const distinctPeriods = [...new Set(area.entries.map((e) => e.periodStart))].sort().reverse();
  if (distinctPeriods.length < 2) return null;
  const previousPeriod = distinctPeriods[1];
  const entries = area.entries.filter((e) => e.periodStart === previousPeriod);
  return entries.length > 0 ? avg(entries.map((e) => Number(e.value))) : null;
}

export function computeKpi(kpi: RawKpi): ComputedKpi {
  const areaValues = kpi.evaluationAreas.map(latestAreaValue).filter((v): v is number => v !== null);
  const latestValue = areaValues.length > 0 ? round2(avg(areaValues)) : null;
  const lastUpdated =
    kpi.evaluationAreas
      .flatMap(latestPeriodEntries)
      .map((e) => e.periodEnd)
      .sort()
      .at(-1) ?? null;
  return {
    id: kpi.id,
    name: kpi.name,
    isActive: kpi.isActive,
    areas: kpi.evaluationAreas,
    weight: kpi.weight === null ? null : Number(kpi.weight),
    latestValue,
    status: statusOf(latestValue),
    lastUpdated,
  };
}
