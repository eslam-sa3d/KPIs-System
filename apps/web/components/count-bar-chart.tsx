'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface CountRow {
  label: string;
  count: number;
}

/** Single-series bar chart: a plain count per label — cadence, person, or
 *  department. Replaces the old 4-status stacked distribution chart, which
 *  depended on a normalized 0-5 score to bucket into status bands; this
 *  dashboard shows raw, unnormalized submissions instead, so there's no
 *  status to bucket by, just how much activity there is. */
export default function CountBarChart({
  data,
  textColor,
  gridColor,
  barColor,
  countLabel = 'count',
}: {
  data: CountRow[];
  textColor: string;
  gridColor: string;
  barColor: string;
  countLabel?: string;
}) {
  return (
    <div style={{ width: '100%', height: 220 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
          <CartesianGrid stroke={gridColor} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: textColor, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: gridColor }}
          />
          <YAxis allowDecimals={false} tick={{ fill: textColor, fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: 'transparent' }}
            formatter={(value: number) => [value, countLabel]}
            contentStyle={{ borderRadius: 8, fontSize: 12, fontFamily: 'inherit' }}
          />
          <Bar dataKey="count" name={countLabel} fill={barColor} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
