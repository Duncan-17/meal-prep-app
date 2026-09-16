/**
 * How the week measured up.
 *
 * Default-exported and loaded lazily: Recharts is ~380 kB, and this view only
 * appears behind the Specific toggle. Keeping it out of the entry chunk means
 * opening the app to log a meal does not pay for a charting library.
 *
 * Weekly totals are compared against each target's **weekly** figure — which
 * is daily × 7 unless set otherwise, so a plan that varies across the week is
 * judged on its own terms rather than on seven identical days.
 */

import { useLiveQuery } from 'dexie-react-hooks';

import { TrendsChart } from '@/features/insight/TrendsChart';
import { WeightChart } from '@/features/insight/WeightChart';
import { TargetBar } from '@/ui/TargetBar';
import { daysLogged, weekSeries, weekTotals, weekWeights } from '@/db/insight';
import { getPlan, listTargets } from '@/db/plan';
import { db } from '@/db/schema';
import { weeklyAmount } from '@/domain/plan';
import { targetsByKey } from '@/nutrition/targets';
import { DEFAULT_PINNED_NUTRIENTS } from '@/nutrition/registry';
import type { DayKey } from '@/domain/dates';

export default function WeekInsight({ weekStart }: { weekStart: DayKey }) {
  const series = useLiveQuery(() => weekSeries(weekStart), [weekStart]);
  const totals = useLiveQuery(() => weekTotals(weekStart), [weekStart]);
  const weights = useLiveQuery(() => weekWeights(weekStart), [weekStart]);
  const targets = useLiveQuery(() => listTargets(), []);
  const plan = useLiveQuery(() => getPlan(), []);
  const settings = useLiveQuery(() => db.settings.get('settings'), []);

  if (series === undefined || totals === undefined || targets === undefined) {
    return <p className="screen__sub">Loading…</p>;
  }

  const pinned =
    settings?.pinnedNutrients !== undefined && settings.pinnedNutrients.length > 0
      ? settings.pinnedNutrients
      : [...DEFAULT_PINNED_NUTRIENTS];

  const byKey = targetsByKey(targets);
  const logged = daysLogged(series);

  return (
    <>
      <section className="section">
        <h2 className="section__title">This week</h2>
        <p className="screen__sub">
          {logged === 0
            ? 'Nothing logged this week yet.'
            : `${logged} of 7 days logged. Totals below are against your weekly goals.`}
        </p>

        {logged > 0 &&
          pinned
            .filter((key) => key in totals.nutrients)
            .map((key) => {
              const target = byKey.get(key);
              return (
                <TargetBar
                  key={key}
                  nutrientKey={key}
                  amount={totals.nutrients[key] ?? 0}
                  // Judge the week against the weekly figure, not the daily one.
                  target={
                    target === undefined ? undefined : { ...target, amount: weeklyAmount(target) }
                  }
                  coverage={totals.coverage}
                />
              );
            })}
      </section>

      <section className="section">
        <h2 className="section__title">Daily trend</h2>
        <TrendsChart series={series} targets={byKey} keys={pinned} />
      </section>

      <section className="section">
        <h2 className="section__title">Weight</h2>
        <WeightChart
          entries={weights ?? []}
          unit={plan?.weightUnit ?? 'kg'}
          goalKg={plan?.weight.targetKg}
        />
      </section>
    </>
  );
}
