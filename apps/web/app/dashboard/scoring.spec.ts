import { describe, expect, it } from 'vitest';
import {
  avg,
  computeKpi,
  latestAreaValue,
  latestPeriodEntries,
  previousAreaValue,
  round2,
  type RawEntry,
  type RawEvaluationArea,
  type RawKpi,
} from './scoring';

function entry(overrides: Partial<RawEntry> & { value: number | string; periodStart: string }): RawEntry {
  return {
    periodEnd: overrides.periodStart,
    note: null,
    reviewType: null,
    anonymous: false,
    context: null,
    comment: null,
    person: { id: 'person-1', displayName: 'Person' },
    enteredBy: { id: 'rater-1', displayName: 'Rater' },
    ...overrides,
  };
}

function area(overrides: Partial<RawEvaluationArea> & { entries: RawEntry[] }): RawEvaluationArea {
  return { id: 'area-1', name: 'Area', cadence: 'monthly', isActive: true, ...overrides };
}

describe('avg / round2', () => {
  it('averages a list of numbers', () => {
    expect(avg([1, 2, 3])).toBe(2);
  });

  it('rounds to 2 decimal places', () => {
    expect(round2(3.14159)).toBe(3.14);
    expect(round2(3.005)).toBeCloseTo(3.01, 2);
  });
});

describe('latestPeriodEntries', () => {
  it('returns an empty array for an area with no entries', () => {
    expect(latestPeriodEntries(area({ entries: [] }))).toEqual([]);
  });

  it('returns only the entries whose periodStart matches the most recent one', () => {
    const older = entry({ value: 3, periodStart: '2026-01-01' });
    const newer1 = entry({ value: 4, periodStart: '2026-02-01' });
    const newer2 = entry({ value: 5, periodStart: '2026-02-01', enteredBy: { id: 'rater-2', displayName: 'Rater 2' } });
    const result = latestPeriodEntries(area({ entries: [older, newer1, newer2] }));
    expect(result).toEqual([newer1, newer2]);
  });
});

describe('latestAreaValue', () => {
  it('is null when there are no entries', () => {
    expect(latestAreaValue(area({ entries: [] }))).toBeNull();
  });

  it('blends every rater/evaluatee entry in the latest period (multi-rater average, not entries[0])', () => {
    const a = area({
      entries: [
        entry({ value: 2, periodStart: '2026-02-01' }),
        entry({ value: 4, periodStart: '2026-02-01' }),
        entry({ value: 1, periodStart: '2026-01-01' }), // older period, excluded
      ],
    });
    expect(latestAreaValue(a)).toBe(3);
  });
});

describe('previousAreaValue', () => {
  it('is null with fewer than two distinct periods', () => {
    const a = area({ entries: [entry({ value: 5, periodStart: '2026-02-01' })] });
    expect(previousAreaValue(a)).toBeNull();
  });

  it('averages the period immediately before the latest one', () => {
    const a = area({
      entries: [
        entry({ value: 4, periodStart: '2026-02-01' }),
        entry({ value: 2, periodStart: '2026-01-01' }),
        entry({ value: 4, periodStart: '2026-01-01' }),
      ],
    });
    expect(previousAreaValue(a)).toBe(3);
  });
});

describe('computeKpi', () => {
  it("averages across every area's latest value, and picks the most recent periodEnd overall", () => {
    const kpi: RawKpi = {
      id: 'kpi-1',
      name: 'Quality',
      isActive: true,
      weight: '50',
      evaluationAreas: [
        area({
          id: 'a1',
          entries: [entry({ value: 4, periodStart: '2026-02-01', periodEnd: '2026-02-28' })],
        }),
        area({
          id: 'a2',
          entries: [entry({ value: 2, periodStart: '2026-03-01', periodEnd: '2026-03-31' })],
        }),
      ],
    };
    const computed = computeKpi(kpi);
    expect(computed.latestValue).toBe(3);
    expect(computed.lastUpdated).toBe('2026-03-31');
    expect(computed.weight).toBe(50); // Decimal-as-string coerced to a real number
  });

  it('is null (not zero) when no area has ever been scored — "pending", not "scored a 0"', () => {
    const kpi: RawKpi = {
      id: 'kpi-2',
      name: 'Empty',
      isActive: true,
      weight: null,
      evaluationAreas: [area({ entries: [] })],
    };
    const computed = computeKpi(kpi);
    expect(computed.latestValue).toBeNull();
    expect(computed.lastUpdated).toBeNull();
    expect(computed.weight).toBeNull();
  });
});
