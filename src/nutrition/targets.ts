/**
 * Default daily targets.
 *
 * Every value here is a **placeholder** carrying `isDefault: true`, and the UI
 * must render it as a default rather than as the user's goal (PLAN.md §1.3).
 * They are FDA Daily Values for adults, which are a defensible starting point
 * and nothing more.
 *
 * The real 2500-calorie plan numbers are SETUP.md item 9 and have not been
 * supplied yet. When they arrive they replace these with `isDefault: false`;
 * anything the user does not specify keeps falling back to the value here.
 */

import type { NutrientTarget } from '@/domain/types';

/**
 * The user described a 2500-calorie plan, so energy is seeded at 2500 rather
 * than the 2000 the Daily Values assume. Still flagged default — it has not
 * been confirmed, and the macro split it implies is unknown.
 */
const DEFAULT_ENERGY_KCAL = 2500;

const DEFAULTS: ReadonlyArray<readonly [string, number]> = [
  // Macros — FDA DV, except energy.
  ['energy_kcal', DEFAULT_ENERGY_KCAL],
  ['protein_g', 50],
  ['fat_g', 78],
  ['carbs_g', 275],
  ['fiber_g', 28],
  ['sugars_added_g', 50],

  // Fats
  ['saturated_fat_g', 20],
  ['cholesterol_mg', 300],

  // Minerals
  ['sodium_mg', 2300],
  ['potassium_mg', 4700],
  ['calcium_mg', 1300],
  ['iron_mg', 18],
  ['magnesium_mg', 420],
  ['phosphorus_mg', 1250],
  ['zinc_mg', 11],
  ['copper_mg', 0.9],
  ['manganese_mg', 2.3],
  ['selenium_ug', 55],
  ['iodine_ug', 150],

  // Vitamins
  ['vitamin_a_rae_ug', 900],
  ['vitamin_c_mg', 90],
  ['vitamin_d_ug', 20],
  ['vitamin_e_mg', 15],
  ['vitamin_k_ug', 120],
  ['thiamin_mg', 1.2],
  ['riboflavin_mg', 1.3],
  ['niacin_mg', 16],
  ['vitamin_b6_mg', 1.7],
  ['folate_dfe_ug', 400],
  ['vitamin_b12_ug', 2.4],
  ['pantothenic_acid_mg', 5],
  ['choline_mg', 550],
];

export function defaultTargets(): NutrientTarget[] {
  return DEFAULTS.map(([key, amount]) => ({ key, amount, isDefault: true }));
}

/**
 * Progress toward a target, or null when there is no target for this nutrient.
 *
 * Null is meaningful: a nutrient with no target renders as a bare value, never
 * as "0% of nothing" (PLAN.md §4).
 */
export function fractionOfTarget(
  amount: number,
  target: NutrientTarget | undefined,
): number | null {
  if (target === undefined || !(target.amount > 0)) return null;
  return amount / target.amount;
}

/** Index targets by nutrient key for lookup while rendering a panel. */
export function targetsByKey(targets: readonly NutrientTarget[]): Map<string, NutrientTarget> {
  return new Map(targets.map((target) => [target.key, target]));
}
