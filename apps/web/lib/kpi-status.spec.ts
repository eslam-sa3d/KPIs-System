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
  it('bands a raw 0-5 score into four tiers plus pending', () => {
    expect(statusOf(null)).toBe('pending');
    expect(statusOf(5)).toBe('outstanding');
    expect(statusOf(4.5)).toBe('outstanding');
    expect(statusOf(4.01)).toBe('outstanding');
    expect(statusOf(4)).toBe('meets'); // boundary: 4 itself falls to the tier below
    expect(statusOf(3.5)).toBe('meets');
    expect(statusOf(3)).toBe('improve'); // boundary: 3 itself falls to the tier below
    expect(statusOf(2.5)).toBe('improve');
    expect(statusOf(2)).toBe('below'); // boundary: 2 and under is "below expectations"
    expect(statusOf(0)).toBe('below');
  });
});
