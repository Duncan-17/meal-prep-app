/**
 * The month view.
 *
 * Each day carries two different kinds of information, drawn differently on
 * purpose (the user's own framing, 2026-09-17):
 *
 * - **Cooking is a plan** — a coloured bar across the top of the cell.
 * - **Eating is a fact** — a coloured dot per logged item below it.
 *
 * The dots were the point of this screen all along and were missing until now.
 * PLAN.md §5 always said "one mark per meal log, coloured by Component", and
 * the first build drew marks per scheduled *batch* instead — so you could cook,
 * eat, and see no trace of having eaten anything.
 *
 * A second view, **Trends** (2026-10-06), swaps the marks for how each day
 * measured up: its calories at the top, three columns filling toward the carb,
 * fat and protein goals, and a border — green when calories and all three
 * macros were met, orange when only calories were.
 */

import { Suspense, lazy, useState, type CSSProperties } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { ScheduleSheet } from '@/features/calendar/ScheduleSheet';
import { MarkCookedSheet } from '@/features/calendar/MarkCookedSheet';
import { DayPanel } from '@/features/calendar/DayPanel';
import { groupByDay, listBatchesInRange, pastDueBatches, setBatchStatus } from '@/db/batches';
import { listLogsInRange } from '@/db/logs';
import { listTargets } from '@/db/plan';
import { DAY_MACROS, dayGoalState, progressFor, type NutrientTarget } from '@/domain/plan';
import { addNutrients } from '@/domain/nutrients';
import { targetsByKey } from '@/nutrition/targets';
import { STATUS_COLORS, macroColor, prefersDark } from '@/ui/vizPalette';
import {
  addMonths,
  dayOfMonth,
  formatMonth,
  isPast,
  isSameMonth,
  isToday,
  monthGrid,
  relativeDay,
  startOfMonth,
  todayKey,
  weekdayHeadings,
  type DayKey,
} from '@/domain/dates';
import type { Batch, MealLog, NutrientMap } from '@/domain/types';

// Recharts lives behind this boundary — see WeekInsight's own note.
const WeekInsight = lazy(() => import('@/features/calendar/WeekInsight'));

/** Beyond this many dots a cell turns to mush, so the rest become "+n". */
const MAX_DOTS = 6;
/** Bars are thicker than dots, so fewer fit. */
const MAX_BARS = 3;

type View = 'meals' | 'trends';

/** Short names for the Trends legend and the column titles. */
const MACRO_LABELS: Record<string, string> = {
  carbs_g: 'Carbs',
  fat_g: 'Fat',
  protein_g: 'Protein',
};

export function CalendarScreen() {
  const [month, setMonth] = useState<DayKey>(() => startOfMonth(todayKey()));
  const [openDay, setOpenDay] = useState<DayKey>(() => todayKey());
  const [scheduling, setScheduling] = useState<DayKey | null>(null);
  const [cooking, setCooking] = useState<Batch | null>(null);
  const [view, setView] = useState<View>('meals');

  const days = monthGrid(month);
  const first = days[0] ?? month;
  const last = days[days.length - 1] ?? month;

  const batches = useLiveQuery(() => listBatchesInRange(first, last), [first, last]);
  const logs = useLiveQuery(() => listLogsInRange(first, last), [first, last]);
  const overdue = useLiveQuery(() => pastDueBatches(todayKey()), []);
  const targets = useLiveQuery(() => listTargets(), []);
  const byKey = targetsByKey(targets ?? []);

  const batchesByDay = groupByDay(batches ?? []);
  const logsByDay = groupLogsByDay(logs ?? []);

  return (
    <div className="screen">
      <div className="screen__head">
        <h1 className="screen__title">Calendar</h1>
        <div className="segmented segmented--sm" role="tablist" aria-label="Calendar view">
          {(['meals', 'trends'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={view === option}
              className={`segmented__option${view === option ? ' segmented__option--on' : ''}`}
              onClick={() => setView(option)}
            >
              {option === 'meals' ? 'Meals' : 'Trends'}
            </button>
          ))}
        </div>
      </div>

      <div className="weeknav">
        <button
          type="button"
          className="weeknav__arrow"
          onClick={() => setMonth(addMonths(month, -1))}
          aria-label="Previous month"
        >
          ‹
        </button>
        <span className="weeknav__label">{formatMonth(month)}</span>
        <button
          type="button"
          className="weeknav__arrow"
          onClick={() => setMonth(addMonths(month, 1))}
          aria-label="Next month"
        >
          ›
        </button>
      </div>

      {!isSameMonth(month, todayKey()) && (
        <button
          type="button"
          className="linkbtn"
          onClick={() => setMonth(startOfMonth(todayKey()))}
        >
          Back to this month
        </button>
      )}

      {overdue !== undefined && overdue.length > 0 && (
        <PastDueNudge batches={overdue} onSkip={(id) => void setBatchStatus(id, 'skipped')} />
      )}

      <div className="monthhead">
        {weekdayHeadings().map((heading) => (
          <span key={heading} className="monthhead__cell">
            {heading}
          </span>
        ))}
      </div>

      <div className="month">
        {days.map((day) => (
          <DayCell
            key={day}
            day={day}
            inMonth={isSameMonth(day, month)}
            selected={openDay === day}
            batches={batchesByDay.get(day) ?? []}
            logs={logsByDay.get(day) ?? []}
            view={view}
            targets={byKey}
            onSelect={() => setOpenDay(day)}
          />
        ))}
      </div>

      {view === 'meals' ? <Legend /> : <TrendsLegend />}

      <DayPanel
        day={openDay}
        batches={batchesByDay.get(openDay) ?? []}
        logs={logsByDay.get(openDay) ?? []}
        onSchedule={() => setScheduling(openDay)}
        onCook={setCooking}
      />

      {view === 'trends' && (
        <Suspense fallback={<p className="screen__sub">Loading charts…</p>}>
          <WeekInsight weekStart={openDay} />
        </Suspense>
      )}

      <ScheduleSheet day={scheduling} onClose={() => setScheduling(null)} />
      <MarkCookedSheet batch={cooking} onClose={() => setCooking(null)} />
    </div>
  );
}

