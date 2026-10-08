/**
 * Scratchpads — the pure arithmetic of placing food on days.
 *
 * The user's design (PLAN.md §10, 2026-10-08): queue up what you might buy
 * and cook, choose a period, and see either the AVERAGE day ("if I ate this
 * every day") or drag the food onto particular days and see EACH day. One
 * drag places one portion; −/+ adjusts; anything not placed waits in a tray
 * and counts toward no day.
 *
 * Every function returns a new value and never mutates — the screen writes
 * whatever comes back straight to the database, and drag-and-drop must never
 * be able to place more portions than exist.
 */

import { aggregate, emptyAggregate, scaleNutrients } from '@/domain/nutrients';
import type { NutrientAggregate, Placements, Scratchpad, ScratchpadItem } from '@/domain/types';

// ── Counting ────────────────────────────────────────────────────────────────

export function placedTotal(item: Pick<ScratchpadItem, 'placed'>): number {
  return Object.values(item.placed).reduce((sum, count) => sum + count, 0);
}

/** Portions still in the tray. */
export function unplaced(item: Pick<ScratchpadItem, 'placed' | 'portions'>): number {
  return Math.max(0, item.portions - placedTotal(item));
}

export function placedOn(item: Pick<ScratchpadItem, 'placed'>, day: number): number {
  return item.placed[String(day)] ?? 0;
}

// ── Moving portions ─────────────────────────────────────────────────────────

/**
 * Change how many portions sit on a day by `delta`, clamped: never below zero
 * on that day, never more in total than the item has. A request that cannot
 * be met returns the item unchanged — a drag onto a day when the tray is
 * empty simply does nothing.
 */
export function adjustDay<T extends ScratchpadItem>(item: T, day: number, delta: number): T {
  const current = placedOn(item, day);
  const room = delta > 0 ? Math.min(delta, unplaced(item)) : Math.max(delta, -current);
  if (room === 0) return item;
  return { ...item, placed: setCount(item.placed, day, current + room) };
}

/** One portion from the tray onto a day — what a drag from the tray does. */
export function placeOne<T extends ScratchpadItem>(item: T, day: number): T {
  return adjustDay(item, day, 1);
}

/** One portion from one day to another — what a drag between days does. */
export function moveOne<T extends ScratchpadItem>(item: T, from: number, to: number): T {
  if (from === to || placedOn(item, from) === 0) return item;
  const placed = setCount(item.placed, from, placedOn(item, from) - 1);
  return { ...item, placed: setCount(placed, to, (placed[String(to)] ?? 0) + 1) };
}

function setCount(placed: Placements, day: number, count: number): Placements {
  const next = { ...placed };
  if (count <= 0) delete next[String(day)];
  else next[String(day)] = count;
  return next;
}

// ── Reshaping ───────────────────────────────────────────────────────────────

/**
 * Split an item into a different number of portions.
 *
 * Fewer portions than are already placed takes the excess back off the LAST
 * days first — the end of the period is the part most likely still a guess.
 */
export function withPortions<T extends ScratchpadItem>(item: T, portions: number): T {
  const target = Math.max(1, Math.round(portions));
  let excess = placedTotal(item) - target;
  let placed = item.placed;
  const days = Object.keys(placed)
    .map(Number)
    .sort((a, b) => b - a);
  for (const day of days) {
    if (excess <= 0) break;
    const take = Math.min(excess, placed[String(day)] ?? 0);
    placed = setCount(placed, day, (placed[String(day)] ?? 0) - take);
    excess -= take;
  }
  return { ...item, portions: target, placed };
}

/**
 * Change the period. Portions on days that no longer exist go back to the
 * tray rather than vanishing — shortening a month to a week should not lose
 * the food, only the plan for days 8–30.
 */
export function withDays(pad: Scratchpad, days: number): Scratchpad {
  const target = Math.max(1, Math.round(days));
  return {
    ...pad,
    days: target,
    items: pad.items.map((item) => {
      const placed: Placements = {};
      for (const [day, count] of Object.entries(item.placed)) {
        if (Number(day) < target) placed[day] = count;
      }
      return { ...item, placed };
    }),
  };
}

// ── Nutrition ───────────────────────────────────────────────────────────────

/** An item with the nutrition of its WHOLE amount, worked out by the caller. */
export interface CostedItem {
  item: ScratchpadItem;
  total: NutrientAggregate;
}

/** One portion's worth. */
export function perPortion(costed: CostedItem): NutrientAggregate {
  return scaleAggregate(costed.total, 1 / Math.max(1, costed.item.portions));
}

export function scaleAggregate(total: NutrientAggregate, factor: number): NutrientAggregate {
  return {
    nutrients: scaleNutrients(total.nutrients, factor),
    coverage: { ...total.coverage },
    totalGrams: total.totalGrams * factor,
  };
}

/**
 * The average day: everything in the scratchpad, divided by the period.
 * Every portion counts here whether placed or not — this view answers "if I
 * ate all of this over N days, evenly".
 */
export function averageDay(costed: readonly CostedItem[], days: number): NutrientAggregate {
  if (costed.length === 0) return emptyAggregate();
  const whole = aggregate(
    costed.map(({ total }) => ({
      nutrients: total.nutrients,
      grams: total.totalGrams,
      coverage: total.coverage,
    })),
  );
  return scaleAggregate(whole, 1 / Math.max(1, days));
}

/** One day: only what was placed on it. */
export function dayTotal(costed: readonly CostedItem[], day: number): NutrientAggregate {
  const parts = costed
    .map((entry) => ({ entry, count: placedOn(entry.item, day) }))
    .filter(({ count }) => count > 0)
    .map(({ entry, count }) => scaleAggregate(perPortion(entry), count));
  if (parts.length === 0) return emptyAggregate();
  return aggregate(
    parts.map((part) => ({
      nutrients: part.nutrients,
      grams: part.totalGrams,
      coverage: part.coverage,
    })),
  );
}

/**
 * Each item's share of a view, for splitting the meters by source — the same
 * segmented bars the Diary draws. `day` undefined means the average view.
 */
export function contributors(
  costed: readonly CostedItem[],
  days: number,
  day?: number,
): Array<{ label: string; color: string; nutrients: Record<string, number> }> {
  return costed
    .map((entry) => {
      const share =
        day === undefined
          ? scaleAggregate(entry.total, 1 / Math.max(1, days))
          : scaleAggregate(perPortion(entry), placedOn(entry.item, day));
      return { label: entry.item.label, color: entry.item.color, nutrients: share.nutrients };
    })
    .filter((entry) => Object.keys(entry.nutrients).length > 0);
}
