/**
 * The week view.
 *
 * Overview mode only for now — one mark per scheduled batch, coloured by
 * Component. Specific mode (pinned micronutrient bars) needs targets and meal
 * logs, so it arrives in Phase 7 (PLAN.md §5).
 */

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { ScheduleSheet } from '@/features/calendar/ScheduleSheet';
import { MarkCookedSheet } from '@/features/calendar/MarkCookedSheet';
import { PhasePlaceholder } from '@/ui/PhasePlaceholder';
import {
  batchYield,
  deleteBatch,
  groupByDay,
  listBatchesInRange,
  pastDueBatches,
  setBatchStatus,
} from '@/db/batches';
import {
  addDays,
  dayOfMonth,
  formatWeekRange,
  isPast,
  isToday,
  relativeDay,
  startOfWeek,
  todayKey,
  weekDays,
  weekdayShort,
  type DayKey,
} from '@/domain/dates';
import type { Batch } from '@/domain/types';

export function CalendarScreen() {
  const [weekStart, setWeekStart] = useState<DayKey>(() => startOfWeek(todayKey()));
  const [scheduling, setScheduling] = useState<DayKey | null>(null);
  const [openDay, setOpenDay] = useState<DayKey | null>(null);
  const [cooking, setCooking] = useState<Batch | null>(null);

  const days = weekDays(weekStart);
  const lastDay = days[6] ?? weekStart;

  const batches = useLiveQuery(() => listBatchesInRange(weekStart, lastDay), [weekStart, lastDay]);
  const overdue = useLiveQuery(() => pastDueBatches(todayKey()), []);

  const byDay = groupByDay(batches ?? []);
  const selectedBatches = openDay === null ? [] : (byDay.get(openDay) ?? []);

  return (
    <div className="screen">
      <h1 className="screen__title">Calendar</h1>
      <p className="screen__sub">Week view, scheduled batches, what you ate.</p>

      <div className="weeknav">
        <button
          type="button"
          className="weeknav__arrow"
          onClick={() => setWeekStart(addDays(weekStart, -7))}
          aria-label="Previous week"
        >
          ‹
        </button>
        <span className="weeknav__label">{formatWeekRange(weekStart)}</span>
        <button
          type="button"
          className="weeknav__arrow"
          onClick={() => setWeekStart(addDays(weekStart, 7))}
          aria-label="Next week"
        >
          ›
        </button>
      </div>

      {startOfWeek(todayKey()) !== weekStart && (
        <button
          type="button"
          className="linkbtn"
          onClick={() => setWeekStart(startOfWeek(todayKey()))}
        >
          Back to this week
        </button>
      )}

      {overdue !== undefined && overdue.length > 0 && (
        <PastDueNudge batches={overdue} onSkip={(id) => void setBatchStatus(id, 'skipped')} />
      )}

      <div className="week">
        {days.map((day) => {
          const dayBatches = byDay.get(day) ?? [];
          return (
            <button
              key={day}
              type="button"
              className={[
                'day',
                isToday(day) ? 'day--today' : '',
                isPast(day) ? 'day--past' : '',
                openDay === day ? 'day--open' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setOpenDay(openDay === day ? null : day)}
            >
              <span className="day__weekday">{weekdayShort(day)}</span>
              <span className="day__number">{dayOfMonth(day)}</span>
              <span className="day__marks">
                {dayBatches.slice(0, 4).map((batch) => (
                  <span
                    key={batch.id}
                    className={`mark mark--${batch.portionStyle} mark--${batch.status}`}
                    style={{ background: batch.componentColor }}
                    title={batch.componentName}
                  />
                ))}
                {dayBatches.length > 4 && (
                  <span className="day__more">+{dayBatches.length - 4}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {openDay !== null && (
        <section className="section">
          <h2 className="section__title">{relativeDay(openDay)}</h2>

          {selectedBatches.length === 0 ? (
            <p className="screen__sub">Nothing scheduled.</p>
          ) : (
            <ul className="cards">
              {selectedBatches.map((batch) => (
                <li key={batch.id}>
                  <div className="card">
                    <span
                      className="card__dot"
                      style={{ background: batch.componentColor }}
                      aria-hidden="true"
                    />
                    <span className="card__body">
                      <span className="card__name">{batch.componentName}</span>
                      <span className="card__meta">{describeBatch(batch)}</span>
                    </span>
                    {batch.status === 'planned' && batch.id !== undefined && (
                      <>
                        <button
                          type="button"
                          className="btn stock__adjust"
                          onClick={() => setCooking(batch)}
                        >
                          Cooked
                        </button>
                        <button
                          type="button"
                          className="ingredient__remove"
                          onClick={() => void deleteBatch(batch.id!)}
                          aria-label={`Remove ${batch.componentName}`}
                        >
                          ✕
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <button type="button" className="btn btn--primary" onClick={() => setScheduling(openDay)}>
            + Schedule a cook
          </button>
        </section>
      )}

      <PhasePlaceholder
        phase={7}
        title="Insight"
        items={[
          'Specific mode — pinned micronutrient bars',
          'Day Detail — full nutrient panel vs target, with coverage',
          'Needs your 2500-cal targets (SETUP.md item 9)',
        ]}
      />

      <ScheduleSheet day={scheduling} onClose={() => setScheduling(null)} />
      <MarkCookedSheet batch={cooking} onClose={() => setCooking(null)} />
    </div>
  );
}

function describeBatch(batch: Batch): string {
  const amount =
    batch.portionStyle === 'bulk'
      ? `${Math.round(batchYield(batch))} g`
      : `${batchYield(batch)} × ${batch.baseUnit}`;

  const scale = batch.scale === 1 ? '' : ` · ${batch.scale}× batch`;
  const status = batch.status === 'planned' ? '' : ` · ${batch.status}`;
  return `${amount}${scale}${status}`;
}

/**
 * Planned cooks whose day has gone by.
 *
 * Offers "didn't cook it" rather than silently clearing: a skipped batch was a
 * decision, and the distinction matters when looking back at a week.
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
