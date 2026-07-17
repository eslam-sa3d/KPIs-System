'use client';

import dynamic from 'next/dynamic';
import type { FormResponseSummary } from '@pulse/contracts';
import { palette } from '@pulse/theme';
import { Card, CardContent } from '@/components/ui/card';
import { LoadingState } from '@/components/loading-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// Lazy-loaded: recharts only ships once a card actually renders a pie chart.
const PieBreakdown = dynamic(() => import('./response-pie-breakdown'), {
  ssr: false,
  loading: () => <LoadingState label="Loading chart…" />,
});

export type ResponseSummaryData = FormResponseSummary;

/** select/boolean/hot_spot are mutually exclusive single answers — their
 *  counts sum to 100%, so a pie's whole-part framing is accurate. Every
 *  other `counts`-bearing type (multi_select, or an ordered scale like
 *  rating/nps) keeps the bar breakdown below instead. */
const PIE_CHART_TYPES = new Set(['select', 'boolean', 'hot_spot']);

/** One brand-purple hue, light→dark by share of total — a sequential ramp, not categorical. */
function barColor(share: number): string {
  const min = 30; // % lightness at share=0
  const max = 85; // % lightness at share=1 (near white)
  const lightness = max - share * (max - min);
  return `color-mix(in srgb, ${palette.primary.purple} ${100 - Math.round((lightness / 85) * 40)}%, white)`;
}

function BarBreakdown({
  counts,
  optionLabels,
  total,
  onSegmentClick,
}: {
  counts: Record<string, number>;
  /** raw value -> display label — see PieBreakdown's own doc for why
   *  onSegmentClick still receives the raw value, not the resolved label. */
  optionLabels?: Record<string, string>;
  total: number;
  /** clicking a bar filters the submissions tab to that exact answer */
  onSegmentClick?: (value: string) => void;
}) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <div className="summary-bars">
      {entries.map(([value, count]) => {
        const label = optionLabels?.[value] ?? value;
        const Row = onSegmentClick ? 'button' : 'div';
        return (
          <Row
            key={value}
            type={onSegmentClick ? 'button' : undefined}
            className={`summary-bar-row${onSegmentClick ? ' summary-bar-row-clickable' : ''}`}
            onClick={onSegmentClick ? () => onSegmentClick(value) : undefined}
          >
            <span className="summary-bar-label">{label}</span>
            <div className="summary-bar-track">
              <div
                className="summary-bar-fill"
                style={{ width: `${(count / max) * 100}%`, background: barColor(count / max) }}
              />
            </div>
            <span className="summary-bar-count muted">
              {count} ({total ? Math.round((count / total) * 100) : 0}%)
            </span>
          </Row>
        );
      })}
    </div>
  );
}

/**
 * MS-Forms-style "response summary" dashboard: one card per question, chart
 * shape driven by the question type. No axis chrome needed at this scale —
 * bars are self-labeled with counts and percentages.
 */
export function ResponseSummary({
  data,
  onFilterByAnswer,
}: {
  data: ResponseSummaryData;
  /** switches to the submissions tab, pre-filtered to fieldKey === value */
  onFilterByAnswer?: (fieldKey: string, label: string, value: string) => void;
}) {
  return (
    <div className="summary-grid">
      <Card className="summary-headline">
        <CardContent>
          <strong>{data.responses}</strong>
          <span className="muted">Total responses</span>
          {data.lastResponseAt && (
            <span className="muted">Last response {new Date(data.lastResponseAt).toLocaleString()}</span>
          )}
        </CardContent>
      </Card>

      {data.quiz && (
        <Card className="summary-field-card">
          <CardContent>
            <h3>Quiz results</h3>
            <p className="muted">
              Average score <strong>{data.quiz.averagePercent}%</strong>
              {data.quiz.passRate !== undefined && (
                <>
                  {' '}
                  · pass rate <strong>{Math.round(data.quiz.passRate * 100)}%</strong>
                </>
              )}
            </p>
            <BarBreakdown
              counts={data.quiz.distribution}
              total={Object.values(data.quiz.distribution).reduce((a, b) => a + b, 0)}
            />
          </CardContent>
        </Card>
      )}

      {data.fields.map((field) => (
        <Card key={field.key} className="summary-field-card">
          <CardContent>
            <h3>{field.label}</h3>
            <p className="muted">{field.answered} response(s)</p>

            {field.counts &&
              (() => {
                const Breakdown = PIE_CHART_TYPES.has(field.type) ? PieBreakdown : BarBreakdown;
                return (
                  <Breakdown
                    counts={field.counts}
                    optionLabels={field.optionLabels}
                    total={field.answered}
                    // "other:" answers collapse to a single "other" bucket server-side and
                    // can't be exact-matched back to their free-text value — skip those
                    onSegmentClick={
                      onFilterByAnswer && (field.type === 'select' || field.type === 'multi_select')
                        ? (value) => value !== 'other' && onFilterByAnswer(field.key, field.label, value)
                        : undefined
                    }
                  />
                );
              })()}

            {field.type === 'nps' && field.npsScore !== undefined && (
              <p className="summary-nps">
                NPS <strong>{field.npsScore}</strong>
              </p>
            )}

            {(field.type === 'number' || field.type === 'rating') && field.average != null && (
              <p className="muted">
                Average <strong>{field.average.toFixed(1)}</strong>
                {field.min != null && field.max != null && ` · range ${field.min}–${field.max}`}
              </p>
            )}

            {field.matrix && field.scale && (
              <Table className="summary-likert-table">
                <TableHeader>
                  <TableRow>
                    <TableHead />
                    {field.scale.map((s) => (
                      <TableHead key={s}>{s}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(field.matrix).map(([statement, dist]) => (
                    <TableRow key={statement}>
                      <TableCell>{field.optionLabels?.[statement] ?? statement}</TableCell>
                      {field.scale!.map((_, idx) => (
                        <TableCell key={idx}>{dist[String(idx)] ?? 0}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {/* grid has no ordered `scale` (its columns are free-text choices,
              not a scale) — derive column order from whatever the matrix holds. */}
            {field.type === 'grid' &&
              field.matrix &&
              (() => {
                const columns = Array.from(new Set(Object.values(field.matrix).flatMap((row) => Object.keys(row))));
                return (
                  <Table className="summary-likert-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead />
                        {columns.map((c) => (
                          <TableHead key={c}>{field.optionLabels?.[c] ?? c}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(field.matrix).map(([row, dist]) => (
                        <TableRow key={row}>
                          <TableCell>{field.optionLabels?.[row] ?? row}</TableCell>
                          {columns.map((c) => (
                            <TableCell key={c}>{dist[c] ?? 0}</TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                );
              })()}

            {field.averagePosition && (
              <ol className="summary-ranking">
                {Object.entries(field.averagePosition)
                  .sort((a, b) => a[1] - b[1])
                  .map(([value, avg]) => (
                    <li key={value}>
                      {field.optionLabels?.[value] ?? value} <span className="muted">avg. rank {avg.toFixed(1)}</span>
                    </li>
                  ))}
              </ol>
            )}

            {field.samples && field.samples.length > 0 && (
              <ul className="summary-samples">
                {field.samples.map((s, i) => (
                  <li key={i}>“{s}”</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
