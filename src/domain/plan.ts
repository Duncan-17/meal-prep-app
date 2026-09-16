/**
 * The plan: what you are aiming at, daily and weekly.
 *
 * Two things here are easy to get wrong and expensive to retrofit.
 *
 * **Direction.** Not every target is a floor. Protein and fibre are minimums;
 * sodium, saturated fat and added sugars are LIMITS. Rendering "100% of your
 * sodium!" as an achievement would be actively misleading, so every target
 * carries a direction and the UI reads it.
 *
 * **Weekly is not just daily × 7 for everything.** It is a sensible default,
 * but a weekly figure can be set independently — eating 3500 kcal on Sunday
 * and less in the week is a real plan, and a daily-only model cannot say that.
 */

import type { DayKey } from '@/domain/dates';

/** Which way a target points. */
export type GoalDirection =
  | 'min' // at least this much — protein, fibre, vitamins
  | 'max' // no more than this — sodium, saturated fat, added sugars
  | 'target'; // aim for roughly this — calories, carbs, fat

export interface NutrientTarget {
  /** Canonical nutrient key from the registry. */
  key: string;
  /** Per day, in the nutrient's canonical unit. */
  amount: number;
  direction: GoalDirection;
  /** true = an FDA/IOM default, not a number the user chose. */
  isDefault: boolean;
  /** Explicit weekly figure. Absent means `amount × 7`. */
  weeklyAmount?: number;
  /** Hidden from the plan screen when false. Absent means shown. */
  enabled?: boolean;
}

export type WeightUnit = 'kg' | 'lb';

export interface WeightGoal {
  /** Where you are starting from. */
  startKg?: number;
  /** Where you want to be. */
  targetKg?: number;
  /** Per week. Negative loses, positive gains, 0 maintains. */
  weeklyChangeKg: number;
}

export interface Plan {
  id: 'plan';
  name: string;
  weightUnit: WeightUnit;
  weight: WeightGoal;
  updatedAt: number;
}

export interface WeightEntry {
  /** One per day — the date IS the key. */
  date: DayKey;
  kg: number;
  loggedAt: number;
}

// ── Weekly derivation ───────────────────────────────────────────────────────

/** A target's weekly figure: explicit if set, otherwise seven days of it. */
export function weeklyAmount(target: NutrientTarget): number {
  return target.weeklyAmount ?? target.amount * 7;
}

/** True when the weekly figure was set by hand rather than derived. */
export function hasCustomWeekly(target: NutrientTarget): boolean {
  return target.weeklyAmount !== undefined;
}

// ── Progress ────────────────────────────────────────────────────────────────

export type GoalStatus = 'under' | 'met' | 'over';

export interface Progress {
  /** amount / target. Can exceed 1. */
  fraction: number;
  status: GoalStatus;
}

/**
 * A 'target' goal counts as met inside this band either side. Calories are not
 * a pass/fail exam — 2480 against 2500 is hitting it.
 */
export const TARGET_TOLERANCE = 0.1;

export function progressFor(amount: number, target: NutrientTarget): Progress {
  if (!(target.amount > 0)) return { fraction: 0, status: 'met' };

  const fraction = amount / target.amount;

  if (target.direction === 'min') {
    return { fraction, status: fraction >= 1 ? 'met' : 'under' };
  }

  if (target.direction === 'max') {
    return { fraction, status: fraction > 1 ? 'over' : 'met' };
  }

  if (fraction < 1 - TARGET_TOLERANCE) return { fraction, status: 'under' };
  if (fraction > 1 + TARGET_TOLERANCE) return { fraction, status: 'over' };
  return { fraction, status: 'met' };
}

/** Progress against the weekly figure instead of the daily one. */
export function weeklyProgressFor(amount: number, target: NutrientTarget): Progress {
  const weekly = weeklyAmount(target);
  return progressFor(amount, { ...target, amount: weekly });
}

/** Plain-language summary for a target, used under each bar. */
export function describeGoal(target: NutrientTarget): string {
  const weekly = weeklyAmount(target);
  const suffix = hasCustomWeekly(target) ? ' (set separately)' : '';
  const verb =
    target.direction === 'min' ? 'at least' : target.direction === 'max' ? 'at most' : 'about';
  return `${verb} ${formatNumber(target.amount)} a day · ${formatNumber(weekly)} a week${suffix}`;
}

// ── Weight ──────────────────────────────────────────────────────────────────

const LB_PER_KG = 2.2046226218487757;

export function kgToLb(kg: number): number {
  return kg * LB_PER_KG;
}

export function lbToKg(lb: number): number {
  return lb / LB_PER_KG;
}

/** Convert a stored kilogram value into whatever unit the user reads in. */
export function toDisplayWeight(kg: number, unit: WeightUnit): number {
  return unit === 'lb' ? kgToLb(kg) : kg;
}

/** Convert a value the user typed back into the stored kilograms. */
export function fromDisplayWeight(value: number, unit: WeightUnit): number {
  return unit === 'lb' ? lbToKg(value) : value;
}

export interface WeightOutlook {
  /** Kilograms still to go. Negative means you are past the goal. */
  remainingKg: number;
  /** Whole weeks at the planned rate, or null when the rate cannot get there. */
  weeksRemaining: number | null;
  /** The day you would arrive, or null. */
  projectedDate: DayKey | null;
}

/**
 * How long the plan says this will take.
 *
 * Returns null weeks when the rate points the wrong way or is zero — a plan to
 * lose weight at 0 kg/week never arrives, and saying "∞ weeks" is less honest
 * than saying the plan does not reach the goal.
 */
export function weightOutlook(
  currentKg: number,
  goal: WeightGoal,
  today: DayKey,
  addDaysFn: (key: DayKey, days: number) => DayKey,
): WeightOutlook {
  const targetKg = goal.targetKg;
  if (targetKg === undefined) {
    return { remainingKg: 0, weeksRemaining: null, projectedDate: null };
  }

  const remainingKg = targetKg - currentKg;
  const rate = goal.weeklyChangeKg;

  // Rate must be non-zero AND pointing toward the goal.
  if (rate === 0 || Math.sign(rate) !== Math.sign(remainingKg)) {
    return { remainingKg, weeksRemaining: null, projectedDate: null };
  }

  const weeks = Math.ceil(Math.abs(remainingKg / rate));
  return {
    remainingKg,
    weeksRemaining: weeks,
    projectedDate: addDaysFn(today, weeks * 7),
  };
}

/**
 * Smoothed weight from recent entries.
 *
 * Day-to-day body weight swings by a kilo on water alone, so a single reading
 * is close to meaningless. The mean of the last `window` entries is what the
 * trend should be read from.
 */
export function smoothedWeight(entries: readonly WeightEntry[], window = 7): number | null {
  if (entries.length === 0) return null;
  const recent = [...entries]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, Math.max(1, window));
  const total = recent.reduce((sum, entry) => sum + entry.kg, 0);
  return total / recent.length;
}

/** Actual change per week between the oldest and newest entries given. */
export function observedWeeklyChange(
  entries: readonly WeightEntry[],
  dayDifferenceFn: (from: DayKey, to: DayKey) => number,
): number | null {
  if (entries.length < 2) return null;

  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;

  const days = dayDifferenceFn(first.date, last.date);
  if (days <= 0) return null;

  return ((last.kg - first.kg) / days) * 7;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(value < 10 ? 2 : 1).replace(/\.?0+$/, '');
}