function DayCell({
  day,
  inMonth,
  selected,
  batches,
  logs,
  view,
  targets,
  onSelect,
}: {
  day: DayKey;
  inMonth: boolean;
  selected: boolean;
  batches: Batch[];
  logs: MealLog[];
  view: View;
  targets: Map<string, NutrientTarget>;
  onSelect: () => void;
}) {
  if (view === 'trends') {
    return (
      <TrendCell
        day={day}
        inMonth={inMonth}
        selected={selected}
        logs={logs}
        targets={targets}
        onSelect={onSelect}
      />
    );
  }

  // One dot per logged ITEM, not per meal — two things at lunch is two dots.
  const items = logs.flatMap((log) => log.items);

  const className = [
    'daycell',
    inMonth ? '' : 'daycell--outside',
    isToday(day) ? 'daycell--today' : '',
    isPast(day) ? 'daycell--past' : '',
    selected ? 'daycell--selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type="button" className={className} onClick={onSelect}>
      <span className="daycell__bars">
        {batches.slice(0, MAX_BARS).map((batch) => (
          <span
            key={batch.id}
            className={`plannedbar plannedbar--${batch.status}`}
            // A custom property rather than `background`, so the cooked variant
            // can render the same colour as an outline instead of a fill.
            style={{ '--bar-color': batch.componentColor } as CSSProperties}
            title={`${batch.componentName} — ${describeStatus(batch.status)}`}
          />
        ))}
      </span>

      <span className="daycell__number">{dayOfMonth(day)}</span>

      <span className="daycell__dots">
        {items.slice(0, MAX_DOTS).map((item, index) => (
          <span
            key={`${item.label}-${index}`}
            // Items logged before colours existed carry none; a neutral outline
            // is honest rather than borrowing some Component's identity.
            className={`eatendot${item.color === undefined ? ' eatendot--quick' : ''}`}
            style={item.color === undefined ? undefined : { background: item.color }}
            title={`${item.label} · ${round(item.quantity)} ${item.unit}`}
          />
        ))}
        {items.length > MAX_DOTS && (
          <span className="daycell__more">+{items.length - MAX_DOTS}</span>
        )}
      </span>
    </button>
  );
}

/**
 * One day as numbers: calories on top, a column per macro filling toward its
 * goal, and a border for how the day went overall.
 *
 * A day with nothing logged draws no columns and no border — an unlogged day
 * is a gap, not a day that missed every goal.
 */
