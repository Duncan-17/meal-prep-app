/**
 * Weight over time.
 *
 * Its own chart rather than another line on the nutrient one — weight is
 * kilograms and those are percentages, and putting two scales on one plot is
 * the misleading thing this codebase refuses to do.
 *
 * A single series needs no legend; the title names it. The goal is a reference
 * line rather than a second series, because it is a constant, not a trend.
 */

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

import { seriesColor, prefersDark } from '@/ui/vizPalette';
import { toDisplayWeight, type WeightUnit } from '@/domain/plan';
import { formatDay } from '@/domain/dates';
import type { WeightEntry } from '@/domain/types';

interface Props {
  entries: WeightEntry[];
  unit: WeightUnit;
  goalKg: number | undefined;
}

export function WeightChart({ entries, unit, goalKg }: Props) {
  const dark = prefersDark();

  if (entries.length < 2) {
    return (
      <p className="screen__sub">
        {entries.length === 0
          ? 'No weight logged yet. Add a reading on the Plan screen.'
          : 'One reading so far — a trend needs at least two.'}
      </p>
    );
  }

  const data = [...entries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => ({
      date: entry.date,
      label: formatDay(entry.date),
      weight: Number(toDisplayWeight(entry.kg, unit).toFixed(1)),
    }));

  return (
    <div className="chart">
      <div className="chart__plot">
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeWidth={1} vertical={false} />
            <XAxis
              dataKey="label"
              stroke="var(--border)"
              tick={{ fill: 'var(--text-dim)', fontSize: 11 }}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              stroke="var(--border)"
              tick={{ fill: 'var(--text-dim)', fontSize: 11 }}
              tickLine={false}
              width={44}
              domain={['dataMin - 1', 'dataMax + 1']}
              tickFormatter={(value: number) => `${value}`}
            />
            {goalKg !== undefined && (
              <ReferenceLine
                y={Number(toDisplayWeight(goalKg, unit).toFixed(1))}
                stroke="var(--text-dim)"
                strokeWidth={1}
                label={{ value: 'goal', position: 'insideTopRight', fontSize: 11 }}
              />
            )}
            <Tooltip
              contentStyle={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                fontSize: 12.5,
                color: 'var(--text)',
              }}
              labelStyle={{ color: 'var(--text-dim)' }}
              formatter={(value: unknown) => [`${String(value)} ${unit}`, 'Weight']}
            />
            <Line
              type="monotone"
              dataKey="weight"
              stroke={seriesColor(0, dark)}
              strokeWidth={2}
              strokeLinecap="round"
              dot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
              activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--surface)' }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="chart__caption">
        Day-to-day readings swing on water and salt — read the shape, not the last point.
      </p>
    </div>
  );
}
