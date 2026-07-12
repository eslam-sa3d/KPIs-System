import { describe, expect, it } from 'vitest';
import { FormResponseSummary } from '@pulse/contracts';
import { buildSummaryPdf } from './report-export';

const summary: FormResponseSummary = {
  responses: 3,
  firstResponseAt: '2026-01-01T00:00:00.000Z',
  lastResponseAt: '2026-01-03T00:00:00.000Z',
  fields: [
    { key: 'team', label: 'Team', type: 'short_text', answered: 3, samples: ['ops', 'eng'] },
    {
      key: 'satisfaction',
      label: 'Satisfaction',
      type: 'rating',
      answered: 3,
      counts: { '4': 2, '5': 1 },
      average: 4.33,
    },
  ],
  quiz: { averagePercent: 80, passRate: 0.67, distribution: { '80': 2, '60': 1 } },
};

describe('buildSummaryPdf', () => {
  it('produces a non-empty PDF buffer starting with the %PDF magic header', async () => {
    const buffer = await buildSummaryPdf('geography quiz', summary);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('does not throw for a form with zero responses and no quiz', async () => {
    const empty: FormResponseSummary = { responses: 0, firstResponseAt: null, lastResponseAt: null, fields: [] };
    const buffer = await buildSummaryPdf('empty form', empty);
    expect(buffer.length).toBeGreaterThan(0);
  });
});
