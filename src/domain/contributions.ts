/**
 * Who contributed what to a total.
 *
 * A day's protein bar used to be one green fill. The user asked for it to be
 * split by source — "part the steak colour and part the egg colour,
 * proportional to their contribution" — so a meter answers "where did this
 * come from?" as well as "how much?".
 *
 * Pure: works on the item snapshots every MealLog already carries
 * (PLAN.md §3d), so this needs no lookups and rewrites nothing.
 */

import type { NutrientMap } from '@/domain/types';

/** Anything with a name, maybe a colour, and its own nutrition snapshot. */
export interface Contributor {
  label: string;
  color?: string | undefined;
  nutrients: NutrientMap;
}

export interface Segment {
  label: string;
  /** Absent on items logged before colours existed — drawn neutral, on purpose. */
  color: string | undefined;
  amount: number;
}

/**
 * One segment per distinct food, in the order first eaten.
 *
 * Eggs at breakfast and eggs at dinner are ONE segment: the question is
 * "how much came from eggs", and two adjacent slivers of the same colour would
 * read as two different things. Items with no data for the nutrient are left
 * out rather than drawn as zero-width — missing is not zero.
 *
 * `derived` names totals computed from parts (omega-3 from ALA, EPA…), which
 * no item stores directly — see `withDerivedSums`.
 */
export function contributionsFor(
  items: readonly Contributor[],
  key: string,
  derived: Readonly<Record<string, readonly string[]>> = {},
): Segment[] {
  const parts = derived[key];
  const byFood = new Map<string, Segment>();

  for (const item of items) {
    const amount = amountOf(item.nutrients, key, parts);
    if (amount === undefined || !(amount > 0)) continue;

    const id = `${item.label}\u0000${item.color ?? ''}`;
    const existing = byFood.get(id);
    if (existing === undefined) {
      byFood.set(id, { label: item.label, color: item.color, amount });
    } else {
      existing.amount += amount;
    }
  }

  return [...byFood.values()];
}

function amountOf(
  nutrients: NutrientMap,
  key: string,
  parts: readonly string[] | undefined,
): number | undefined {
  if (parts === undefined) return nutrients[key];
  const present = parts.filter((part) => part in nutrients);
  if (present.length === 0) return undefined;
  return present.reduce((sum, part) => sum + (nutrients[part] ?? 0), 0);
}

export interface PlacedSegment {
  segment: Segment;
  /** 0..1 along the track. */
  start: number;
  /** 0..1, never running past the end of the track. */
  length: number;
}

/**
 * Lay segments end to end along a track that is `full` long — the goal.
 *
 * Past the goal they are clipped at the end, exactly as a single fill would
 * be; the meter's overshoot marker says how far over. Segments that fall
 * entirely past the end are dropped.
 */
export function placeSegments(segments: readonly Segment[], full: number): PlacedSegment[] {
  if (!(full > 0)) return [];
  const placed: PlacedSegment[] = [];
  let start = 0;
  for (const segment of segments) {
    if (start >= 1) break;
    const length = Math.min(segment.amount / full, 1 - start);
    if (length > 0) placed.push({ segment, start, length });
    start += segment.amount / full;
  }
  return placed;
}
