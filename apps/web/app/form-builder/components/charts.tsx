'use client';

import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartSeries, palette } from '@pulse/theme';

/** recharts' ResponsiveContainer measures its parent via ResizeObserver at
 *  mount time — when it mounts in the same tick as its parent (e.g. right
 *  after a tab switch swaps this whole subtree in), that first measurement
 *  can land before the parent's CSS layout has settled, most visibly
 *  breaking <Pie> (radius depends on BOTH axes, so a bad height reads as a
 *  clipped half-circle; <Bar> just looks shorter, easy to miss). Mounting
 *  the chart one tick after the wrapping <div> has already painted sidesteps
 *  the race entirely instead of chasing resize-event timing. */
function ChartFrame({ height, children }: { height: number; children: React.ReactElement }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <div style={{ height, width: '100%' }}>{ready && <ResponsiveContainer>{children}</ResponsiveContainer>}</div>
  );
}

/** Mutually-exclusive single-answer breakdown (multiple_choice / dropdown):
 *  proportional whole, so a pie is the accurate shape. Every slice still
 *  carries a direct label + count in the legend below it, not color alone —
 *  two of the six brand chart colors read under 3:1 contrast on their own. */
export function PieBreakdown({ counts }: { counts: Record<string, number> }) {
  const data = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }));
  const total = data.reduce((a, d) => a + d.count, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <ChartFrame height={176}>
        <PieChart>
          <Pie data={data} dataKey="count" nameKey="label" outerRadius={72}>
            {data.map((d, i) => (
              <Cell key={d.label} fill={chartSeries[i % chartSeries.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number, _name, item) => [
              `${value} (${total ? Math.round((value / total) * 100) : 0}%)`,
              item.payload.label,
            ]}
            contentStyle={{ borderRadius: 8, border: `1px solid ${palette.secondary.silverLight}`, fontFamily: 'inherit' }}
          />
        </PieChart>
      </ChartFrame>
      <ul style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {data.map((d, i) => (
          <li key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem' }}>
            <span
              style={{ width: 10, height: 10, flexShrink: 0, borderRadius: '50%', background: chartSeries[i % chartSeries.length] }}
            />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              {d.count} ({total ? Math.round((d.count / total) * 100) : 0}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Not mutually exclusive (checkboxes) or an ordered scale (linear_scale) —
 *  a bar avoids the false "sums to 100%" read a pie would imply. */
export function BarBreakdown({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const data = entries.map(([label, count]) => ({ label, count }));
  return (
    <ChartFrame height={176}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={palette.secondary.silverLight} vertical={false} />
        <XAxis dataKey="label" tick={{ fill: palette.secondary.silver, fontSize: 11 }} tickLine={false} axisLine={{ stroke: palette.secondary.silverLight }} interval={0} angle={-15} textAnchor="end" height={48} />
        <YAxis width={28} allowDecimals={false} tick={{ fill: palette.secondary.silver, fontSize: 11 }} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={{ borderRadius: 8, border: `1px solid ${palette.secondary.silverLight}`, fontFamily: 'inherit' }} />
        <Bar dataKey="count" fill={palette.primary.purple} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartFrame>
  );
}

export function ScaleBreakdown({ scaleCounts, average, min, max }: { scaleCounts: Record<string, number>; average?: number; min: number; max: number }) {
  const data = Array.from({ length: max - min + 1 }, (_, i) => {
    const value = String(min + i);
    return { label: value, count: scaleCounts[value] ?? 0 };
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <ChartFrame height={160}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={palette.secondary.silverLight} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: palette.secondary.silver, fontSize: 11 }} tickLine={false} axisLine={{ stroke: palette.secondary.silverLight }} />
          <YAxis width={28} allowDecimals={false} tick={{ fill: palette.secondary.silver, fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ borderRadius: 8, border: `1px solid ${palette.secondary.silverLight}`, fontFamily: 'inherit' }} />
          <Bar dataKey="count" fill={palette.primary.purple} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartFrame>
      {average !== undefined && (
        <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>average {average.toFixed(1)}</p>
      )}
    </div>
  );
}

export function GridMatrix({ matrix }: { matrix: Record<string, Record<string, number>> }) {
  const columns = Array.from(new Set(Object.values(matrix).flatMap((row) => Object.keys(row))));
  const headCellStyle: React.CSSProperties = { padding: '4px 12px 4px 0', fontWeight: 500 };
  const dataHeadCellStyle: React.CSSProperties = { padding: '4px 8px', fontWeight: 500 };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', fontSize: '0.875rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            <th style={headCellStyle} />
            {columns.map((c) => (
              <th key={c} style={dataHeadCellStyle}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(matrix).map(([row, dist], i, arr) => (
            <tr key={row} style={{ borderBottom: i === arr.length - 1 ? 'none' : '1px solid var(--color-border)' }}>
              <td style={{ padding: '6px 12px 6px 0', fontWeight: 500 }}>{row}</td>
              {columns.map((c) => (
                <td key={c} style={{ padding: '6px 8px', fontVariantNumeric: 'tabular-nums' }}>{dist[c] ?? 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TextSamples({ samples }: { samples: string[] }) {
  if (samples.length === 0) {
    return <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>No responses yet.</p>;
  }
  return (
    <ul style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {samples.map((s, i) => (
        <li
          key={i}
          style={{
            borderRadius: 8,
            border: '1px solid var(--color-border)',
            background: 'color-mix(in srgb, var(--color-surface) 30%, transparent)',
            padding: '8px 12px',
            fontSize: '0.875rem',
          }}
        >
          “{s}”
        </li>
      ))}
    </ul>
  );
}
