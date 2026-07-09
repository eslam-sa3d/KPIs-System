import { describe, expect, it } from 'vitest';
import { attainmentOf, statusOf } from './kpi-status';

describe('attainmentOf', () => {
  it('computes ratio directly for higher-is-better KPIs', () => {
    const kpi = { target: '40', direction: 'higher_is_better' as const, entries: [{ value: '46' }] };
    expect(attainmentOf(kpi)).toBeCloseTo(1.15, 5);
  });

  it('inverts the ratio for lower-is-better KPIs', () => {
    const kpi = { target: '5', direction: 'lower_is_better' as const, entries: [{ value: '4' }] };
    expect(attainmentOf(kpi)).toBeCloseTo(1.25, 5);
  });

  it('returns null with no entries', () => {
    expect(attainmentOf({ target: '40', direction: 'higher_is_better', entries: [] })).toBeNull();
  });

  it('returns null with no target set', () => {
    expect(
      attainmentOf({ target: null, direction: 'higher_is_better', entries: [{ value: '46' }] }),
    ).toBeNull();
  });

  it('returns null for a zero target (avoids divide-by-zero)', () => {
    expect(
      attainmentOf({ target: '0', direction: 'higher_is_better', entries: [{ value: '10' }] }),
    ).toBeNull();
  });

  it('uses only the most recent (first) entry', () => {
    const kpi = {
      target: '10',
      direction: 'higher_is_better' as const,
      entries: [{ value: '20' }, { value: '5' }],
    };
    expect(attainmentOf(kpi)).toBeCloseTo(2.0, 5);
  });
});

describe('statusOf', () => {
  it('bands attainment into the five score tiers plus pending', () => {
    expect(statusOf(null)).toBe('pending');
    expect(statusOf(1.2)).toBe('exceed');
    expect(statusOf(1.15)).toBe('exceed'); // boundary inclusive
    expect(statusOf(1.05)).toBe('high');
    expect(statusOf(1.0)).toBe('high'); // boundary inclusive
    expect(statusOf(0.9)).toBe('track');
    expect(statusOf(0.85)).toBe('track'); // boundary inclusive
    expect(statusOf(0.75)).toBe('improve');
    expect(statusOf(0.7)).toBe('improve'); // boundary inclusive
    expect(statusOf(0.69)).toBe('critical');
    expect(statusOf(0)).toBe('critical');
  });
});
