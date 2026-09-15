/**
 * Meal logging, and the stock movement that comes with it.
 *
 * This is the file PLAN.md §3e is about. Logging a meal deducts fridge stock,
 * and deleting that log puts it back — both inside a single transaction
 * spanning `mealLogs` and `fridgeEntries`, so the two can never disagree.
 *
 * Every item snapshots its own nutrition (PLAN.md §3d). Editing a Component
 * next month must not rewrite what you ate today, and Day Detail should be a
 * pure read rather than a walk back through ingredients.
 */

import { db } from '@/db/schema';
import { aggregate } from '@/domain/nutrients';
import { canConsume, remainingAfterRestore } from '@/domain/portions';
import type { DayKey } from '@/domain/dates';
import type {
  Coverage,
  MealLog,
  MealLogItem,
  MealSlot,
  NutrientAggregate,
  NutrientMap,
} from '@/domain/types';

export interface LogItemDraft {
  kind: 'fridge' | 'quick';
  fridgeEntryId?: number;
  label: string;
  quantity: number;
  unit: string;
  grams: number;
  nutrients: NutrientMap;
  coverage?: Coverage;
}

export class InsufficientStockError extends Error {
  constructor(label: string, wanted: number, available: number, unit: string) {
    super(`Only ${round(available)} ${unit} of ${label} left — you tried to log ${round(wanted)}.`);
    this.name = 'InsufficientStockError';
  }
}

/** Total a set of items, carrying each one's coverage upward. */
export function aggregateItems(items: readonly LogItemDraft[]): NutrientAggregate {
  return aggregate(
    items.map((item) => ({
      nutrients: item.nutrients,
      grams: item.grams,
      ...(item.coverage === undefined ? {} : { coverage: item.coverage }),
    })),
  );
}

/**
 * Write a meal and deduct whatever it took from the fridge.
 *
 * Stock is checked inside the transaction, not before it — checking first and
 * writing after would let two quick taps both pass the check and overdraw.
 */
export async function logMeal(
  date: DayKey,
  items: readonly LogItemDraft[],
  slot?: MealSlot,
): Promise<number> {
  if (items.length === 0) throw new Error('Nothing to log.');

  return db.transaction('rw', [db.mealLogs, db.fridgeEntries], async () => {
    for (const item of items) {
      if (item.kind !== 'fridge' || item.fridgeEntryId === undefined) continue;

      const entry = await db.fridgeEntries.get(item.fridgeEntryId);
      if (entry === undefined) {
        throw new Error(`${item.label} is no longer in the fridge.`);
      }
      if (!canConsume(entry.remaining, item.quantity)) {
        throw new InsufficientStockError(item.label, item.quantity, entry.remaining, entry.unit);
      }

      await db.fridgeEntries.update(item.fridgeEntryId, {
        // Never below zero, even with float drift.
        remaining: Math.max(0, entry.remaining - item.quantity),
      });
    }

    const totals = aggregateItems(items);

    return db.mealLogs.add({
      date,
      loggedAt: Date.now(),
      items: items.map(toStoredItem),
      nutrients: totals.nutrients,
      coverage: totals.coverage,
      totalGrams: totals.totalGrams,
      ...(slot === undefined ? {} : { slot }),
    } as MealLog);
  });
}

/**
 * Delete a log and give the stock back.
 *
 * Restoring is capped at the entry's original yield: if the log and the entry
 * disagree, the entry is the authority on how much ever existed.
 */
export async function deleteMealLog(id: number): Promise<void> {
  await db.transaction('rw', [db.mealLogs, db.fridgeEntries], async () => {
    const log = await db.mealLogs.get(id);
    if (log === undefined) return;

    for (const item of log.items) {
      if (item.kind !== 'fridge' || item.fridgeEntryId === undefined) continue;

      const entry = await db.fridgeEntries.get(item.fridgeEntryId);
      // The entry may have been deleted; the log still goes.
      if (entry === undefined) continue;

      await db.fridgeEntries.update(item.fridgeEntryId, {
        remaining: remainingAfterRestore(entry.remaining, item.quantity, entry.initialQuantity),
      });
    }

    await db.mealLogs.delete(id);
  });
}

/**
 * Change what a logged meal contained.
 *
 * Implemented as restore-then-deduct so the stock arithmetic has exactly one
 * definition. Doing it as a delta would mean a second, subtly different
 * version of the same rules.
 */
export async function updateMealLog(
  id: number,
  items: readonly LogItemDraft[],
  slot?: MealSlot,
): Promise<void> {
  if (items.length === 0) throw new Error('A meal needs at least one item.');

  await db.transaction('rw', [db.mealLogs, db.fridgeEntries], async () => {
    const existing = await db.mealLogs.get(id);
    if (existing === undefined) throw new Error('That meal log no longer exists.');

    // Put back everything the old version took.
    for (const item of existing.items) {
      if (item.kind !== 'fridge' || item.fridgeEntryId === undefined) continue;
      const entry = await db.fridgeEntries.get(item.fridgeEntryId);
      if (entry === undefined) continue;
      await db.fridgeEntries.update(item.fridgeEntryId, {
        remaining: remainingAfterRestore(entry.remaining, item.quantity, entry.initialQuantity),
      });
    }

    // Then take what the new version needs.
    for (const item of items) {
      if (item.kind !== 'fridge' || item.fridgeEntryId === undefined) continue;
      const entry = await db.fridgeEntries.get(item.fridgeEntryId);
      if (entry === undefined) throw new Error(`${item.label} is no longer in the fridge.`);
      if (!canConsume(entry.remaining, item.quantity)) {
        throw new InsufficientStockError(item.label, item.quantity, entry.remaining, entry.unit);
      }
      await db.fridgeEntries.update(item.fridgeEntryId, {
        remaining: Math.max(0, entry.remaining - item.quantity),
      });
    }

    const totals = aggregateItems(items);

    await db.mealLogs.update(id, {
      items: items.map(toStoredItem),
      nutrients: totals.nutrients,
      coverage: totals.coverage,
      totalGrams: totals.totalGrams,
      ...(slot === undefined ? {} : { slot }),
    });
  });
}

export async function listLogsForDay(date: DayKey): Promise<MealLog[]> {
  const rows = await db.mealLogs.where('date').equals(date).toArray();
  return rows.sort((a, b) => a.loggedAt - b.loggedAt);
}

export async function listLogsInRange(from: DayKey, to: DayKey): Promise<MealLog[]> {
  const rows = await db.mealLogs.where('date').between(from, to, true, true).toArray();
  return rows.sort((a, b) => a.loggedAt - b.loggedAt);
}

/** Everything eaten on one day, with coverage carried up from each meal. */
export async function dayTotals(date: DayKey): Promise<NutrientAggregate> {
  const logs = await listLogsForDay(date);
  return aggregate(
    logs.map((log) => ({
      nutrients: log.nutrients,
      grams: log.totalGrams,
      coverage: log.coverage,
    })),
  );
}

function toStoredItem(item: LogItemDraft): MealLogItem {
  return {
    kind: item.kind,
    label: item.label,
    quantity: item.quantity,
    unit: item.unit,
    grams: item.grams,
    nutrients: item.nutrients,
    coverage: item.coverage ?? {},
    ...(item.fridgeEntryId === undefined ? {} : { fridgeEntryId: item.fridgeEntryId }),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
