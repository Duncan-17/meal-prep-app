/**
 * The default plan template.
 *
 * FDA Daily Values for adults, plus IOM total-water intake. Every entry is a
 * **starting point** carrying `isDefault: true`, and the UI marks it as a
 * default rather than as the user's own goal (PLAN.md §1.3). Editing one
 * clears that flag; "Reset to FDA defaults" puts it back.
 *
 * Directions matter as much as amounts. Sodium, saturated fat, added sugars
 * and cholesterol are LIMITS — showing 100% of them as an achievement would be
 * exactly backwards. See `domain/plan.ts`.
 */

import type { GoalDirection, NutrientTarget } from '@/domain/plan';

/**
 * The user described a 2500-calorie plan, so energy is seeded at 2500 rather
 * than the 2000 the Daily Values assume. Still flagged default until confirmed.
 */
const DEFAULT_ENERGY_KCAL = 2500;

type Seed = readonly [key: string, amount: number, direction: GoalDirection];

const DEFAULTS: readonly Seed[] = [
  // ── The headline numbers ──────────────────────────────────────────────
  ['energy_kcal', DEFAULT_ENERGY_KCAL, 'target'],
  ['protein_g', 150, 'min'],
  ['carbs_g', 275, 'target'],
  ['fat_g', 78, 'target'],
  ['fiber_g', 28, 'min'],

  /**
   * Total water, not drinking water alone. The IOM figure for adult men is
   * 3.7 L/day from ALL sources, food included — and `water_g` is exactly that,
   * since every logged food carries its own water content. Roughly 1 g = 1 ml.
   */
  ['water_g', 3700, 'min'],

  // ── Limits ────────────────────────────────────────────────────────────
  ['saturated_fat_g', 20, 'max'],
  ['trans_fat_g', 2, 'max'],
  ['cholesterol_mg', 300, 'max'],
  ['sodium_mg', 2300, 'max'],
  ['sugars_added_g', 50, 'max'],

  // ── Minerals ──────────────────────────────────────────────────────────
  ['potassium_mg', 4700, 'min'],
  ['calcium_mg', 1300, 'min'],
  ['iron_mg', 18, 'min'],
  ['magnesium_mg', 420, 'min'],
  ['phosphorus_mg', 1250, 'min'],
  ['zinc_mg', 11, 'min'],
  ['copper_mg', 0.9, 'min'],
  ['manganese_mg', 2.3, 'min'],
  ['selenium_ug', 55, 'min'],
  ['iodine_ug', 150, 'min'],

  // ── Vitamins ──────────────────────────────────────────────────────────
  ['vitamin_a_rae_ug', 900, 'min'],
  ['vitamin_c_mg', 90, 'min'],
  ['vitamin_d_ug', 20, 'min'],
  ['vitamin_e_mg', 15, 'min'],
  ['vitamin_k_ug', 120, 'min'],
  ['thiamin_mg', 1.2, 'min'],
  ['riboflavin_mg', 1.3, 'min'],
  ['niacin_mg', 16, 'min'],
  ['vitamin_b6_mg', 1.7, 'min'],
  ['folate_dfe_ug', 400, 'min'],
  ['vitamin_b12_ug', 2.4, 'min'],
  ['pantothenic_acid_mg', 5, 'min'],
  ['choline_mg', 550, 'min'],

  // ── Fats worth watching rather than limiting ──────────────────────────
  ['omega3_epa_g', 0.25, 'min'],
  ['omega3_dha_g', 0.25, 'min'],
  ['omega3_ala_g', 1.6, 'min'],

  /**
   * Totals, summed from the fatty acids above (see `derivedFrom` in the
   * registry). There is no FDA Daily Value for either; these are the IOM
   * Adequate Intakes for adult men — 1.6 g ALA, 17 g linoleic acid — which is
   * where the bulk of each total comes from. Omega-6 is "about" rather than
   * "at least": more is not obviously better.
   */
  ['omega3_total_g', 1.6, 'min'],
  ['omega6_total_g', 17, 'target'],
];

/** The FDA template, fresh. */
export function defaultTargets(): NutrientTarget[] {
  return DEFAULTS.map(([key, amount, direction]) => ({
    key,
    amount,
    direction,
    isDefault: true,
  }));
}

/** The default for one nutrient, for "reset just this one". */
export function defaultTargetFor(key: string): NutrientTarget | undefined {
  const seed = DEFAULTS.find(([seedKey]) => seedKey === key);
  if (seed === undefined) return undefined;
  return { key: seed[0], amount: seed[1], direction: seed[2], isDefault: true };
}

/** Sensible direction for a nutrient with no FDA default, when adding one. */
export function defaultDirectionFor(key: string): GoalDirection {
  return defaultTargetFor(key)?.direction ?? 'min';
}

/** Order the plan screen shows things in — headline numbers first. */
export const PLAN_PRIORITY_KEYS: readonly string[] = [
  'energy_kcal',
  'protein_g',
  'carbs_g',
  'fat_g',
  'fiber_g',
  'water_g',
];

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

export function targetsByKey(targets: readonly NutrientTarget[]): Map<string, NutrientTarget> {
  return new Map(targets.map((target) => [target.key, target]));
}
