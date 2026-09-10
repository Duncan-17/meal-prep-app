/**
 * Reading coverage, as opposed to computing it (that lives in `nutrients.ts`).
 *
 * These are the functions the UI uses to decide whether a number deserves a
 * caveat. The rule from PLAN.md §3c: never present a partially-known total as
 * though it were complete.
 */

import type { Coverage, NutrientAggregate } from '@/domain/types';

/**
 * Below this, a total is missing enough data to be actively misleading and the
 * UI should caveat it rather than just render the number.
 */
export const LOW_COVERAGE_THRESHOLD = 0.8;

/** Coverage for one nutrient. 0 when the aggregate has no data for it at all. */
export function coverageFor(coverage: Coverage, key: string): number {
  return coverage[key] ?? 0;
}

/** True when every contributing gram carried data for this nutrient. */
export function isFullyCovered(coverage: Coverage, key: string): boolean {
  // Tolerate float drift from repeated aggregation.
  return coverageFor(coverage, key) >= 0.9999;
}

export function isLowCoverage(coverage: Coverage, key: string): boolean {
  return coverageFor(coverage, key) < LOW_COVERAGE_THRESHOLD;
}

/** Does the aggregate know anything at all about this nutrient? */
export function hasData(aggregate: NutrientAggregate, key: string): boolean {
  return key in aggregate.nutrients;
}

/**
 * Caveat text, or null when the number stands on its own.
 *
 * Deliberately phrased as a fact about the data ("68% of intake had data")
 * rather than a warning — the number is not wrong, it is partial.
 */
export function coverageNote(coverage: Coverage, key: string): string | null {
  const value = coverageFor(coverage, key);
  if (value >= 0.9999) return null;
  return `${Math.round(value * 100)}% of intake had data`;
}

/**
 * Keys the aggregate knows nothing about, in the order given.
 * Feeds the "show nutrients with no data" toggle in Day Detail.
 */
export function missingKeys(aggregate: NutrientAggregate, keys: readonly string[]): string[] {
  return keys.filter((key) => !(key in aggregate.nutrients));
}

/**
 * The worst coverage across a set of keys — used to decide whether a whole
 * panel needs a caveat. Returns 1 for an empty set (nothing to doubt).
 */
export function weakestCoverage(coverage: Coverage, keys: readonly string[]): number {
  let weakest = 1;
  for (const key of keys) {
    const value = coverageFor(coverage, key);
    if (value < weakest) weakest = value;
  }
  return weakest;
}
