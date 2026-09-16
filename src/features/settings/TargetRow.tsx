/**
 * One editable target: number, slider, direction, and an optional weekly
 * override.
 *
 * Both a slider and a number field, because they serve different moments —
 * the slider is for "roughly more protein", the field is for "exactly 180 g".
 * The slider's range is derived from the FDA default so it lands somewhere
 * sensible per nutrient rather than using one scale for calories and selenium.
 */

import { useState } from 'react';

import {
  addTarget,
  removeTarget,
  resetTarget,
  setTargetAmount,
  setTargetDirection,
  setTargetWeekly,
} from '@/db/plan';
import {
  hasCustomWeekly,
  weeklyAmount,
  type GoalDirection,
  type NutrientTarget,
} from '@/domain/plan';
import { defaultDirectionFor, defaultTargetFor } from '@/nutrition/targets';
import { getNutrient, nutrientName } from '@/nutrition/registry';

interface Props {
  // Explicitly nullable rather than optional: `exactOptionalPropertyTypes`
  // rejects an `undefined` passed to an optional prop, and these are genuinely
  // "present but unknown" rather than "omitted".
  target: NutrientTarget | undefined;
  /** Needed when there is no target yet, so one can be added. */
  nutrientKey?: string | undefined;
  unit?: string | undefined;
}

export function TargetRow({ target, nutrientKey, unit }: Props) {
  const key = target?.key ?? nutrientKey;
  const [expanded, setExpanded] = useState(false);

  if (key === undefined) return null;

  const definition = getNutrient(key);
  const displayUnit = unit ?? definition?.unit ?? '';

  if (target === undefined) {
    return (
      <div className="target target--empty">
        <span className="target__name">{nutrientName(key)}</span>
        <button
          type="button"
          className="linkbtn"
          onClick={() =>
            void addTarget(key, defaultTargetFor(key)?.amount ?? 0, defaultDirectionFor(key))
          }
        >
          Set a goal
        </button>
      </div>
    );
  }

  const max = sliderMax(key, target.amount);
  const step = sliderStep(max);

  return (
    <div className="target">
      <div className="target__head">
        <button
          type="button"
          className="target__name target__name--button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          {nutrientName(key)}
          {target.isDefault && <span className="badge">FDA default</span>}
          {target.direction === 'max' && <span className="badge badge--limit">limit</span>}
        </button>

        <div className="target__amount">
          <input
            className="field__input target__input"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={roundForDisplay(target.amount)}
            onChange={(event) => void setTargetAmount(key, Number(event.target.value))}
            aria-label={`${nutrientName(key)} daily target`}
          />
          <span className="target__unit">{displayUnit}/day</span>
        </div>
      </div>

      <input
        className="target__slider"
        type="range"
        min={0}
        max={max}
        step={step}
        value={Math.min(target.amount, max)}
        onChange={(event) => void setTargetAmount(key, Number(event.target.value))}
        aria-label={`${nutrientName(key)} slider`}
      />

      <p className="target__weekly">
        {hasCustomWeekly(target) ? 'Weekly goal set separately: ' : 'Weekly: '}
        <strong>
          {roundForDisplay(weeklyAmount(target))} {displayUnit}
        </strong>
        {!hasCustomWeekly(target) && ' (7 × daily)'}
      </p>

      {expanded && (
        <div className="target__detail">
          <label className="field">
            <span className="field__label">Goal type</span>
            <select
              className="field__input"
              value={target.direction}
              onChange={(event) =>
                void setTargetDirection(key, event.target.value as GoalDirection)
              }
            >
              <option value="min">At least (a floor)</option>
              <option value="target">About this much</option>
              <option value="max">At most (a limit)</option>
            </select>
          </label>

          <label className="field">
            <span className="field__label">
              Weekly goal {hasCustomWeekly(target) ? '' : '(defaults to 7 × daily)'}
            </span>
            <div className="yield">
              <input
                className="field__input yield__qty"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={roundForDisplay(weeklyAmount(target))}
                onChange={(event) => void setTargetWeekly(key, Number(event.target.value))}
                aria-label={`${nutrientName(key)} weekly target`}
              />
              <span className="yield__hint">{displayUnit}/week</span>
              {hasCustomWeekly(target) && (
                <button
                  type="button"
                  className="linkbtn"
                  onClick={() => void setTargetWeekly(key, undefined)}
                >
                  Back to 7 × daily
                </button>
              )}
            </div>
          </label>

          <div className="builder__actions">
            {!target.isDefault && defaultTargetFor(key) !== undefined && (
              <button type="button" className="btn" onClick={() => void resetTarget(key)}>
                Reset to FDA default
              </button>
            )}
            <button type="button" className="btn" onClick={() => void removeTarget(key)}>
              Remove this goal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Slider ceiling: roughly twice the FDA default, or twice the current value
 * when there is no default. One fixed scale cannot serve both 2500 kcal and
 * 55 µg of selenium.
 */
function sliderMax(key: string, current: number): number {
  const base = defaultTargetFor(key)?.amount ?? current;
  const ceiling = Math.max(base * 2, current * 1.5, 1);
  return roundToNice(ceiling);
}

function sliderStep(max: number): number {
  if (max <= 5) return 0.05;
  if (max <= 50) return 0.5;
  if (max <= 500) return 5;
  return 25;
}

function roundToNice(value: number): number {
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  return Math.ceil(value / magnitude) * magnitude;
}

function roundForDisplay(value: number): number {
  if (value >= 100) return Math.round(value);
  return Math.round(value * 100) / 100;
}
