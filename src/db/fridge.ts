/**
 * Cooking a batch, and the stock it becomes.
 *
 * Every function that moves `FridgeEntry.remaining` runs inside a Dexie
 * transaction spanning every table it touches (PLAN.md §3e). Stock that moved
 * without being eaten writes a `stockAdjustments` row, so the fridge always
 * reconciles and waste never reaches nutrition totals.
 */

import { db } from '@/db/schema';
import { batchNutrition } from '@/db/batches';
import { perUnitForActualYield } from '@/domain/portions';
import type {
  AdjustmentReason,
  Coverage,
  FridgeEntry,
  NutrientMap,
  StockAdjustment,
} from '@/domain/types';

/**
 * Turn a planned batch into fridge stock.
 *
 * `actualYield` is what really came out of the pan, which routinely differs
 * from what was planned — so per-unit nutrition is computed against it rather
 * than against the plan. The same total nutrition, spread over a different
 * number of servings.
 *
 * Coverage carries over unchanged: knowing half the B12 of a batch means
 * knowing half the B12 of every serving of it.
 */
export async function markCooked(batchId: number, actualYield: number): Promise<number> {
  if (!(actualYield > 0)) {
    throw new Error(`Actual yield must be greater than zero, got ${actualYield}.`);
  }

  return db.transaction('rw', [db.batches, db.fridgeEntries], async () => {
    const batch = await db.batches.get(batchId);
    if (batch === undefined) throw new Error('That batch no longer exists.');
    if (batch.status === 'cooked') {
      throw new Error('That batch is already cooked and in the fridge.');
    }

    const totalNutrition = batchNutrition(batch);
    const totalGrams = batch.totalGrams * batch.scale;
    const cookedAt = Date.now();

    const entryId = await db.fridgeEntries.add({
      batchId,
      componentId: batch.componentId,
      componentName: batch.componentName,
      componentColor: batch.componentColor,
      portionStyle: batch.portionStyle,
      // Bulk stock is weighed; discrete stock is counted.
      unit: batch.portionStyle === 'bulk' ? 'g' : batch.baseUnit,
      initialQuantity: actualYield,
      remaining: actualYield,
      nutritionPerUnit: perUnitForActualYield(totalNutrition, actualYield),
      coverage: batch.coveragePerBase,
      gramsPerUnit: totalGrams / actualYield,
      cookedAt,
      createdAt: cookedAt,
    } as FridgeEntry);

    await db.batches.update(batchId, { status: 'cooked', cookedAt });

    return entryId;
  });
}

export interface DirectFridgeItem {
  label: string;
  color: string;
  portionStyle: FridgeEntry['portionStyle'];
  /** Servings for discrete, grams for bulk. */
  quantity: number;
  unit: string;
  /** Nutrition for ONE unit of it. */
  nutritionPerUnit: NutrientMap;
  /** Weight of one unit, for coverage weighting. */
  gramsPerUnit: number;
  coverage?: Coverage;
}

/**
 * Put something in the fridge that was never cooked — a gallon of milk, six
 * avocados, a tub of yoghurt.
 *
 * No `batchId` and no `componentId`: there is no recipe and no cook behind it,
 * and inventing one would put a fake entry on the calendar. Everything
 * downstream (logging, percentages, discarding) works identically, because it
 * all reads the entry rather than the batch.
 */
export async function addFridgeItem(item: DirectFridgeItem): Promise<number> {
  if (!(item.quantity > 0)) {
    throw new Error(`Quantity must be greater than zero, got ${item.quantity}.`);
  }
  if (item.label.trim() === '') throw new Error('Give it a name.');

  const now = Date.now();
  return db.fridgeEntries.add({
    componentName: item.label.trim(),
    componentColor: item.color,
    portionStyle: item.portionStyle,
    unit: item.unit,
    initialQuantity: item.quantity,
    remaining: item.quantity,
    nutritionPerUnit: item.nutritionPerUnit,
    coverage: item.coverage ?? {},
    gramsPerUnit: item.gramsPerUnit,
    // Bought rather than cooked, but the field is what every view sorts by.
    cookedAt: now,
    createdAt: now,
  } as FridgeEntry);
}

