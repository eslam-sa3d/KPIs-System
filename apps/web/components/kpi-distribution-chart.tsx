'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface DistributionRow {
  level: string;
  exceed: number;
  high: number;
  track: number;
  improve: number;
  critical: number;
}

const SERIES: Array<{ key: keyof Omit<DistributionRow, 'level'>; label: string; color: string }> = [
  { key: 'exceed', label: 'Exceed', color: '#a855f7' },
  { key: 'high', label: 'High performer', color: '#22c55e' },
  { key: 'track', label: 'On track', color: '#3b82f6' },
  { key: 'improve', label: 'Needs improvement', color: '#f59e0b' },
  { key: 'critical', label: 'Critical', color: '#ef4444' },
];

/** Stacked bar: KPI status distribution per level (cadence group). */
export default function KpiDistributionChart({
  data,
  textColor,
  gridColor,
}: {
  data: DistributionRow[];
  textColor: string;
  gridColor: string;
}) {
  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
          <CartesianGrid stroke={gridColor} vertical={false} />
          <XAxis dataKey="level" tick={{ fill: textColor, fontSize: 11 }} tickLine={false} axisLine={{ stroke: gridColor }} />
          <YAxis allowDecimals={false} tick={{ fill: textColor, fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: 'transparent' }}
            contentStyle={{ borderRadius: 8, fontSize: 12, fontFamily: 'inherit' }}
          />
          {SERIES.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} stackId="status" fill={s.color} radius={0} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
