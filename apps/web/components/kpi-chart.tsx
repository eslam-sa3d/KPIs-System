'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { palette } from '@pulse/theme';

export interface KpiChartPoint {
  period: string;
  value: number;
}

/**
 * Single-series KPI trend: one axis, thin brand-purple line, dashed target
 * reference, recessive grid, hover tooltip. No legend — the tile title names
 * the series. Loaded via next/dynamic so recharts stays out of the main bundle.
 */
export default function KpiChart({
  points,
  target,
  unit,
}: {
  points: KpiChartPoint[];
  target: number | null;
  unit: string;
}) {
  return (
    <div style={{ width: '100%', height: 280 }}>
      <ResponsiveContainer>
        <LineChart data={points} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={palette.secondary.silverLight} vertical={false} />
          <XAxis
            dataKey="period"
            tick={{ fill: palette.secondary.silver, fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: palette.secondary.silverLight }}
          />
          <YAxis
            width={48}
            tick={{ fill: palette.secondary.silver, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            formatter={(value) => [`${Number(value).toLocaleString()} ${unit}`, 'value']}
            contentStyle={{
              borderRadius: 8,
              border: `1px solid ${palette.secondary.silverLight}`,
              fontFamily: 'inherit',
            }}
          />
          {target !== null && (
            <ReferenceLine
              y={target}
              stroke={palette.secondary.silver}
              strokeDasharray="6 4"
              label={{
                value: `target ${target.toLocaleString()}`,
                position: 'insideTopRight',
                fill: palette.secondary.silver,
                fontSize: 12,
              }}
            />
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke={palette.primary.purple}
            strokeWidth={2}
            dot={{ r: 3, fill: palette.primary.purple, strokeWidth: 0 }}
            activeDot={{ r: 5, stroke: '#ffffff', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
