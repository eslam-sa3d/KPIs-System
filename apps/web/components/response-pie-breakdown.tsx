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
  optionLabels,
  total,
  onSegmentClick,
}: {
  counts: Record<string, number>;
  /** raw value -> display label (e.g. a "link to a user" option's stored
   *  value is that user's id) — display only, onSegmentClick still gets the
   *  raw value so click-to-filter keeps exact-matching the stored answer. */
  optionLabels?: Record<string, string>;
  total: number;
  onSegmentClick?: (value: string) => void;
}) {
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, label: optionLabels?.[value] ?? value, count }));

  // chartSeries is a fixed, accessibility-validated palette that must never be
  // cycled (see its own doc comment) — beyond that many distinct categories,
  // fold the smallest ones into a single "Other" slice instead of reusing colors.
  const data =
    sorted.length > chartSeries.length
      ? [
          ...sorted.slice(0, chartSeries.length - 1),
          {
            value: '__other__',
            label: 'Other',
            count: sorted.slice(chartSeries.length - 1).reduce((sum, s) => sum + s.count, 0),
          },
        ]
      : sorted;
  const colorFor = (i: number) => (i < chartSeries.length ? chartSeries[i] : palette.secondary.silver);

  return (
    <div className="summary-pie">
      <div style={{ width: '100%', height: 200 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="count" nameKey="label" outerRadius={80}>
              {data.map((entry, i) => (
                <Cell key={entry.value} fill={colorFor(i)} />
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
        {data.map(({ value, label, count }, i) => (
          <li key={value} className="summary-pie-legend-row">
            {/* the folded "Other" bucket isn't one real stored answer value, so
                it can't drive click-to-filter like every other real segment */}
            {onSegmentClick && value !== '__other__' ? (
              <button
                type="button"
                className="summary-pie-legend-row-inner summary-bar-row-clickable"
                onClick={() => onSegmentClick(value)}
              >
                <span className="summary-pie-swatch" style={{ background: colorFor(i) }} />
                <span className="summary-bar-label">{label}</span>
                <span className="summary-bar-count muted">
                  {count} ({total ? Math.round((count / total) * 100) : 0}%)
                </span>
              </button>
            ) : (
              <span className="summary-pie-legend-row-inner">
                <span className="summary-pie-swatch" style={{ background: colorFor(i) }} />
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
