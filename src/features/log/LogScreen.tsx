/**
 * The day's log: what you ate, and the two ways to add to it.
 *
 * Deleting a log restores the stock it consumed — that is the whole loop
 * closing, and the reason `db/logs.ts` does both inside one transaction.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';

import { LogFromFridgeSheet } from '@/features/log/LogFromFridgeSheet';
import { QuickAddSheet } from '@/features/log/QuickAddSheet';
import { listFridge } from '@/db/fridge';
import { dayTotals, deleteMealLog, listLogsForDay } from '@/db/logs';
import { DayDetail } from '@/features/log/DayDetail';
import { TargetBar } from '@/ui/TargetBar';
import { listTargets } from '@/db/plan';
import { targetsByKey } from '@/nutrition/targets';
import { DEFAULT_PINNED_NUTRIENTS, formatAmount } from '@/nutrition/registry';
import { addDays, relativeDay, todayKey, type DayKey } from '@/domain/dates';
import { db } from '@/db/schema';
import type { NutrientTarget } from '@/domain/plan';
import type { FridgeEntry, MealLog, NutrientAggregate } from '@/domain/types';

export function LogScreen() {
  const [date, setDate] = useState<DayKey>(() => todayKey());
  const [fromFridge, setFromFridge] = useState<FridgeEntry | null>(null);
  const [quickAdd, setQuickAdd] = useState(false);

  const logs = useLiveQuery(() => listLogsForDay(date), [date]);
  const totals = useLiveQuery(() => dayTotals(date), [date, logs]);
  const stock = useLiveQuery(() => listFridge(), []);
  const targets = useLiveQuery(() => listTargets(), []);
  const byKey = targetsByKey(targets ?? []);

  return (
    <div className="screen">
      <div className="screen__head">
        <h1 className="screen__title">Log</h1>
        <Link className="btn" to="/plan">
          Plan
        </Link>
      </div>

      <div className="weeknav">
        <button
          type="button"
          className="weeknav__arrow"
          onClick={() => setDate(addDays(date, -1))}
          aria-label="Previous day"
        >
          ‹
        </button>
        <span className="weeknav__label">{relativeDay(date)}</span>
        <button
          type="button"
          className="weeknav__arrow"
          onClick={() => setDate(addDays(date, 1))}
          aria-label="Next day"
        >
          ›
        </button>
      </div>

      {totals !== undefined && Object.keys(totals.nutrients).length > 0 && (
        <DayTotals totals={totals} targets={byKey} />
      )}

      <section className="section">
        <h2 className="section__title">Eaten</h2>
        {logs === undefined ? (
          <p className="screen__sub">Loading…</p>
        ) : logs.length === 0 ? (
          <p className="screen__sub">Nothing logged yet.</p>
        ) : (
          <ul className="cards">
            {logs.map((log) => (
              <li key={log.id}>
                <LoggedMeal log={log} onDelete={() => void deleteMealLog(log.id!)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section">
        <h2 className="section__title">From the fridge</h2>
        {stock === undefined ? (
          <p className="screen__sub">Loading…</p>
        ) : stock.length === 0 ? (
          <p className="screen__sub">
            Nothing cooked. Schedule a batch on the Calendar and mark it cooked.
          </p>
        ) : (
          <ul className="cards">
            {stock.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className="card card--button"
                  onClick={() => setFromFridge(entry)}
                >
                  <span
                    className="card__dot"
                    style={{ background: entry.componentColor }}
                    aria-hidden="true"
                  />
                  <span className="card__body">
                    <span className="card__name">{entry.componentName}</span>
                    <span className="card__meta">
                      {round(entry.remaining)} {entry.unit} left
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button type="button" className="btn btn--primary" onClick={() => setQuickAdd(true)}>
        + Quick Add something else
      </button>

      <LogFromFridgeSheet
        entry={fromFridge}
        date={date}
        slot={undefined}
        onClose={() => setFromFridge(null)}
      />
      <QuickAddSheet
        open={quickAdd}
        date={date}
        slot={undefined}
        onClose={() => setQuickAdd(false)}
      />
    </div>
  );
}

function LoggedMeal({ log, onDelete }: { log: MealLog; onDelete: () => void }) {
  return (
    <div className="card">
      <span className="card__body">
        {log.items.map((item, index) => (
          <span key={`${item.label}-${index}`} className="card__name">
            {item.label}
            <span className="card__meta">
              {' '}
              · {round(item.quantity)} {item.unit}
              {item.nutrients.energy_kcal === undefined
                ? ''
                : ` · ${formatAmount('energy_kcal', item.nutrients.energy_kcal)} kcal`}
            </span>
          </span>
        ))}
      </span>
      <button
        type="button"
        className="ingredient__remove"
        onClick={onDelete}
        aria-label="Delete this log and restore the stock"
        title="Deleting restores the stock it used"
      >
        ✕
      </button>
    </div>
  );
}

/**
 * The day so far, against the plan.
 *
 * Pinned nutrients get meters; the rest live in the full panel below. Coverage
 * rides along on every one — the number is not wrong when coverage is partial,
 * it is incomplete, and saying so is the entire reason coverage exists.
 */
function DayTotals({
  totals,
  targets,
}: {
  totals: NutrientAggregate;
  targets: Map<string, NutrientTarget>;
}) {
  const [pinned, setPinned] = useState<string[]>([...DEFAULT_PINNED_NUTRIENTS]);
  const settings = useLiveQuery(() => db.settings.get('settings'), []);

  // Settings own the pinned list once it exists; the constant is the seed.
  useEffect(() => {
    if (settings?.pinnedNutrients !== undefined && settings.pinnedNutrients.length > 0) {
      setPinned(settings.pinnedNutrients);
    }
  }, [settings]);

  const shown = pinned.filter((key) => key in totals.nutrients);
  if (shown.length === 0) return null;

  return (
    <>
      <section className="section">
        <h2 className="section__title">Today so far</h2>
        {shown.map((key) => (
          <TargetBar
            key={key}
            nutrientKey={key}
            amount={totals.nutrients[key] ?? 0}
            target={targets.get(key)}
            coverage={totals.coverage}
          />
        ))}
      </section>

      <DayDetail totals={totals} targets={targets} />
    </>
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