/** What the planned yield was, as the default in the Mark cooked sheet. */
export function plannedYield(baseQuantity: number, scale: number): number {
  return baseQuantity * scale;
}

/** Stock with something left, newest first. */
export async function listFridge(): Promise<FridgeEntry[]> {
  const rows = await db.fridgeEntries.where('remaining').above(0).toArray();
  return rows.sort((a, b) => b.cookedAt - a.cookedAt);
}

/** Everything ever cooked, including emptied entries. */
export async function listFridgeHistory(): Promise<FridgeEntry[]> {
  const rows = await db.fridgeEntries.toArray();
  return rows.sort((a, b) => b.cookedAt - a.cookedAt);
}

export async function getFridgeEntry(id: number): Promise<FridgeEntry | undefined> {
  return db.fridgeEntries.get(id);
}

/**
 * Correct how much is left.
 *
 * If the correction is upward past the original yield, `initialQuantity` moves
 * with it — otherwise the bulk progress bar would read over 100%, and the
 * denominator is supposed to mean "how much this entry ever held".
 */
export async function adjustStock(
  entryId: number,
  newRemaining: number,
  reason: AdjustmentReason = 'correction',
  note?: string,
): Promise<void> {
  if (!Number.isFinite(newRemaining) || newRemaining < 0) {
    throw new Error(`Remaining must be zero or more, got ${newRemaining}.`);
  }

  await db.transaction('rw', [db.fridgeEntries, db.stockAdjustments], async () => {
    const entry = await db.fridgeEntries.get(entryId);
    if (entry === undefined) throw new Error('That fridge entry no longer exists.');

    const delta = newRemaining - entry.remaining;
    if (delta === 0) return;

    await db.fridgeEntries.update(entryId, {
      remaining: newRemaining,
      ...(newRemaining > entry.initialQuantity ? { initialQuantity: newRemaining } : {}),
    });

    await db.stockAdjustments.add({
      fridgeEntryId: entryId,
      delta,
      reason,
      createdAt: Date.now(),
      ...(note === undefined || note.trim() === '' ? {} : { note: note.trim() }),
    } as StockAdjustment);
  });
}

/**
 * Throw the rest away.
 *
 * Writes an audit row and never touches nutrition totals — discarded food was
 * not eaten (PLAN.md §1.7).
 */
export async function discardRemaining(
  entryId: number,
  reason: Extract<AdjustmentReason, 'discard' | 'spoiled'> = 'discard',
  note?: string,
): Promise<void> {
  await adjustStock(entryId, 0, reason, note);
}

/** The audit trail for one entry, newest first. */
export async function listAdjustments(entryId: number): Promise<StockAdjustment[]> {
  const rows = await db.stockAdjustments.where('fridgeEntryId').equals(entryId).toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Remove an entry entirely — only when nothing has been logged against it.
 * Use `discardRemaining` for food that existed and was thrown out; deleting is
 * for an entry created by mistake.
 */
export async function deleteFridgeEntry(entryId: number): Promise<void> {
  await db.transaction(
    'rw',
    [db.fridgeEntries, db.stockAdjustments, db.mealLogs, db.batches],
    async () => {
      const logs = await db.mealLogs.toArray();
      const used = logs.some((log) => log.items.some((item) => item.fridgeEntryId === entryId));
      if (used) {
        throw new Error(
          'You have already logged meals from this entry. Discard the remainder instead.',
        );
      }

      const entry = await db.fridgeEntries.get(entryId);
      await db.stockAdjustments.where('fridgeEntryId').equals(entryId).delete();
      await db.fridgeEntries.delete(entryId);

      // Hand the batch back to the calendar so it can be cooked again.
      // A directly-added item has no batch, and never did.
      if (entry?.batchId !== undefined) {
        await db.batches.update(entry.batchId, { status: 'planned' });
      }
    },
  );
}
