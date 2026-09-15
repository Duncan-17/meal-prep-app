/**
 * Percentage control for bulk portions.
 *
 * The percentage is of **what is currently left**, not of the original batch —
 * locked decision PLAN.md §1.2b. The label says so out loud, because "50%"
 * meaning different amounts on different days is surprising unless stated.
 */

import { quantityFromPercentOfRemaining } from '@/domain/portions';

interface Props {
  percent: number;
  onChange: (percent: number) => void;
  /** How much is in the fridge right now. */
  remaining: number;
  unit: string;
}

const PRESETS = [10, 25, 33, 50, 75, 100];

export function PercentPicker({ percent, onChange, remaining, unit }: Props) {
  const amount = quantityFromPercentOfRemaining(remaining, percent);

  return (
    <div className="percent">
      <div className="percent__presets">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`percent__preset${percent === preset ? ' percent__preset--on' : ''}`}
            onClick={() => onChange(preset)}
          >
            {preset}%
          </button>
        ))}
      </div>

      <input
        className="percent__slider"
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label="Percentage of what is left"
      />

      <p className="percent__readout">
        <strong>{Math.round(percent)}%</strong> of what is left ={' '}
        {unit === 'g' ? formatWeight(amount) : `${round(amount)} ${unit}`}
      </p>
    </div>
  );
}

function formatWeight(grams: number): string {
  return grams >= 1000 ? `${(grams / 1000).toFixed(2)} kg` : `${Math.round(grams)} g`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
