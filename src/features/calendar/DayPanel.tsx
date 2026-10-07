/**
 * The selected day, underneath the month grid.
 *
 * Shows what was **eaten** first and what is **planned** second. The eating is
 * the record; the cooking is the intention, and by the time you are looking
 * back at a day the record is what you came for.
 */

import { useState } from 'react';

import { QuickAddSheet } from '@/features/log/QuickAddSheet';
import { batchYield, deleteBatch } from '@/db/batches';
import { deleteMealLog } from '@/db/logs';
import { formatAmount } from '@/nutrition/registry';
import { relativeDay, type DayKey } from '@/domain/dates';
import type { Batch, MealLog } from '@/domain/types';

interface Props {
  day: DayKey;
  batches: Batch[];
  logs: MealLog[];
  onSchedule: () => void;
  onCook: (batch: Batch) => void;
}

export function DayPanel({ day, batches, logs, onSchedule, onCook }: Props) {
  const items = logs.flatMap((log) => log.items.map((item) => ({ item, log })));
  const dayCalories = logs.reduce((sum, log) => sum + (log.nutrients.energy_kcal ?? 0), 0);
  const [logging, setLogging] = useState(false);

  return (
    <section className="section">
      <div className="screen__head">
        <h2 className="section__title">{relativeDay(day)}</h2>
        {dayCalories > 0 && (
          <span className="daypanel__total">{formatAmount('energy_kcal', dayCalories)} kcal</span>
        )}
      </div>

      <h3 className="plangroup__title">Eaten</h3>
      {items.length === 0 ? (
        <p className="screen__sub">Nothing logged.</p>
      ) : (
        <ul className="cards">
          {items.map(({ item, log }, index) => (
            <li key={`${log.id}-${index}`}>
              <div className="card">
                <span
                  className="card__dot"
                  style={item.color === undefined ? undefined : { background: item.color }}
                  aria-hidden="true"
                />
                <span className="card__body">
                  <span className="card__name">{item.label}</span>
                  <span className="card__meta">
                    {round(item.quantity)} {item.unit}
                    {item.nutrients.energy_kcal === undefined
                      ? ''
                      : ` · ${formatAmount('energy_kcal', item.nutrients.energy_kcal)} kcal`}
                  </span>
                </span>
                {log.id !== undefined && (
                  <button
                    type="button"
                    className="ingredient__remove"
                    onClick={() => void deleteMealLog(log.id!)}
                    aria-label={`Delete ${item.label} and restore the stock`}
                    title="Deleting restores the stock it used"
                  >
                    ✕
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Logs to THIS day — the one tapped on the grid, not necessarily today. */}
      <button
        type="button"
        className="btn btn--primary daypanel__action"
        onClick={() => setLogging(true)}
      >
        + Log food
      </button>

      <h3 className="plangroup__title">Cooking</h3>
      {batches.length === 0 ? (
        <p className="screen__sub">Nothing scheduled.</p>
      ) : (
        <ul className="cards">
          {batches.map((batch) => (
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
                      onClick={() => onCook(batch)}
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

      <button type="button" className="btn btn--primary" onClick={onSchedule}>
        + Schedule a cook
      </button>

      <QuickAddSheet open={logging} date={day} slot={undefined} onClose={() => setLogging(false)} />
    </section>
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

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
