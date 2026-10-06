/**
 * Tap-to-schedule (PLAN.md §1.5).
 *
 * Deliberately not drag-and-drop: dragging a Component onto a day is fiddly on
 * a phone and needs a visible source list at all times. Tap the day, pick from
 * a sheet, done.
 */

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { Sheet } from '@/ui/Sheet';
import { listComponents } from '@/db/components';
import { scheduleBatch } from '@/db/batches';
import { formatAmount } from '@/nutrition/registry';
import { relativeDay, type DayKey } from '@/domain/dates';
import type { Component } from '@/domain/types';

interface Props {
  day: DayKey | null;
  onClose: () => void;
}

export function ScheduleSheet({ day, onClose }: Props) {
  const components = useLiveQuery(() => listComponents(), []);
  const [selected, setSelected] = useState<Component | null>(null);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setSelected(null);
    setScale(1);
    setError(null);
  }

  async function confirm() {
    if (day === null || selected === null) return;
    try {
      await scheduleBatch(selected, day, scale);
      reset();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <Sheet
      open={day !== null}
      title={day === null ? 'Schedule' : `Cook on ${relativeDay(day)}`}
      onClose={() => {
        reset();
        onClose();
      }}
    >
      {components === undefined ? (
        <p className="screen__sub">Loading…</p>
      ) : components.length === 0 ? (
        <p className="screen__sub">
          No recipes yet. Build one first — the Recipes tab is where they live.
        </p>
      ) : selected === null ? (
        <ul className="cards">
          {components.map((component) => (
            <li key={component.id}>
              <button
                type="button"
                className="card card--button"
                onClick={() => setSelected(component)}
              >
                <span
                  className="card__dot"
                  style={{ background: component.color }}
                  aria-hidden="true"
                />
                <span className="card__body">
                  <span className="card__name">{component.name}</span>
                  <span className="card__meta">
                    {component.portionStyle === 'bulk'
                      ? `${Math.round(component.baseQuantity)} g`
                      : `${component.baseQuantity} × ${component.baseUnit}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="schedule">
          <div className="schedule__chosen">
            <span className="card__dot" style={{ background: selected.color }} aria-hidden="true" />
            <strong>{selected.name}</strong>
            <button type="button" className="linkbtn" onClick={() => setSelected(null)}>
              Change
            </button>
          </div>

          <div className="field">
            <span className="field__label">How much to cook</span>
            <div className="scale">
              {[0.5, 1, 1.5, 2, 3].map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`scale__option${scale === option ? ' scale__option--on' : ''}`}
                  onClick={() => setScale(option)}
                >
                  {option}×
                </button>
              ))}
            </div>
            <p className="yield__hint">{describeYield(selected, scale)}</p>
          </div>

          {error !== null && (
            <div className="notice notice--error">
              <p className="notice__body">{error}</p>
            </div>
          )}

          <div className="builder__actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancel
            </button>
            <button type="button" className="btn btn--primary" onClick={() => void confirm()}>
              Schedule
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function describeYield(component: Component, scale: number): string {
  const kcal = component.nutritionPerBase.energy_kcal;
  const energy =
    kcal === undefined ? '' : ` · ${formatAmount('energy_kcal', kcal * scale)} kcal total`;

  if (component.portionStyle === 'bulk') {
    return `${Math.round(component.baseQuantity * scale)} g${energy}`;
  }
  return `${component.baseQuantity * scale} × ${component.baseUnit}${energy}`;
}
