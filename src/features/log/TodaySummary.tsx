/**
 * The day at a glance: calories as the headline, macros as rings.
 *
 * Calories get a bar rather than a fourth ring because they are the number you
 * check first, and a wide bar carries "how much is left" far better at a glance
 * than a small circle. The macros are peers, so they get matching rings.
 *
 * Coverage is surfaced here too. A total built from food that never reported a
 * nutrient is not the same as a measured one, and the ring cannot say that on
 * its own — so a line underneath does (PLAN.md §3c).
 */

import { MacroRing } from '@/ui/MacroRing';
import { coverageNote, isLowCoverage } from '@/domain/coverage';
import { progressFor, type NutrientTarget } from '@/domain/plan';
import { formatAmount } from '@/nutrition/registry';
import { STATUS_COLORS } from '@/ui/vizPalette';
import type { NutrientAggregate } from '@/domain/types';

const MACROS = ['carbs_g', 'fat_g', 'protein_g'] as const;

interface Props {
  totals: NutrientAggregate;
  targets: Map<string, NutrientTarget>;
}

export function TodaySummary({ totals, targets }: Props) {
  const energy = totals.nutrients.energy_kcal ?? 0;
  const energyTarget = targets.get('energy_kcal');

  const progress = energyTarget === undefined ? null : progressFor(energy, energyTarget);
  const fraction = progress === null ? 0 : Math.min(1, Math.max(0, progress.fraction));
  const over = progress?.status === 'over';
  const remaining = energyTarget === undefined ? null : energyTarget.amount - energy;

  // Only mention coverage when it is actually weak; a caveat on every number
  // is noise, and noise gets ignored exactly when it matters.
  const weak = MACROS.filter(
    (key) => key in totals.nutrients && isLowCoverage(totals.coverage, key),
  );

  return (
    <section className="today">
      <div className="today__energy">
        <div className="today__energyhead">
          <span className="today__energyvalue">
            {formatAmount('energy_kcal', energy)}
            <span className="today__energyunit">kcal</span>
          </span>
          {energyTarget !== undefined && (
            <span className="today__energyleft">
              {remaining !== null && remaining >= 0
                ? `${formatAmount('energy_kcal', remaining)} left`
                : `${formatAmount('energy_kcal', Math.abs(remaining ?? 0))} over`}
            </span>
          )}
        </div>

        {energyTarget === undefined ? (
          <p className="today__nogoal">No calorie goal set — add one on the Plan screen.</p>
        ) : (
          <>
            <div
              className="today__bar"
              role="img"
              aria-label={`${Math.round((progress?.fraction ?? 0) * 100)}% of your calorie goal`}
            >
              <span
                className="today__barfill"
                style={{
                  width: `${fraction * 100}%`,
                  background: over ? STATUS_COLORS.warning : 'var(--accent)',
                }}
              />
            </div>
            <p className="today__goal">
              of {formatAmount('energy_kcal', energyTarget.amount)} kcal
              {energyTarget.isDefault && <span className="badge">FDA default</span>}
            </p>
          </>
        )}
      </div>

      <div className="today__rings">
        {MACROS.map((key) => (
          <MacroRing
            key={key}
            nutrientKey={key}
            amount={totals.nutrients[key] ?? 0}
            target={targets.get(key)}
          />
        ))}
      </div>

      {weak.length > 0 && (
        <p className="today__coverage">
          {weak
            .map((key) => `${key.replace('_g', '')}: ${coverageNote(totals.coverage, key) ?? ''}`)
            .join(' · ')}
        </p>
      )}
    </section>
  );
}