function TrendCell({
  day,
  inMonth,
  selected,
  logs,
  targets,
  onSelect,
}: {
  day: DayKey;
  inMonth: boolean;
  selected: boolean;
  logs: MealLog[];
  targets: Map<string, NutrientTarget>;
  onSelect: () => void;
}) {
  const dark = prefersDark();
  const logged = logs.length > 0;
  const totals = logs.reduce<NutrientMap>((sum, log) => addNutrients(sum, log.nutrients), {});
  const state = logged ? dayGoalState(totals, targets) : null;
  const kcal = totals.energy_kcal;

  const className = [
    'daycell',
    'daycell--trend',
    inMonth ? '' : 'daycell--outside',
    isToday(day) ? 'daycell--today' : '',
    isPast(day) ? 'daycell--past' : '',
    selected ? 'daycell--selected' : '',
    state === 'all' || state === 'calories' ? 'daycell--goal' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Green: everything met. Orange: calories only. Both paired with a title
  // and the legend, so the colour is never the only way to read it.
  const borderColor =
    state === 'all' ? STATUS_COLORS.good : state === 'calories' ? STATUS_COLORS.serious : undefined;

  return (
    <button
      type="button"
      className={className}
      onClick={onSelect}
      style={borderColor === undefined ? undefined : { borderColor }}
      title={
        state === 'all'
          ? 'Calories and all three macros met'
          : state === 'calories'
            ? 'Calories met, macros not all met'
            : undefined
      }
    >
      <span className="daycell__kcal">{kcal === undefined ? '' : Math.round(kcal)}</span>
      <span className="daycell__number">{dayOfMonth(day)}</span>
      {logged && (
        <span className="macrofill" aria-hidden="true">
          {DAY_MACROS.map((key) => {
            const target = targets.get(key);
            const amount = totals[key];
            const fraction =
              target === undefined || amount === undefined
                ? 0
                : Math.min(1, progressFor(amount, target).fraction);
            return (
              <span key={key} className="macrofill__col" title={MACRO_LABELS[key]}>
                <span
                  className="macrofill__level"
                  style={{ height: `${fraction * 100}%`, background: macroColor(key, dark) }}
                />
              </span>
            );
          })}
        </span>
      )}
    </button>
  );
}

function TrendsLegend() {
  const dark = prefersDark();
  return (
    <p className="legend">
      {DAY_MACROS.map((key) => (
        <span key={key} className="legend__item">
          <span
            className="legend__swatch"
            style={{ background: macroColor(key, dark) }}
            aria-hidden="true"
          />
          {MACRO_LABELS[key]}
        </span>
      ))}
      <span className="legend__item">
        <span
          className="legend__frame"
          style={{ borderColor: STATUS_COLORS.good }}
          aria-hidden="true"
        />
        all met
      </span>
      <span className="legend__item">
        <span
          className="legend__frame"
          style={{ borderColor: STATUS_COLORS.serious }}
          aria-hidden="true"
        />
        calories only
      </span>
    </p>
  );
}

/**
 * Says what the marks mean, because shape alone still has to be learned once.
 * Solid = still to cook, hollow = already cooked — the actionable one is the
 * one that pops.
 */
function Legend() {
  return (
    <p className="legend">
      <span className="legend__item">
        <span className="plannedbar legend__bar" aria-hidden="true" /> to cook
      </span>
      <span className="legend__item">
        <span className="plannedbar plannedbar--cooked legend__bar" aria-hidden="true" /> cooked
      </span>
      <span className="legend__item">
        <span className="eatendot legend__dot" aria-hidden="true" /> eaten
      </span>
    </p>
  );
}

function describeStatus(status: Batch['status']): string {
  if (status === 'planned') return 'still to cook';
  if (status === 'cooked') return 'cooked';
  return 'skipped';
}

function groupLogsByDay(logs: readonly MealLog[]): Map<DayKey, MealLog[]> {
  const map = new Map<DayKey, MealLog[]>();
  for (const log of logs) {
    const existing = map.get(log.date);
    if (existing === undefined) map.set(log.date, [log]);
    else existing.push(log);
  }
  return map;
}

/**
 * Planned cooks whose day has gone by.
 *
 * Offers "didn't cook it" rather than silently clearing: a skipped batch was a
 * decision, and the distinction matters when looking back at a month.
 */
function PastDueNudge({ batches, onSkip }: { batches: Batch[]; onSkip: (id: number) => void }) {
  return (
    <div className="notice notice--warn">
      <p className="notice__title">
        {batches.length} planned cook{batches.length === 1 ? '' : 's'} in the past
      </p>
      <ul className="overdue">
        {batches.slice(0, 4).map((batch) => (
          <li key={batch.id} className="overdue__row">
            <span
              className="card__dot"
              style={{ background: batch.componentColor }}
              aria-hidden="true"
            />
            <span>
              {batch.componentName} · {relativeDay(batch.scheduledFor)}
            </span>
            {batch.id !== undefined && (
              <button type="button" className="linkbtn" onClick={() => onSkip(batch.id!)}>
                Didn’t cook it
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
