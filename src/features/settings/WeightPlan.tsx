/**
 * Weight: where you are, where you want to be, and how fast.
 *
 * Weight is stored in kilograms always and converted for display, so switching
 * units never rewrites history or accumulates rounding error.
 *
 * The number shown as "current" is a **7-day mean**, not today's reading. Body
 * weight swings by a kilo on water and salt alone; a single morning number is
 * close to noise, and a plan built on noise is discouraging for no reason.
 */

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { getPlan, listWeights, logWeight, setWeightGoal, setWeightUnit } from '@/db/plan';
import {
  fromDisplayWeight,
  observedWeeklyChange,
  smoothedWeight,
  toDisplayWeight,
  weightOutlook,
  type WeightUnit,
} from '@/domain/plan';
import { addDays, dayDifference, formatDay, todayKey } from '@/domain/dates';

const RATES = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5];

export function WeightPlan() {
  const plan = useLiveQuery(() => getPlan(), []);
  const weights = useLiveQuery(() => listWeights(30), []);
  const [entry, setEntry] = useState('');

  if (plan === undefined || weights === undefined) {
    return <p className="screen__sub">Loading…</p>;
  }

  const unit: WeightUnit = plan.weightUnit;
  const smoothedKg = smoothedWeight(weights);
  const observed = observedWeeklyChange(weights.slice(0, 14), dayDifference);

  const outlook =
    smoothedKg === null ? null : weightOutlook(smoothedKg, plan.weight, todayKey(), addDays);

  function show(kg: number | null | undefined): string {
    if (kg === null || kg === undefined) return '—';
    return `${toDisplayWeight(kg, unit).toFixed(1)} ${unit}`;
  }

  async function submitWeight() {
    const typed = Number(entry);
    if (!Number.isFinite(typed) || typed <= 0) return;
    await logWeight(todayKey(), fromDisplayWeight(typed, unit));
    setEntry('');
  }

  return (
    <section className="section">
      <div className="screen__head">
        <h2 className="section__title">Weight</h2>
        <div className="segmented segmented--sm">
          {(['kg', 'lb'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={`segmented__option${unit === option ? ' segmented__option--on' : ''}`}
              onClick={() => void setWeightUnit(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="weightnow">
        <div>
          <span className="weightnow__value">{show(smoothedKg)}</span>
          <span className="weightnow__label">
            {weights.length === 0
              ? 'no readings yet'
              : `7-day average of ${weights.length} reading${weights.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <div>
          <span className="weightnow__value">{show(plan.weight.targetKg)}</span>
          <span className="weightnow__label">goal</span>
        </div>
      </div>

      <div className="yield">
        <input
          className="field__input yield__qty"
          type="number"
          inputMode="decimal"
          step="any"
          min="0"
          placeholder={unit}
          value={entry}
          onChange={(event) => setEntry(event.target.value)}
          aria-label={`Today's weight in ${unit}`}
        />
        <button type="button" className="btn" onClick={() => void submitWeight()}>
          Log today
        </button>
      </div>

      <label className="field">
        <span className="field__label">Goal weight</span>
        <div className="yield">
          <input
            className="field__input yield__qty"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={
              plan.weight.targetKg === undefined
                ? ''
                : round1(toDisplayWeight(plan.weight.targetKg, unit))
            }
            onChange={(event) => {
              const typed = Number(event.target.value);
              void setWeightGoal(
                Number.isFinite(typed) && typed > 0
                  ? { targetKg: fromDisplayWeight(typed, unit) }
                  : {},
              );
            }}
            aria-label="Goal weight"
          />
          <span className="yield__hint">{unit}</span>
        </div>
      </label>

      <div className="field">
        <span className="field__label">Rate per week</span>
        <div className="scale">
          {RATES.map((rate) => (
            <button
              key={rate}
              type="button"
              className={`scale__option${plan.weight.weeklyChangeKg === rate ? ' scale__option--on' : ''}`}
              onClick={() => void setWeightGoal({ weeklyChangeKg: rate })}
            >
              {rate === 0 ? 'hold' : `${rate > 0 ? '+' : ''}${round1(toDisplayWeight(rate, unit))}`}
            </button>
          ))}
        </div>
      </div>

      {outlook !== null && plan.weight.targetKg !== undefined && (
        <p className="yield__hint">
          {outlook.weeksRemaining === null
            ? Math.abs(outlook.remainingKg) < 0.05
              ? 'You are at your goal.'
              : 'That rate does not move toward your goal — pick a direction that does.'
            : `${show(Math.abs(outlook.remainingKg))} to go · about ${outlook.weeksRemaining} week${
                outlook.weeksRemaining === 1 ? '' : 's'
              }${outlook.projectedDate === null ? '' : `, around ${formatDay(outlook.projectedDate)}`}`}
        </p>
      )}

      {observed !== null && (
        <p className="yield__hint">
          Actually moving {observed > 0 ? '+' : ''}
          {round1(toDisplayWeight(observed, unit))} {unit}/week over your recent readings.
        </p>
      )}
    </section>
  );
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
