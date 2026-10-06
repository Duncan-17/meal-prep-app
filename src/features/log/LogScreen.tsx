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
import { TodaySummary } from '@/features/log/TodaySummary';
import { QuickAddSheet } from '@/features/log/QuickAddSheet';
import { listFridge } from '@/db/fridge';
import { dayTotals, deleteMealLog, listLogsForDay } from '@/db/logs';
import { DayDetail } from '@/features/log/DayDetail';
import { TargetBar } from '@/ui/TargetBar';
import { segmentsForLogs, type SegmentsFor } from '@/ui/SegmentedFill';
import { listTargets } from '@/db/plan';
import { targetsByKey } from '@/nutrition/targets';
import { DEFAULT_PINNED_NUTRIENTS, formatAmount } from '@/nutrition/registry';
import { addDays, relativeDay, todayKey, type DayKey } from '@/domain/dates';
import { db } from '@/db/schema';
import type { NutrientTarget } from '@/domain/plan';
import type { FridgeEntry, MealLog, NutrientAggregate } from '@/domain/types';

/** Already drawn as rings at the top — never repeat these in the list below. */
const RINGED = new Set(['energy_kcal', 'carbs_g', 'fat_g', 'protein_g']);

export function LogScreen() {
  const [date, setDate] = useState<DayKey>(() => todayKey());
  const [fromFridge, setFromFridge] = useState<FridgeEntry | null>(null);
  const [quickAdd, setQuickAdd] = useState(false);

  const logs = useLiveQuery(() => listLogsForDay(date), [date]);
  const totals = useLiveQuery(() => dayTotals(date), [date, logs]);
  const stock = useLiveQuery(() => listFridge(), []);
  const targets = useLiveQuery(() => listTargets(), []);
  const byKey = targetsByKey(targets ?? []);
  const segmentsFor = segmentsForLogs(logs ?? []);

  return (
    <div className="screen">
      <div className="screen__head">
        <h1 className="screen__title">Diary</h1>
        <div className="screen__actions">
          <Link className="btn" to="/plan">
            Plan
          </Link>
          <button type="button" className="btn btn--primary" onClick={() => setQuickAdd(true)}>
            + Log food
          </button>
        </div>
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

      {totals !== undefined && targets !== undefined && (
        <TodaySummary totals={totals} targets={byKey} segmentsFor={segmentsFor} />
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
          <p className="screen__sub">Nothing in the fridge.</p>
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

      {totals !== undefined && Object.keys(totals.nutrients).length > 0 && (
        <PinnedTotals totals={totals} targets={byKey} segmentsFor={segmentsFor} />
      )}

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
            {/* The key to the bars above: this food's slice is this colour. */}
            <span
              className={`eatendot loggeddot${item.color === undefined ? ' eatendot--quick' : ''}`}
              style={item.color === undefined ? undefined : { background: item.color }}
              aria-hidden="true"
            />
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
/**
 * The pinned nutrients the rings do NOT already cover.
 *
 * Calories and the three macros live in the rings above; repeating them here
 * showed the same number twice on one screen. This is the micronutrient tail —
 * iron, B12, whatever the user pinned — which has nowhere else to appear.
 */
function PinnedTotals({
  totals,
  targets,
  segmentsFor,
}: {
  totals: NutrientAggregate;
  targets: Map<string, NutrientTarget>;
  segmentsFor: SegmentsFor;
}) {
  const [pinned, setPinned] = useState<string[]>([...DEFAULT_PINNED_NUTRIENTS]);
  const settings = useLiveQuery(() => db.settings.get('settings'), []);

  // Settings own the pinned list once it exists; the constant is the seed.
  useEffect(() => {
    if (settings?.pinnedNutrients !== undefined && settings.pinnedNutrients.length > 0) {
      setPinned(settings.pinnedNutrients);
    }
  }, [settings]);

  const shown = pinned.filter((key) => key in totals.nutrients && !RINGED.has(key));
  if (shown.length === 0) {
    return <DayDetail totals={totals} targets={targets} segmentsFor={segmentsFor} />;
  }

  return (
    <>
      <section className="section">
        <h2 className="section__title">Also tracking</h2>
        {shown.map((key) => (
          <TargetBar
            key={key}
            nutrientKey={key}
            amount={totals.nutrients[key] ?? 0}
            target={targets.get(key)}
            coverage={totals.coverage}
            segments={segmentsFor(key)}
          />
        ))}
      </section>

      <DayDetail totals={totals} targets={targets} segmentsFor={segmentsFor} />
    </>
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
