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
 */

import { Suspense, lazy, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { ScheduleSheet } from '@/features/calendar/ScheduleSheet';
import { MarkCookedSheet } from '@/features/calendar/MarkCookedSheet';
import { DayPanel } from '@/features/calendar/DayPanel';
import { groupByDay, listBatchesInRange, pastDueBatches, setBatchStatus } from '@/db/batches';
import { listLogsInRange } from '@/db/logs';
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
import type { Batch, MealLog } from '@/domain/types';

// Recharts lives behind this boundary — see WeekInsight's own note.
const WeekInsight = lazy(() => import('@/features/calendar/WeekInsight'));

/** Beyond this many dots a cell turns to mush, so the rest become "+n". */
const MAX_DOTS = 6;
/** Bars are thicker than dots, so fewer fit. */
const MAX_BARS = 3;

export function CalendarScreen() {
  const [month, setMonth] = useState<DayKey>(() => startOfMonth(todayKey()));
  const [openDay, setOpenDay] = useState<DayKey>(() => todayKey());
  const [scheduling, setScheduling] = useState<DayKey | null>(null);
  const [cooking, setCooking] = useState<Batch | null>(null);
  const [showInsight, setShowInsight] = useState(false);

  const days = monthGrid(month);
  const first = days[0] ?? month;
  const last = days[days.length - 1] ?? month;

  const batches = useLiveQuery(() => listBatchesInRange(first, last), [first, last]);
  const logs = useLiveQuery(() => listLogsInRange(first, last), [first, last]);
  const overdue = useLiveQuery(() => pastDueBatches(todayKey()), []);

  const batchesByDay = groupByDay(batches ?? []);
  const logsByDay = groupLogsByDay(logs ?? []);

  return (
    <div className="screen">
      <div className="screen__head">
        <h1 className="screen__title">Calendar</h1>
        <button
          type="button"
          className="btn"
          onClick={() => setShowInsight(!showInsight)}
          aria-pressed={showInsight}
        >
          {showInsight ? 'Hide trends' : 'Trends'}
        </button>
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
            onSelect={() => setOpenDay(day)}
          />
        ))}
      </div>

      <Legend />

      <DayPanel
        day={openDay}
        batches={batchesByDay.get(openDay) ?? []}
        logs={logsByDay.get(openDay) ?? []}
        onSchedule={() => setScheduling(openDay)}
        onCook={setCooking}
      />

      {showInsight && (
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
  onSelect,
}: {
  day: DayKey;
  inMonth: boolean;
  selected: boolean;
  batches: Batch[];
  logs: MealLog[];
  onSelect: () => void;
}) {
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
            style={{ background: batch.componentColor }}
            title={`${batch.componentName} — ${batch.status}`}
          />
        ))}
      </span>

      <span className="daycell__number">{dayOfMonth(day)}</span>

      <span className="daycell__dots">
        {items.slice(0, MAX_DOTS).map((item, index) => (
          <span
            key={`${item.label}-${index}`}
            className={`eatendot eatendot--${item.kind}`}
            // Quick Add items carry no colour of their own; a neutral dot is
            // honest rather than borrowing some Component's identity.
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

function Legend() {
  return (
    <p className="legend">
      <span className="legend__item">
        <span className="plannedbar legend__bar" aria-hidden="true" /> cooking planned
      </span>
      <span className="legend__item">
        <span className="eatendot legend__dot" aria-hidden="true" /> something eaten
      </span>
    </p>
  );
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
