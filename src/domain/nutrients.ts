/**
 * Pure nutrient arithmetic. No Dexie, no React, no I/O.
 *
 * The one rule everything here obeys: a nutrient key that is ABSENT from a
 * NutrientMap means "no data", never "zero". Summing sparse maps as though
 * missing meant zero silently under-reports every micronutrient, so every
 * aggregate reports `Coverage` alongside the total. See PLAN.md §3c.
 */

import type {
  Coverage,
  NutrientAggregate,
  NutrientContribution,
  NutrientMap,
} from '@/domain/types';

/** Multiply every present nutrient by `factor`. Absent keys stay absent. */
export function scaleNutrients(map: NutrientMap, factor: number): NutrientMap {
  const out: NutrientMap = {};
  for (const [key, value] of Object.entries(map)) {
    out[key] = value * factor;
  }
  return out;
}

/**
 * Per-unit nutrition. The single arithmetic path for BOTH portion styles —
 * `portionStyle` picks the UI control, never this calculation (PLAN.md §3a).
 *
 * @throws if baseQuantity is not positive; a Component with a zero yield is
 *   invalid data and should never have been saved.
 */
export function perUnitNutrition(nutritionPerBase: NutrientMap, baseQuantity: number): NutrientMap {
  if (!(baseQuantity > 0)) {
    throw new Error(`perUnitNutrition: baseQuantity must be > 0, got ${baseQuantity}`);
  }
  return scaleNutrients(nutritionPerBase, 1 / baseQuantity);
}

/**
 * Merge two maps by summing shared keys. Keys present in only one survive.
 *
 * This is a raw merge with NO coverage tracking — use it only when both sides
 * describe the same food (e.g. combining two source records). To total
 * different foods, use `aggregate`, which tracks what was actually measured.
 */
export function addNutrients(a: NutrientMap, b: NutrientMap): NutrientMap {
  const out: NutrientMap = { ...a };
  for (const [key, value] of Object.entries(b)) {
    const prior = out[key];
    out[key] = prior === undefined ? value : prior + value;
  }
  return out;
}

/** Keep only the given keys. Used to render the pinned subset. */
export function pickNutrients(map: NutrientMap, keys: readonly string[]): NutrientMap {
  const out: NutrientMap = {};
  for (const key of keys) {
    const value = map[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function emptyAggregate(): NutrientAggregate {
  return { nutrients: {}, coverage: {}, totalGrams: 0 };
}

/**
 * Total a set of weighted contributions, tracking per-nutrient coverage.
 *
 * For each nutrient key, coverage is
 *   (grams of contributions that carried that nutrient) / (total grams).
 *
 * A contribution may carry its own prior `coverage` when it is itself an
 * aggregate — a Component built from ingredients, or a day built from meals —
 * so partial knowledge propagates upward instead of being laundered into
 * false certainty.
 *
 * Degenerate case: if nothing has weight, coverage cannot be grams-weighted,
 * so every present key reports coverage 1. Values still sum.
 */
export function aggregate(contributions: readonly NutrientContribution[]): NutrientAggregate {
  const nutrients: NutrientMap = {};
  const coveredGrams: Record<string, number> = {};
  let totalGrams = 0;

  for (const contribution of contributions) {
    // Guard against NaN weights from an unresolved unit conversion.
    const grams = Number.isFinite(contribution.grams) ? contribution.grams : 0;
    totalGrams += grams;

    for (const [key, value] of Object.entries(contribution.nutrients)) {
      const priorValue = nutrients[key];
      nutrients[key] = priorValue === undefined ? value : priorValue + value;

      // `?? 1` — a contribution without prior coverage is fully covered for
      // every key it actually reports.
      const priorCoverage = contribution.coverage?.[key] ?? 1;
      const prior = coveredGrams[key] ?? 0;
      coveredGrams[key] = prior + grams * priorCoverage;
    }
  }

  const coverage: Coverage = {};
  for (const key of Object.keys(nutrients)) {
    if (totalGrams > 0) {
      const covered = coveredGrams[key] ?? 0;
      coverage[key] = clamp01(covered / totalGrams);
    } else {
      coverage[key] = 1;
    }
  }

  return { nutrients, coverage, totalGrams };
}

/**
 * Combine aggregates that are already computed — a week from its days, a day
 * from its meals.
 *
 * Defined in terms of `aggregate` so combining is associative: totalling seven
 * days at once and totalling them a day at a time give the same answer.
 */
export function combineAggregates(aggregates: readonly NutrientAggregate[]): NutrientAggregate {
  return aggregate(
    aggregates.map((a) => ({
      nutrients: a.nutrients,
      grams: a.totalGrams,
      coverage: a.coverage,
    })),
  );
}

/** Build a contribution from a per-unit map and a quantity of those units. */
export function contributionFromUnits(
  nutritionPerUnit: NutrientMap,
  quantity: number,
  gramsPerUnit: number,
  coverage?: Coverage,
): NutrientContribution {
  const base: NutrientContribution = {
    nutrients: scaleNutrients(nutritionPerUnit, quantity),
    grams: gramsPerUnit * quantity,
  };
  // `exactOptionalPropertyTypes` is on, so only attach the key when defined.
  return coverage === undefined ? base : { ...base, coverage };
}

/** Scale a per-100g map to an arbitrary gram weight. */
export function nutritionForGrams(per100g: NutrientMap, grams: number): NutrientMap {
  return scaleNutrients(per100g, grams / 100);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
