/**
 * Reading and writing the plan.
 *
 * The plan is the FDA template until the user touches it. Editing a target
 * clears `isDefault`, which is what lets the UI distinguish "a sensible
 * starting number" from "the number you chose" — and what makes "reset to
 * defaults" mean something.
 */

import { db } from '@/db/schema';
import { defaultTargetFor, defaultTargets } from '@/nutrition/targets';
import type { DayKey } from '@/domain/dates';
import type {
  GoalDirection,
  NutrientTarget,
  Plan,
  WeightEntry,
  WeightGoal,
  WeightUnit,
} from '@/domain/plan';

const DEFAULT_PLAN: Omit<Plan, 'updatedAt'> = {
  id: 'plan',
  name: 'My plan',
  weightUnit: 'kg',
  weight: { weeklyChangeKg: 0 },
};

export async function getPlan(): Promise<Plan> {
  const stored = await db.plan.get('plan');
  return stored ?? { ...DEFAULT_PLAN, updatedAt: 0 };
}

export async function savePlan(patch: Partial<Omit<Plan, 'id'>>): Promise<void> {
  const current = await getPlan();
  await db.plan.put({ ...current, ...patch, id: 'plan', updatedAt: Date.now() });
}

export async function setWeightGoal(goal: Partial<WeightGoal>): Promise<void> {
  const current = await getPlan();
  await savePlan({ weight: { ...current.weight, ...goal } });
}

export async function setWeightUnit(weightUnit: WeightUnit): Promise<void> {
  await savePlan({ weightUnit });
}

// ── Targets ─────────────────────────────────────────────────────────────────

export async function listTargets(): Promise<NutrientTarget[]> {
  return db.targets.toArray();
}

export async function getTarget(key: string): Promise<NutrientTarget | undefined> {
  return db.targets.get(key);
}

/**
 * Set a target's daily amount.
 *
 * Marks it as no longer a default — the whole point of the flag is to know
 * which numbers are the user's own.
 */
export async function setTargetAmount(key: string, amount: number): Promise<void> {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Target must be zero or more, got ${amount}.`);
  }
  const existing = await db.targets.get(key);
  await db.targets.put({
    key,
    amount,
    direction: existing?.direction ?? defaultTargetFor(key)?.direction ?? 'min',
    isDefault: false,
    ...(existing?.weeklyAmount === undefined ? {} : { weeklyAmount: existing.weeklyAmount }),
    ...(existing?.enabled === undefined ? {} : { enabled: existing.enabled }),
  });
}

/**
 * Set a weekly figure independently of the daily one.
 *
 * Passing undefined drops back to daily × 7, which is what most targets want.
 */
export async function setTargetWeekly(key: string, weeklyAmount?: number): Promise<void> {
  const existing = await db.targets.get(key);
  if (existing === undefined) return;

  if (weeklyAmount !== undefined && (!Number.isFinite(weeklyAmount) || weeklyAmount < 0)) {
    throw new Error(`Weekly target must be zero or more, got ${weeklyAmount}.`);
  }

  const next: NutrientTarget = {
    ...existing,
    isDefault: false,
    ...(weeklyAmount === undefined ? {} : { weeklyAmount }),
  };
  if (weeklyAmount === undefined) delete next.weeklyAmount;

  await db.targets.put(next);
}

export async function setTargetDirection(key: string, direction: GoalDirection): Promise<void> {
  const existing = await db.targets.get(key);
  if (existing === undefined) return;
  await db.targets.put({ ...existing, direction, isDefault: false });
}

/** Hide a nutrient from the plan without losing the number behind it. */
export async function setTargetEnabled(key: string, enabled: boolean): Promise<void> {
  const existing = await db.targets.get(key);
  if (existing === undefined) return;
  await db.targets.put({ ...existing, enabled });
}

/** Add a target for a nutrient the FDA template does not cover. */
export async function addTarget(
  key: string,
  amount: number,
  direction: GoalDirection = 'min',
): Promise<void> {
  await db.targets.put({ key, amount, direction, isDefault: false });
}

export async function removeTarget(key: string): Promise<void> {
  await db.targets.delete(key);
}

/** Put one nutrient back to its FDA default. */
export async function resetTarget(key: string): Promise<void> {
  const fallback = defaultTargetFor(key);
  if (fallback === undefined) {
    await db.targets.delete(key);
    return;
  }
  await db.targets.put(fallback);
}

/**
 * Reset the whole template.
 *
 * Replaces every target, including ones the user added — this is the "start
 * over" button, so it says so in the UI before running.
 */
export async function resetAllTargets(): Promise<void> {
  await db.transaction('rw', db.targets, async () => {
    await db.targets.clear();
    await db.targets.bulkPut(defaultTargets());
  });
}

/** How much of the plan the user has actually made their own. */
export async function planCustomisation(): Promise<{ total: number; edited: number }> {
  const targets = await listTargets();
  return {
    total: targets.length,
    edited: targets.filter((target) => !target.isDefault).length,
  };
}

// ── Weight ──────────────────────────────────────────────────────────────────

/** One entry per day — logging twice corrects rather than duplicating. */
export async function logWeight(date: DayKey, kg: number): Promise<void> {
  if (!Number.isFinite(kg) || kg <= 0) {
    throw new Error(`Weight must be greater than zero, got ${kg}.`);
  }
  await db.weightEntries.put({ date, kg, loggedAt: Date.now() });
}

export async function deleteWeight(date: DayKey): Promise<void> {
  await db.weightEntries.delete(date);
}

export async function getWeight(date: DayKey): Promise<WeightEntry | undefined> {
  return db.weightEntries.get(date);
}

/** Newest first. */
export async function listWeights(limit = 60): Promise<WeightEntry[]> {
  const rows = await db.weightEntries.toArray();
  return rows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}

export async function listWeightsInRange(from: DayKey, to: DayKey): Promise<WeightEntry[]> {
  const rows = await db.weightEntries.where('date').between(from, to, true, true).toArray();
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export async function latestWeight(): Promise<WeightEntry | undefined> {
  const rows = await listWeights(1);
  return rows[0];
}
