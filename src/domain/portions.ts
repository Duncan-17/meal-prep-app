/**
 * Portion and stock arithmetic.
 *
 * `portionStyle` never appears in this file. Discrete and bulk share one
 * arithmetic path (PLAN.md §3a) — the style only decides whether the UI shows
 * a stepper or a percent picker, and these functions serve both.
 */

import type { FridgeEntry, NutrientMap } from '@/domain/types';
import { scaleNutrients } from '@/domain/nutrients';

/**
 * How much a percentage means right now.
 *
 * The basis is **what is currently left**, not the original batch — locked
 * decision PLAN.md §1.2b. Eating "50%" twice leaves a quarter, not nothing.
 */
export function quantityFromPercentOfRemaining(remaining: number, percent: number): number {
  return Math.max(0, remaining) * (clampPercent(percent) / 100);
}

/** The inverse: what percentage of what is left does this quantity represent? */
export function percentOfRemaining(remaining: number, quantity: number): number {
  if (!(remaining > 0)) return 0;
  return clampPercent((quantity / remaining) * 100);
}

/**
 * Stock after consuming `quantity`. Never negative — you cannot eat more than
 * is there, and a negative remainder would corrupt every later percentage.
 */
export function remainingAfter(remaining: number, quantity: number): number {
  return Math.max(0, remaining - quantity);
}

/** Stock after a log is deleted and its portion returned. */
export function remainingAfterRestore(
  remaining: number,
  quantity: number,
  initialQuantity: number,
): number {
  // Cap at the original yield: restoring more than was ever cooked would mean
  // the log and the entry disagree, and the entry is the authority.
  return Math.min(initialQuantity, remaining + quantity);
}

/** 0..1 for the bulk progress bar. */
export function fractionRemaining(
  entry: Pick<FridgeEntry, 'remaining' | 'initialQuantity'>,
): number {
  if (!(entry.initialQuantity > 0)) return 0;
  const fraction = entry.remaining / entry.initialQuantity;
  return fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
}

/** Can this entry satisfy the requested amount? */
export function canConsume(remaining: number, quantity: number): boolean {
  return quantity > 0 && quantity <= remaining + EPSILON;
}

/** Nutrition for a quantity of units. */
export function nutritionForQuantity(nutritionPerUnit: NutrientMap, quantity: number): NutrientMap {
  return scaleNutrients(nutritionPerUnit, quantity);
}

/** Grams for a quantity of units — the weight that feeds coverage. */
export function gramsForQuantity(gramsPerUnit: number, quantity: number): number {
  return gramsPerUnit * quantity;
}

/**
 * Actual yield may differ from planned, so per-unit nutrition is recomputed
 * against what really came out of the pan rather than what was scheduled.
 * Same total nutrition, spread over a different number of servings.
 */
export function perUnitForActualYield(
  nutritionForWholeBatch: NutrientMap,
  actualYield: number,
): NutrientMap {
  if (!(actualYield > 0)) {
    throw new Error(`perUnitForActualYield: actualYield must be > 0, got ${actualYield}`);
  }
  return scaleNutrients(nutritionForWholeBatch, 1 / actualYield);
}

/** Float slack so 3 × 0.1 can still be consumed from a stock of 0.3. */
const EPSILON = 1e-9;

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  if (percent < 0) return 0;
  if (percent > 100) return 100;
  return percent;
}
