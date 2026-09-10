/**
 * Rolling a Component up from its ingredients.
 *
 * This is where coverage first enters the system: an ingredient that has no
 * value for a nutrient contributes its weight to the denominator but nothing
 * to the numerator, so the Component knows how well-measured it is before it
 * ever reaches a meal log.
 */

import { aggregate, nutritionForGrams } from '@/domain/nutrients';
import type { NutrientAggregate, NutrientMap } from '@/domain/types';

export interface ResolvedIngredient {
  /** Canonical per-100g nutrition for this ingredient. */
  nutritionPer100g: NutrientMap;
  /** Weight actually going into the pot, from `resolveToGrams`. */
  grams: number;
}

/** Total nutrition and coverage for a whole base batch. */
export function componentNutrition(ingredients: readonly ResolvedIngredient[]): NutrientAggregate {
  return aggregate(
    ingredients.map((ingredient) => ({
      nutrients: nutritionForGrams(ingredient.nutritionPer100g, ingredient.grams),
      grams: ingredient.grams,
    })),
  );
}

/**
 * Per-unit nutrition for a component, from its rolled-up total.
 *
 * Coverage is unchanged by dividing: knowing half the B12 of a batch means
 * knowing half the B12 of each serving.
 */
export function componentPerUnit(
  total: NutrientAggregate,
  baseQuantity: number,
): { nutrients: NutrientMap; coverage: NutrientAggregate['coverage']; gramsPerUnit: number } {
  if (!(baseQuantity > 0)) {
    throw new Error(`componentPerUnit: baseQuantity must be > 0, got ${baseQuantity}`);
  }

  const nutrients: NutrientMap = {};
  for (const [key, value] of Object.entries(total.nutrients)) {
    nutrients[key] = value / baseQuantity;
  }

  return {
    nutrients,
    coverage: total.coverage,
    gramsPerUnit: total.totalGrams / baseQuantity,
  };
}
