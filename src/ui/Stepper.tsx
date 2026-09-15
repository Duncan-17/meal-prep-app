/**
 * Counting control for discrete portions.
 *
 * Big tap targets, because this gets used one-handed with the other hand
 * holding a fork. Half steps are allowed — half a portion is a real thing —
 * but the default step is whole.
 */

interface Props {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
}

export function Stepper({ value, onChange, min = 0, max, step = 1, label }: Props) {
  const canDecrease = value - step >= min - 1e-9;
  const canIncrease = max === undefined || value + step <= max + 1e-9;

  function clamp(next: number): number {
    const lower = Math.max(min, next);
    return max === undefined ? lower : Math.min(max, lower);
  }

  return (
    <div className="stepper">
      <button
        type="button"
        className="stepper__button"
        onClick={() => onChange(clamp(round(value - step)))}
        disabled={!canDecrease}
        aria-label={`Decrease ${label}`}
      >
        −
      </button>

      <input
        className="stepper__value"
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        {...(max === undefined ? {} : { max })}
        value={value}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(clamp(next));
        }}
        aria-label={label}
      />

      <button
        type="button"
        className="stepper__button"
        onClick={() => onChange(clamp(round(value + step)))}
        disabled={!canIncrease}
        aria-label={`Increase ${label}`}
      >
        +
      </button>
    </div>
  );
}

/** Keep 0.1 + 0.2 from becoming 0.30000000000000004 in a visible field. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
