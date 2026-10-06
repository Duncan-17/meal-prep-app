/**
 * Reading a week back.
 *
 * Nothing here recomputes nutrition — every meal log snapshotted its own
 * (PLAN.md §3d), so a week is a read and a sum rather than a walk back through
 * ingredients.
 */

import { aggregate } from '@/domain/nutrients';
import { withDerivedTotals } from '@/nutrition/registry';
import { listLogsInRange } from '@/db/logs';
import { listWeightsInRange } from '@/db/plan';
import { weekDays, type DayKey } from '@/domain/dates';
import type { NutrientAggregate, WeightEntry } from '@/domain/types';

export interface DaySeries {
  date: DayKey;
  totals: NutrientAggregate;
  /** Whether anything was logged at all — an empty day is not a zero day. */
  logged: boolean;
}

/**
 * Per-day totals across a week.
 *
 * Days with no logs are included with empty totals and `logged: false`. The
 * distinction matters on a chart: a day you did not log is a gap in the line,
 * not a day you ate nothing.
 */
export async function weekSeries(weekStart: DayKey): Promise<DaySeries[]> {
  const days = weekDays(weekStart);
  const first = days[0] ?? weekStart;
  const last = days[days.length - 1] ?? weekStart;

  const logs = await listLogsInRange(first, last);

  const byDay = new Map<DayKey, typeof logs>();
  for (const log of logs) {
    const existing = byDay.get(log.date);
    if (existing === undefined) byDay.set(log.date, [log]);
    else existing.push(log);
  }

  return days.map((date) => {
    const dayLogs = byDay.get(date) ?? [];
    return {
      date,
      logged: dayLogs.length > 0,
      // Derived totals are recomputed from their parts, so summing days that
      // already carry them and deriving again is consistent.
      totals: withDerivedTotals(
        aggregate(
          dayLogs.map((log) => ({
            nutrients: log.nutrients,
            grams: log.totalGrams,
            coverage: log.coverage,
          })),
        ),
      ),
    };
  });
}

/** The week totalled, for "how did the week measure up" against weekly goals. */
export async function weekTotals(weekStart: DayKey): Promise<NutrientAggregate> {
  const series = await weekSeries(weekStart);
  return withDerivedTotals(
    aggregate(
      series.map((day) => ({
        nutrients: day.totals.nutrients,
        grams: day.totals.totalGrams,
        coverage: day.totals.coverage,
      })),
    ),
  );
}

export async function weekWeights(weekStart: DayKey): Promise<WeightEntry[]> {
  const days = weekDays(weekStart);
  return listWeightsInRange(days[0] ?? weekStart, days[days.length - 1] ?? weekStart);
}

/** How many of the week's days have any log at all. */
export function daysLogged(series: readonly DaySeries[]): number {
  return series.filter((day) => day.logged).length;
}
