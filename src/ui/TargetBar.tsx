/**
 * One nutrient against its target.
 *
 * A meter, not a chart: a single ratio against a limit. The fill carries the
 * state; the unfilled track stays recessive.
 *
 * State is **direction-aware**, and deliberately quiet when nothing is wrong.
 * Being at 40% of your protein at lunchtime is not a warning, so an unmet
 * minimum renders in the plain accent — only a genuinely notable state
 * (goal met, limit exceeded) takes a status colour, and every one of those is
 * paired with a word so colour never carries the meaning alone.
 */

import { coverageNote } from '@/domain/coverage';
import { progressFor, type NutrientTarget } from '@/domain/plan';
import { formatAmount, getNutrient, nutrientName } from '@/nutrition/registry';
import { STATUS_COLORS } from '@/ui/vizPalette';
import type { Coverage } from '@/domain/types';

interface Props {
  nutrientKey: string;
  amount: number;
  target: NutrientTarget | undefined;
  coverage?: Coverage;
  /** Compact form for the calendar's Specific mode. */
  dense?: boolean;
}

export function TargetBar({ nutrientKey, amount, target, coverage, dense = false }: Props) {
  const unit = getNutrient(nutrientKey)?.unit ?? '';
  const note = coverage === undefined ? null : coverageNote(coverage, nutrientKey);

  // No target means a bare value — never "0% of nothing" (PLAN.md §4).
  if (target === undefined) {
    return (
      <div className={`meter${dense ? ' meter--dense' : ''}`}>
        <div className="meter__head">
          <span className="meter__name">{nutrientName(nutrientKey)}</span>
          <span className="meter__value">
            {formatAmount(nutrientKey, amount)} {unit}
          </span>
        </div>
        <p className="meter__note">no goal set</p>
      </div>
    );
  }

  const { fraction, status } = progressFor(amount, target);
  const percent = Math.round(fraction * 100);

  const fill =
    status === 'met'
      ? STATUS_COLORS.good
      : status === 'over'
        ? target.direction === 'max'
          ? STATUS_COLORS.critical
          : STATUS_COLORS.warning
        : 'var(--accent)';

  return (
    <div className={`meter${dense ? ' meter--dense' : ''}`}>
      <div className="meter__head">
        <span className="meter__name">{nutrientName(nutrientKey)}</span>
        <span className="meter__value">
          {formatAmount(nutrientKey, amount)}
          <span className="meter__of">
            {' / '}
            {formatAmount(nutrientKey, target.amount)} {unit}
          </span>
        </span>
      </div>

      <div
        className="meter__track"
        role="img"
        aria-label={`${nutrientName(nutrientKey)} ${percent}% of ${
          target.direction === 'max' ? 'limit' : 'goal'
        }`}
      >
        <span
          className="meter__fill"
          style={{ width: `${Math.min(100, Math.max(0, fraction * 100))}%`, background: fill }}
        />
        {/* Overshoot needs to be visible, not silently clipped at the end. */}
        {fraction > 1 && <span className="meter__over" style={{ background: fill }} />}
      </div>

      {!dense && (
        <p className="meter__note">
          <StatusWord status={status} direction={target.direction} percent={percent} />
          {target.isDefault && <span className="badge">FDA default</span>}
          {note !== null && <span className="meter__coverage">{note}</span>}
        </p>
      )}
    </div>
  );
}

/**
 * The word beside the bar. Status colour is never the only signal — a reader
 * with colour-vision deficiency, or one glancing at a greyscale screenshot,
 * gets the same information from the text.
 */
function StatusWord({
  status,
  direction,
  percent,
}: {
  status: 'under' | 'met' | 'over';
  direction: NutrientTarget['direction'];
  percent: number;
}) {
  if (direction === 'max') {
    return status === 'over' ? (
      <span className="meter__status meter__status--critical">over the limit · {percent}%</span>
    ) : (
      <span className="meter__status">{percent}% of limit</span>
    );
  }

  if (status === 'met') return <span className="meter__status meter__status--good">goal met</span>;
  if (status === 'over')
    return <span className="meter__status meter__status--warning">over · {percent}%</span>;
  return <span className="meter__status">{percent}% there</span>;
}
