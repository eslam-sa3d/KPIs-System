'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface ActivityTrendRow {
  weekStart: string;
  count: number;
}

const fmtWeek = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/** Single-series bar chart: new Evaluation Area entries per week — whether
 *  evaluation activity is happening on schedule, or quietly falling behind. */
export default function ActivityTrendChart({
  data,
  textColor,
  gridColor,
  barColor,
}: {
  data: ActivityTrendRow[];
  textColor: string;
  gridColor: string;
  barColor: string;
}) {
  return (
    <div style={{ width: '100%', height: 200 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
          <CartesianGrid stroke={gridColor} vertical={false} />
          <XAxis
            dataKey="weekStart"
            tickFormatter={fmtWeek}
            tick={{ fill: textColor, fontSize: 10.5 }}
            tickLine={false}
            axisLine={{ stroke: gridColor }}
            interval="preserveStartEnd"
          />
          <YAxis allowDecimals={false} tick={{ fill: textColor, fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: 'transparent' }}
            labelFormatter={(v) => `week of ${fmtWeek(String(v))}`}
            formatter={(value: number) => [value, 'scores recorded']}
            contentStyle={{ borderRadius: 8, fontSize: 12, fontFamily: 'inherit' }}
          />
          <Bar dataKey="count" name="scores recorded" fill={barColor} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
