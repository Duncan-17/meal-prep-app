/**
 * A macro as a ring that fills toward its goal.
 *
 * This is a **meter** — one value against one limit — not a chart, so it gets
 * a same-ramp track and a single arc rather than anything with axes.
 *
 * Three things the obvious implementation gets wrong, all handled here:
 *
 * - **Overshoot must be visible.** An arc that simply stops at full makes 310 g
 *   of carbs against a 260 g goal look identical to exactly hitting it. Past
 *   100% the ring completes AND changes to the over-goal colour.
 * - **Colour is never the only signal.** Every ring carries its name and its
 *   numbers; the hue is a second encoding, not the message.
 * - **No target is not zero progress.** A macro with no goal set draws an empty
 *   track and shows the bare value, never "0%" of nothing.
 */

import { progressFor, type NutrientTarget } from '@/domain/plan';
import { formatAmount, getNutrient, nutrientName } from '@/nutrition/registry';
import { STATUS_COLORS, macroColor, prefersDark } from '@/ui/vizPalette';

interface Props {
  nutrientKey: string;
  amount: number;
  target: NutrientTarget | undefined;
  /** Diameter in px. The stroke scales with it. */
  size?: number;
}

/** The registry's formal names are too long to sit under a 96px ring. */
const SHORT_LABEL: Record<string, string> = {
  carbs_g: 'Carbs',
  fat_g: 'Fat',
  protein_g: 'Protein',
  energy_kcal: 'Calories',
};

export function MacroRing({ nutrientKey, amount, target, size = 96 }: Props) {
  const dark = prefersDark();
  const unit = getNutrient(nutrientKey)?.unit ?? '';

  const stroke = Math.max(7, Math.round(size * 0.1));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  const progress = target === undefined ? null : progressFor(amount, target);
  const fraction = progress === null ? 0 : Math.max(0, progress.fraction);
  const over = progress?.status === 'over';

  // The arc never exceeds a full circle; going round twice reads as going round
  // once, which would hide the overshoot entirely.
  const drawn = Math.min(1, fraction);
  const dashOffset = circumference * (1 - drawn);

  const colour = over
    ? target?.direction === 'max'
      ? STATUS_COLORS.critical
      : STATUS_COLORS.warning
    : macroColor(nutrientKey, dark);

  const remaining = target === undefined ? null : target.amount - amount;

  return (
    <div className="ring">
      <span className="ring__label" style={{ color: colour }}>
        {SHORT_LABEL[nutrientKey] ?? nutrientName(nutrientKey)}
      </span>

      <svg
        className="ring__svg"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={
          target === undefined
            ? `${nutrientName(nutrientKey)} ${formatAmount(nutrientKey, amount)} ${unit}, no goal set`
            : `${nutrientName(nutrientKey)} ${formatAmount(nutrientKey, amount)} of ${formatAmount(nutrientKey, target.amount)} ${unit}, ${Math.round(fraction * 100)} percent`
        }
      >
        {/* Track: the same ramp, recessive. */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-sunken)"
          strokeWidth={stroke}
        />
        {drawn > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={colour}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            // Start at twelve o'clock rather than three.
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>

      <span className="ring__centre">
        <span className="ring__value">{formatAmount(nutrientKey, amount)}</span>
        {target !== undefined && (
          <span className="ring__of">
            /{formatAmount(nutrientKey, target.amount)}
            {unit}
          </span>
        )}
      </span>

      <span className="ring__foot">
        {target === undefined
          ? `${unit} · no goal`
          : remaining !== null && remaining >= 0
            ? `${formatAmount(nutrientKey, remaining)}${unit} left`
            : `${formatAmount(nutrientKey, Math.abs(remaining ?? 0))}${unit} over`}
      </span>
    </div>
  );
}
