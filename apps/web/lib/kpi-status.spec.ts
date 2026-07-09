import { describe, expect, it } from 'vitest';
import { statusOf } from './kpi-status';

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
