'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { chartSeries, palette } from '@pulse/theme';

/** Mutually-exclusive single-answer breakdown: a pie (proportional whole)
 *  plus a swatch legend — recharts' <Pie> alone fails the brand chart-series
 *  contrast note (2 of 6 series read under 3:1), so every slice also carries
 *  a direct label + count in the legend, never color alone.
 *
 *  Its own file so ResponseSummary can code-split recharts out of the main
 *  bundle (next/dynamic only supports a default export, hence that here). */
export default function PieBreakdown({
  counts,
  total,
  onSegmentClick,
}: {
  counts: Record<string, number>;
  total: number;
  onSegmentClick?: (value: string) => void;
}) {
  const data = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }));

  return (
    <div className="summary-pie">
      <div style={{ width: '100%', height: 200 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="count" nameKey="label" outerRadius={80}>
              {data.map((entry, i) => (
                <Cell key={entry.label} fill={chartSeries[i % chartSeries.length]} />
              ))}
            </Pie>
            <RechartsTooltip
              formatter={(value: number, _name, item) => [
                `${value} (${total ? Math.round((value / total) * 100) : 0}%)`,
                item.payload.label,
              ]}
              contentStyle={{
                borderRadius: 8,
                border: `1px solid ${palette.secondary.silverLight}`,
                fontFamily: 'inherit',
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="summary-pie-legend">
        {data.map(({ label, count }, i) => (
          <li key={label} className="summary-pie-legend-row">
            {onSegmentClick ? (
              <button
                type="button"
                className="summary-pie-legend-row-inner summary-bar-row-clickable"
                onClick={() => onSegmentClick(label)}
              >
                <span className="summary-pie-swatch" style={{ background: chartSeries[i % chartSeries.length] }} />
                <span className="summary-bar-label">{label}</span>
                <span className="summary-bar-count muted">
                  {count} ({total ? Math.round((count / total) * 100) : 0}%)
                </span>
              </button>
            ) : (
              <span className="summary-pie-legend-row-inner">
                <span className="summary-pie-swatch" style={{ background: chartSeries[i % chartSeries.length] }} />
                <span className="summary-bar-label">{label}</span>
                <span className="summary-bar-count muted">
                  {count} ({total ? Math.round((count / total) * 100) : 0}%)
                </span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
