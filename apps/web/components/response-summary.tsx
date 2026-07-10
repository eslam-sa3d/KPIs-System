'use client';

import type { FormResponseSummary } from '@pulse/contracts';
import { palette } from '@pulse/theme';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export type ResponseSummaryData = FormResponseSummary;

/** One brand-purple hue, light→dark by share of total — a sequential ramp, not categorical. */
function barColor(share: number): string {
  const min = 30; // % lightness at share=0
  const max = 85; // % lightness at share=1 (near white)
  const lightness = max - share * (max - min);
  return `color-mix(in srgb, ${palette.primary.purple} ${100 - Math.round((lightness / 85) * 40)}%, white)`;
}

function BarBreakdown({
  counts,
  total,
  onSegmentClick,
}: {
  counts: Record<string, number>;
  total: number;
  /** clicking a bar filters the submissions tab to that exact answer */
  onSegmentClick?: (value: string) => void;
}) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <div className="summary-bars">
      {entries.map(([label, count]) => {
        const Row = onSegmentClick ? 'button' : 'div';
        return (
          <Row
            key={label}
            type={onSegmentClick ? 'button' : undefined}
            className={`summary-bar-row${onSegmentClick ? ' summary-bar-row-clickable' : ''}`}
            onClick={onSegmentClick ? () => onSegmentClick(label) : undefined}
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
        <span className="muted">total responses</span>
        {data.lastResponseAt && (
          <span className="muted">
            last response {new Date(data.lastResponseAt).toLocaleString()}
          </span>
        )}
        </CardContent>
      </Card>

      {data.quiz && (
        <Card className="summary-field-card">
          <CardContent>
          <h3>quiz results</h3>
          <p className="muted">
            average score <strong>{data.quiz.averagePercent}%</strong>
            {data.quiz.passRate !== undefined && (
              <> · pass rate <strong>{Math.round(data.quiz.passRate * 100)}%</strong></>
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

          {field.counts && (
            <BarBreakdown
              counts={field.counts}
              total={field.answered}
              // "other:" answers collapse to a single "other" bucket server-side and
              // can't be exact-matched back to their free-text value — skip those
              onSegmentClick={
                onFilterByAnswer && (field.type === 'select' || field.type === 'multi_select')
                  ? (value) => value !== 'other' && onFilterByAnswer(field.key, field.label, value)
                  : undefined
              }
            />
          )}

          {field.type === 'nps' && field.npsScore !== undefined && (
            <p className="summary-nps">
              NPS <strong>{field.npsScore}</strong>
            </p>
          )}

          {(field.type === 'number' || field.type === 'rating') && field.average != null && (
            <p className="muted">
              average <strong>{field.average.toFixed(1)}</strong>
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
                    <TableCell>{statement}</TableCell>
                    {field.scale!.map((_, idx) => (
                      <TableCell key={idx}>{dist[String(idx)] ?? 0}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {field.averagePosition && (
            <ol className="summary-ranking">
              {Object.entries(field.averagePosition)
                .sort((a, b) => a[1] - b[1])
                .map(([value, avg]) => (
                  <li key={value}>
                    {value} <span className="muted">avg. rank {avg.toFixed(1)}</span>
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
