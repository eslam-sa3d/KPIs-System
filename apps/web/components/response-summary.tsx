'use client';

import type { FormResponseSummary } from '@pulse/contracts';
import { palette } from '@pulse/theme';

export type ResponseSummaryData = FormResponseSummary;

/** One brand-purple hue, light→dark by share of total — a sequential ramp, not categorical. */
function barColor(share: number): string {
  const min = 30; // % lightness at share=0
  const max = 85; // % lightness at share=1 (near white)
  const lightness = max - share * (max - min);
  return `color-mix(in srgb, ${palette.primary.purple} ${100 - Math.round((lightness / 85) * 40)}%, white)`;
}

function BarBreakdown({ counts, total }: { counts: Record<string, number>; total: number }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <div className="summary-bars">
      {entries.map(([label, count]) => (
        <div key={label} className="summary-bar-row">
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
        </div>
      ))}
    </div>
  );
}

/**
 * MS-Forms-style "response summary" dashboard: one card per question, chart
 * shape driven by the question type. No axis chrome needed at this scale —
 * bars are self-labeled with counts and percentages.
 */
export function ResponseSummary({ data }: { data: ResponseSummaryData }) {
  return (
    <div className="summary-grid">
      <div className="admin-card summary-headline">
        <strong>{data.responses}</strong>
        <span className="muted">total responses</span>
        {data.lastResponseAt && (
          <span className="muted">
            last response {new Date(data.lastResponseAt).toLocaleString()}
          </span>
        )}
      </div>

      {data.quiz && (
        <div className="admin-card summary-field-card">
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
        </div>
      )}

      {data.fields.map((field) => (
        <div key={field.key} className="admin-card summary-field-card">
          <h3>{field.label}</h3>
          <p className="muted">{field.answered} response(s)</p>

          {field.counts && <BarBreakdown counts={field.counts} total={field.answered} />}

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
            <table className="data-table summary-likert-table">
              <thead>
                <tr>
                  <th />
                  {field.scale.map((s) => (
                    <th key={s}>{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(field.matrix).map(([statement, dist]) => (
                  <tr key={statement}>
                    <td>{statement}</td>
                    {field.scale!.map((_, idx) => (
                      <td key={idx}>{dist[String(idx)] ?? 0}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
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
        </div>
      ))}
    </div>
  );
}
