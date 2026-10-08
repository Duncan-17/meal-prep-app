/**
 * The week as lines.
 *
 * **Indexed to % of target, deliberately.** Calories and selenium differ by
 * five orders of magnitude, and the honest way to put them on one chart is to
 * express each as a share of its own goal. The alternative — a second y-axis —
 * is the single most misleading thing a chart can do, since the crossing point
 * of two lines then means nothing at all.
 *
 * Four series maximum, from a palette validated for colour-vision deficiency
 * in both themes. A fifth folds into the table rather than inventing a hue.
 *
 * Light-mode aqua and yellow sit under 3:1 against the page, so this chart
 * carries the required relief: **end labels on every line, plus a table view**.
 * Colour is never the only way to tell the series apart.
 */

import { useState } from 'react';
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

import { MAX_SERIES, seriesColor, prefersDark } from '@/ui/vizPalette';
import { progressFor, type NutrientTarget } from '@/domain/plan';
import { formatAmount, nutrientName } from '@/nutrition/registry';
import { weekdayShort } from '@/domain/dates';
import type { DaySeries } from '@/db/insight';

interface Props {
  series: DaySeries[];
  targets: Map<string, NutrientTarget>;
  /** Which nutrients to plot, in order. Only the first four are drawn. */
  keys: readonly string[];
}

export function TrendsChart({ series, targets, keys }: Props) {
  const [showTable, setShowTable] = useState(false);
  const dark = prefersDark();

  const plotted = keys.filter((key) => targets.has(key)).slice(0, MAX_SERIES);
  const folded = keys.filter((key) => targets.has(key)).slice(MAX_SERIES);

  if (plotted.length === 0) {
    return <p className="screen__sub">Set some goals on the Plan screen to see trends.</p>;
  }

  const data = series.map((day) => {
    const row: Record<string, string | number | null> = { day: weekdayShort(day.date) };
    for (const key of plotted) {
      const target = targets.get(key);
      const amount = day.totals.nutrients[key];
      // A day with no log is a GAP, not a zero — Recharts skips nulls, which
      // is the honest rendering of "I did not log that day".
      row[key] =
        !day.logged || amount === undefined || target === undefined
          ? null
          : Math.round(progressFor(amount, target).fraction * 100);
    }
    return row;
  });

  return (
    <div className="chart">
      <div className="chart__head">
        <p className="chart__caption">Each nutrient as a share of its own daily goal.</p>
        <button type="button" className="linkbtn" onClick={() => setShowTable(!showTable)}>
          {showTable ? 'Show chart' : 'Show table'}
        </button>
      </div>

      {showTable ? (
        // Every pinned nutrient with a goal, not just the charted four — the
        // caption below promises the rest are here.
        <TrendTable series={series} keys={[...plotted, ...folded]} />
      ) : (
        <>
          <div className="chart__plot">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data} margin={{ top: 8, right: 46, bottom: 4, left: 0 }}>
                {/* Hairline, solid, recessive — never dashed. */}
                <CartesianGrid stroke="var(--border)" strokeWidth={1} vertical={false} />
                <XAxis
                  dataKey="day"
                  stroke="var(--border)"
                  tick={{ fill: 'var(--text-dim)', fontSize: 11 }}
                  tickLine={false}
                />
                <YAxis
                  stroke="var(--border)"
                  tick={{ fill: 'var(--text-dim)', fontSize: 11 }}
                  tickLine={false}
                  width={38}
                  tickFormatter={(value: number) => `${value}%`}
                />
                {/* The goal line is the point of the chart. */}
                <ReferenceLine y={100} stroke="var(--text-dim)" strokeWidth={1} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    fontSize: 12.5,
                    color: 'var(--text)',
                  }}
                  labelStyle={{ color: 'var(--text-dim)' }}
                  formatter={(value: unknown, name: unknown) => [
                    `${String(value)}%`,
                    nutrientName(String(name)),
                  ]}
                />
                {plotted.map((key, index) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={seriesColor(index, dark)}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    // >= 8px markers with a surface ring, per the mark spec — FILLED
                    // in the series colour. Recharts fills dots white by default, which
                    // left every point blank until hovered (user, 2026-10-08).
                    dot={{
                      r: 4,
                      strokeWidth: 2,
                      stroke: 'var(--surface)',
                      fill: seriesColor(index, dark),
                    }}
                    activeDot={{
                      r: 5,
                      strokeWidth: 2,
                      stroke: 'var(--surface)',
                      fill: seriesColor(index, dark),
                    }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Direct labels: identity never rests on colour alone. */}
          <ul className="chart__legend">
            {plotted.map((key, index) => (
              <li key={key} className="chart__legenditem">
                <span
                  className="chart__swatch"
                  style={{ background: seriesColor(index, dark) }}
                  aria-hidden="true"
                />
                {nutrientName(key)}
              </li>
            ))}
          </ul>
        </>
      )}

      {folded.length > 0 && (
        <p className="chart__caption">
          {folded.length} more pinned nutrient{folded.length === 1 ? '' : 's'} in the table view — a
          chart past four lines stops being readable.
        </p>
      )}
    </div>
  );
}

/** The table view. Also the accessible fallback the palette check requires. */
function TrendTable({ series, keys }: { series: DaySeries[]; keys: readonly string[] }) {
  return (
    <div className="chart__tablewrap">
      <table className="summary">
        <thead>
          <tr>
            <th scope="col">Nutrient</th>
            {series.map((day) => (
              <th key={day.date} scope="col">
                {weekdayShort(day.date)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key}>
              <th scope="row">{nutrientName(key)}</th>
              {series.map((day) => {
                const amount = day.totals.nutrients[key];
                return (
                  <td key={day.date}>
                    {!day.logged || amount === undefined ? '—' : formatAmount(key, amount)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="chart__caption">— means nothing was logged that day.</p>
    </div>
  );
}
