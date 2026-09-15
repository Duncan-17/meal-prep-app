/**
 * The loop: cook → eat → stock drops → correct a mistake → stock returns.
 *
 * These are the tests PLAN.md §3e exists for. If logging and stock can ever
 * disagree, the fridge stops meaning anything.
 */

import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/schema';
import { scheduleBatch } from '@/db/batches';
import { markCooked } from '@/db/fridge';
import {
  InsufficientStockError,
  aggregateItems,
  dayTotals,
  deleteMealLog,
  listLogsForDay,
  listLogsInRange,
  logMeal,
  updateMealLog,
  type LogItemDraft,
} from '@/db/logs';
import { listFavorites, recordFavoriteUse, saveFavorite } from '@/db/favorites';
import type { Component, FridgeEntry } from '@/domain/types';

const component: Component = {
  id: 1,
  name: 'Chicken Thighs',
  color: '#c0392b',
  portionStyle: 'discrete',
  baseQuantity: 6,
  baseUnit: 'serving',
  ingredients: [],
  nutritionPerBase: { energy_kcal: 1200, protein_g: 240, vitamin_b12_ug: 4.2 },
  coveragePerBase: { energy_kcal: 1, protein_g: 1, vitamin_b12_ug: 0.7 },
  totalGrams: 1400,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

async function stockedFridge(yieldAmount = 6): Promise<FridgeEntry> {
  const batchId = await scheduleBatch(component, '2026-09-16');
  const entryId = await markCooked(batchId, yieldAmount);
  const entry = await db.fridgeEntries.get(entryId);
  return entry!;
}

function fridgeItem(entry: FridgeEntry, quantity: number): LogItemDraft {
  return {
    kind: 'fridge',
    fridgeEntryId: entry.id!,
    label: entry.componentName,
    quantity,
    unit: entry.unit,
    grams: entry.gramsPerUnit * quantity,
    nutrients: Object.fromEntries(
      Object.entries(entry.nutritionPerUnit).map(([key, value]) => [key, value * quantity]),
    ),
    coverage: entry.coverage,
  };
}

const apple: LogItemDraft = {
  kind: 'quick',
  label: 'Apple',
  quantity: 1,
  unit: 'each',
  grams: 180,
  nutrients: { energy_kcal: 95, carbs_g: 25 },
};

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('logging from the fridge', () => {
  it('writes the log and deducts the stock', async () => {
    const entry = await stockedFridge();
    await logMeal('2026-09-16', [fridgeItem(entry, 2)]);

    expect((await db.fridgeEntries.get(entry.id!))?.remaining).toBe(4);
    expect(await listLogsForDay('2026-09-16')).toHaveLength(1);
  });

  it('snapshots nutrition onto the log', async () => {
    const entry = await stockedFridge();
    await logMeal('2026-09-16', [fridgeItem(entry, 2)]);

    const [log] = await listLogsForDay('2026-09-16');
    // 1200 kcal / 6 servings × 2 = 400.
    expect(log?.nutrients.energy_kcal).toBe(400);
    expect(log?.items[0]?.fridgeEntryId).toBe(entry.id);
  });

  it('carries the entry coverage onto the log', async () => {
    const entry = await stockedFridge();
    await logMeal('2026-09-16', [fridgeItem(entry, 2)]);
    const [log] = await listLogsForDay('2026-09-16');
    expect(log?.coverage.vitamin_b12_ug).toBeCloseTo(0.7, 10);
  });

  it('refuses to log more than is left, and changes nothing', async () => {
    const entry = await stockedFridge();
    await expect(logMeal('2026-09-16', [fridgeItem(entry, 7)])).rejects.toThrow(
      InsufficientStockError,
    );

    expect((await db.fridgeEntries.get(entry.id!))?.remaining).toBe(6);
    expect(await db.mealLogs.count()).toBe(0);
  });

  it('allows logging exactly what is left', async () => {
    const entry = await stockedFridge();
    await logMeal('2026-09-16', [fridgeItem(entry, 6)]);
    expect((await db.fridgeEntries.get(entry.id!))?.remaining).toBe(0);
  });

  it('accumulates across several meals in a day', async () => {
    const entry = await stockedFridge();
    await logMeal('2026-09-16', [fridgeItem(entry, 1)]);
    await logMeal('2026-09-16', [fridgeItem(entry, 2)]);
    expect((await db.fridgeEntries.get(entry.id!))?.remaining).toBe(3);
  });

  it('rejects an empty meal', async () => {
    await expect(logMeal('2026-09-16', [])).rejects.toThrow(/Nothing to log/);
  });

  it('fails cleanly when the entry has gone', async () => {
    const entry = await stockedFridge();
    const item = fridgeItem(entry, 1);
    await db.fridgeEntries.delete(entry.id!);
    await expect(logMeal('2026-09-16', [item])).rejects.toThrow(/no longer in the fridge/);
  });
});

describe('quick-add items do not touch stock', () => {
  it('logs without any fridge involvement', async () => {
    await logMeal('2026-09-16', [apple]);
    const [log] = await listLogsForDay('2026-09-16');
    expect(log?.nutrients.energy_kcal).toBe(95);
    expect(await db.fridgeEntries.count()).toBe(0);
  });

  it('mixes fridge and quick items in one meal', async () => {
    const entry = await stockedFridge();
    await logMeal('2026-09-16', [fridgeItem(entry, 1), apple]);

    const [log] = await listLogsForDay('2026-09-16');
    expect(log?.items).toHaveLength(2);
    expect(log?.nutrients.energy_kcal).toBe(200 + 95);
    expect((await db.fridgeEntries.get(entry.id!))?.remaining).toBe(5);
  });
});

describe('deleting a log restores the stock', () => {
  it('puts back exactly what it took', async () => {
    const entry = await stockedFridge();
    await logMeal('2026-09-16', [fridgeItem(entry, 2)]);
    const [log] = await listLogsForDay('2026-09-16');

    await deleteMealLog(log!.id!);

    expect((await db.fridgeEntries.get(entry.id!))?.remaining).toBe(6);
    expect(await db.mealLogs.count()).toBe(0);
  });

  it('never restores past what was ever cooked', async () => {
    const entry = await stockedFridge();
    await logMeal('2026-09-16', [fridgeItem(entry, 2)]);
    const [log] = await listLogsForDay('2026-09-16');

    // Someone also corrected the stock upward in the meantime.
    await db.fridgeEntries.update(entry.id!, { remaining: 6 });
    await deleteMealLog(log!.id!);

    expect((await db.fridgeEntries.get(entry.id!))?.remaining).toBe(6);
  });

  it('still deletes the log when the fridge entry has gone', async () => {
    const entry = await stockedFridge();
    await logMeal('2026-09-16', [fridgeItem(entry, 2)]);
    const [log] = await listLogsForDay('2026-09-16');

    await db.fridgeEntries.delete(entry.id!);
    await deleteMealLog(log!.id!);

    expect(await db.mealLogs.count()).toBe(0);
  });

  it('leaves quick-add logs alone', async () => {
    await logMeal('2026-09-16', [apple]);
    const [log] = await listLogsForDay('2026-09-16');
    await deleteMealLog(log!.id!);
    expect(await db.mealLogs.count()).toBe(0);
  });

  it('is a no-op for an id that does not exist', async () => {
    await expect(deleteMealLog(9999)).resolves.toBeUndefined();
  });
});

describe('editing a log', () => {
  it('adjusts stock by the difference', async () => {
    const entry = await stockedFridge();
    await logMeal('2026-09-16', [fridgeItem(entry, 2)]);
    const [log] = await listLogsForDay('2026-09-16');

    // Actually ate three, not two.
    await updateMealLog(log!.id!, [fridgeItem(entry, 3)]);

    expect((await db.fridgeEntries.get(entry.id!))?.remaining).toBe(3);
    expect((await db.mealLogs.get(log!.id!))?.nutrients.energy_kcal).toBe(600);
  });

  it('gives stock back when the portion shrinks', async () => {
    const entry = await stockedFridge();
    await logMeal('2026-09-16', [fridgeItem(entry, 4)]);
    const [log] = await listLogsForDay('2026-09-16');

    await updateMealLog(log!.id!, [fridgeItem(entry, 1)]);
    expect((await db.fridgeEntries.get(entry.id!))?.remaining).toBe(5);
  });

  it('refuses an edit that would overdraw', async () => {
    const entry = await stockedFridge();
    await logMeal('2026-09-16', [fridgeItem(entry, 2)]);
    const [log] = await listLogsForDay('2026-09-16');

    await expect(updateMealLog(log!.id!, [fridgeItem(entry, 9)])).rejects.toThrow(
      InsufficientStockError,
    );
  });

  it('rejects emptying a meal entirely', async () => {
    const entry = await stockedFridge();
    await logMeal('2026-09-16', [fridgeItem(entry, 2)]);
    const [log] = await listLogsForDay('2026-09-16');
    await expect(updateMealLog(log!.id!, [])).rejects.toThrow(/at least one item/);
  });
});

describe('day totals', () => {
  it('aggregates every meal of the day with coverage', async () => {
    const entry = await stockedFridge();
    await logMeal('2026-09-16', [fridgeItem(entry, 1)]);
    await logMeal('2026-09-16', [apple]);

    const totals = await dayTotals('2026-09-16');
    expect(totals.nutrients.energy_kcal).toBe(200 + 95);
    // Only the chicken carried B12, so coverage is partial by weight.
    expect(totals.coverage.vitamin_b12_ug).toBeGreaterThan(0);
    expect(totals.coverage.vitamin_b12_ug).toBeLessThan(1);
  });

  it('is empty for a day with nothing logged', async () => {
    const totals = await dayTotals('2026-09-16');
    expect(totals.nutrients).toEqual({});
  });

  it('keeps days separate', async () => {
    const entry = await stockedFridge();
    await logMeal('2026-09-16', [fridgeItem(entry, 1)]);
    await logMeal('2026-09-17', [fridgeItem(entry, 1)]);

    expect((await dayTotals('2026-09-16')).nutrients.energy_kcal).toBe(200);
    expect(await listLogsInRange('2026-09-16', '2026-09-17')).toHaveLength(2);
  });
});

describe('aggregateItems', () => {
  it('reports a partial nutrient as partially covered', () => {
    const totals = aggregateItems([
      { ...apple, grams: 100 },
      {
        kind: 'quick',
        label: 'Beef',
        quantity: 1,
        unit: 'g',
        grams: 100,
        nutrients: { vitamin_b12_ug: 2.4 },
      },
    ]);
    expect(totals.coverage.vitamin_b12_ug).toBeCloseTo(0.5, 10);
  });
});

describe('favourites', () => {
  it('saves and lists', async () => {
    await saveFavorite({
      label: 'Greek yoghurt',
      quantity: 170,
      unit: 'g',
      grams: 170,
      nutrients: { energy_kcal: 100 },
    });
    const favorites = await listFavorites();
    expect(favorites).toHaveLength(1);
    expect(favorites[0]?.label).toBe('Greek yoghurt');
  });

  it('updates rather than duplicating the same name', async () => {
    await saveFavorite({ label: 'Yoghurt', quantity: 170, unit: 'g', grams: 170, nutrients: {} });
    await saveFavorite({ label: 'Yoghurt', quantity: 200, unit: 'g', grams: 200, nutrients: {} });
    const favorites = await listFavorites();
    expect(favorites).toHaveLength(1);
    expect(favorites[0]?.quantity).toBe(200);
  });

  it('rejects a blank name', async () => {
    await expect(
      saveFavorite({ label: '  ', quantity: 1, unit: 'g', grams: 1, nutrients: {} }),
    ).rejects.toThrow(/needs a name/);
  });

  it('sorts most-used first', async () => {
    const rare = await saveFavorite({
      label: 'Rare',
      quantity: 1,
      unit: 'g',
      grams: 1,
      nutrients: {},
    });
    const common = await saveFavorite({
      label: 'Common',
      quantity: 1,
      unit: 'g',
      grams: 1,
      nutrients: {},
    });

    await recordFavoriteUse(common);
    await recordFavoriteUse(common);
    await recordFavoriteUse(rare);

    expect((await listFavorites())[0]?.label).toBe('Common');
  });
});
