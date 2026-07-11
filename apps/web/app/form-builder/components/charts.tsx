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
function ChartFrame({ className, children }: { className: string; children: React.ReactElement }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return <div className={className}>{ready && <ResponsiveContainer>{children}</ResponsiveContainer>}</div>;
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
    <div className="space-y-2">
      <ChartFrame className="h-44 w-full">
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
      <ul className="space-y-1">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2 text-sm">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: chartSeries[i % chartSeries.length] }} />
            <span className="flex-1 truncate">{d.label}</span>
            <span className="text-xs text-muted-foreground">
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
    <ChartFrame className="h-44 w-full">
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
    <div className="space-y-1">
      <ChartFrame className="h-40 w-full">
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={palette.secondary.silverLight} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: palette.secondary.silver, fontSize: 11 }} tickLine={false} axisLine={{ stroke: palette.secondary.silverLight }} />
          <YAxis width={28} allowDecimals={false} tick={{ fill: palette.secondary.silver, fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ borderRadius: 8, border: `1px solid ${palette.secondary.silverLight}`, fontFamily: 'inherit' }} />
          <Bar dataKey="count" fill={palette.primary.purple} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartFrame>
      {average !== undefined && <p className="text-sm text-muted-foreground">average {average.toFixed(1)}</p>}
    </div>
  );
}

export function GridMatrix({ matrix }: { matrix: Record<string, Record<string, number>> }) {
  const columns = Array.from(new Set(Object.values(matrix).flatMap((row) => Object.keys(row))));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="py-1 pr-3 font-medium" />
            {columns.map((c) => (
              <th key={c} className="px-2 py-1 font-medium">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(matrix).map(([row, dist]) => (
            <tr key={row} className="border-b border-border last:border-0">
              <td className="py-1.5 pr-3 font-medium">{row}</td>
              {columns.map((c) => (
                <td key={c} className="px-2 py-1.5 tabular-nums">{dist[c] ?? 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TextSamples({ samples }: { samples: string[] }) {
  if (samples.length === 0) return <p className="text-sm text-muted-foreground">No responses yet.</p>;
  return (
    <ul className="space-y-1.5">
      {samples.map((s, i) => (
        <li key={i} className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
          “{s}”
        </li>
      ))}
    </ul>
  );
}
