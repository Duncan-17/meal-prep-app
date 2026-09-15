/** Cook → fridge → adjust/discard, against a real in-memory IndexedDB. */

import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/schema';
import { scheduleBatch } from '@/db/batches';
import {
  adjustStock,
  deleteFridgeEntry,
  discardRemaining,
  listAdjustments,
  listFridge,
  listFridgeHistory,
  markCooked,
  plannedYield,
} from '@/db/fridge';
import type { Component } from '@/domain/types';

const discrete: Component = {
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

const bulk: Component = {
  ...discrete,
  id: 2,
  name: 'Guacamole',
  color: '#5fb03c',
  portionStyle: 'bulk',
  baseQuantity: 646,
  baseUnit: 'g',
  nutritionPerBase: { energy_kcal: 1000 },
  coveragePerBase: { energy_kcal: 1 },
  totalGrams: 646,
};

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('markCooked', () => {
  it('creates stock and marks the batch cooked', async () => {
    const batchId = await scheduleBatch(discrete, '2026-09-16');
    const entryId = await markCooked(batchId, 6);

    const entry = await db.fridgeEntries.get(entryId);
    expect(entry?.remaining).toBe(6);
    expect(entry?.initialQuantity).toBe(6);
    expect((await db.batches.get(batchId))?.status).toBe('cooked');
  });

  it('divides nutrition by the ACTUAL yield, not the planned one', async () => {
    const batchId = await scheduleBatch(discrete, '2026-09-16');
    // Planned 6, got 5 — bigger servings.
    const entryId = await markCooked(batchId, 5);

    const entry = await db.fridgeEntries.get(entryId);
    expect(entry?.nutritionPerUnit.energy_kcal).toBe(240); // 1200 / 5, not / 6
    expect(entry?.gramsPerUnit).toBe(280); // 1400 / 5
  });

  it('accounts for batch scale in the total before dividing', async () => {
    const batchId = await scheduleBatch(discrete, '2026-09-16', 2);
    const entryId = await markCooked(batchId, 12);

    const entry = await db.fridgeEntries.get(entryId);
    // 1200 × 2 = 2400 across 12 servings.
    expect(entry?.nutritionPerUnit.energy_kcal).toBe(200);
  });

  it('carries coverage through unchanged', async () => {
    const batchId = await scheduleBatch(discrete, '2026-09-16');
    const entryId = await markCooked(batchId, 5);
    // Knowing 70% of the batch's B12 means knowing 70% of each serving's.
    expect((await db.fridgeEntries.get(entryId))?.coverage.vitamin_b12_ug).toBe(0.7);
  });

  it('snapshots identity so later Component edits cannot rewrite it', async () => {
    const batchId = await scheduleBatch(discrete, '2026-09-16');
    const entryId = await markCooked(batchId, 6);
    await db.components.put({ ...discrete, name: 'Renamed', color: '#000000' });

    const entry = await db.fridgeEntries.get(entryId);
    expect(entry?.componentName).toBe('Chicken Thighs');
    expect(entry?.componentColor).toBe('#c0392b');
  });

  it('measures bulk stock in grams', async () => {
    const batchId = await scheduleBatch(bulk, '2026-09-16');
    const entryId = await markCooked(batchId, 640);
    const entry = await db.fridgeEntries.get(entryId);
    expect(entry?.unit).toBe('g');
    expect(entry?.nutritionPerUnit.energy_kcal).toBeCloseTo(1000 / 640, 10);
  });

  it('rejects a zero or negative yield', async () => {
    const batchId = await scheduleBatch(discrete, '2026-09-16');
    await expect(markCooked(batchId, 0)).rejects.toThrow(/greater than zero/);
    await expect(markCooked(batchId, -2)).rejects.toThrow(/greater than zero/);
  });

  it('refuses to cook the same batch twice', async () => {
    const batchId = await scheduleBatch(discrete, '2026-09-16');
    await markCooked(batchId, 6);
    await expect(markCooked(batchId, 6)).rejects.toThrow(/already cooked/);
    expect(await db.fridgeEntries.count()).toBe(1);
  });

  it('rejects a batch that no longer exists', async () => {
    await expect(markCooked(9999, 6)).rejects.toThrow(/no longer exists/);
  });

  it('reports the planned yield for the sheet default', () => {
    expect(plannedYield(6, 2)).toBe(12);
  });
});

describe('listing', () => {
  it('shows only entries with something left', async () => {
    const a = await scheduleBatch(discrete, '2026-09-16');
    const b = await scheduleBatch(discrete, '2026-09-17');
    const emptied = await markCooked(a, 6);
    await markCooked(b, 6);
    await discardRemaining(emptied);

    expect(await listFridge()).toHaveLength(1);
    expect(await listFridgeHistory()).toHaveLength(2);
  });
});

describe('adjustStock', () => {
  async function stocked(quantity = 6) {
    const batchId = await scheduleBatch(discrete, '2026-09-16');
    return markCooked(batchId, quantity);
  }

  it('corrects downward and records the delta', async () => {
    const id = await stocked();
    await adjustStock(id, 4, 'correction', 'miscounted');

    expect((await db.fridgeEntries.get(id))?.remaining).toBe(4);
    const [adjustment] = await listAdjustments(id);
    expect(adjustment?.delta).toBe(-2);
    expect(adjustment?.reason).toBe('correction');
    expect(adjustment?.note).toBe('miscounted');
  });

  it('corrects upward past the original yield and moves the denominator with it', async () => {
    const id = await stocked();
    await adjustStock(id, 8);
    const entry = await db.fridgeEntries.get(id);
    // Otherwise a bulk progress bar would read over 100%.
    expect(entry?.remaining).toBe(8);
    expect(entry?.initialQuantity).toBe(8);
  });

  it('does not move the denominator for a correction within the original yield', async () => {
    const id = await stocked();
    await adjustStock(id, 3);
    expect((await db.fridgeEntries.get(id))?.initialQuantity).toBe(6);
  });

  it('writes nothing when the value is unchanged', async () => {
    const id = await stocked();
    await adjustStock(id, 6);
    expect(await listAdjustments(id)).toHaveLength(0);
  });

  it('rejects a negative amount', async () => {
    const id = await stocked();
    await expect(adjustStock(id, -1)).rejects.toThrow(/zero or more/);
  });

  it('omits an empty note rather than storing a blank', async () => {
    const id = await stocked();
    await adjustStock(id, 5, 'correction', '   ');
    expect('note' in ((await listAdjustments(id))[0] ?? {})).toBe(false);
  });

  it('keeps a full audit trail across several adjustments', async () => {
    const id = await stocked();
    await adjustStock(id, 5);
    await adjustStock(id, 3);
    const trail = await listAdjustments(id);
    expect(trail).toHaveLength(2);
    // Newest first.
    expect(trail[0]?.delta).toBe(-2);
  });
});

describe('discardRemaining', () => {
  it('empties the entry and records it as waste, not as eaten', async () => {
    const batchId = await scheduleBatch(discrete, '2026-09-16');
    const id = await markCooked(batchId, 6);

    await discardRemaining(id);

    expect((await db.fridgeEntries.get(id))?.remaining).toBe(0);
    const [adjustment] = await listAdjustments(id);
    expect(adjustment?.delta).toBe(-6);
    expect(adjustment?.reason).toBe('discard');
    // Nothing was logged as consumed.
    expect(await db.mealLogs.count()).toBe(0);
  });

  it('distinguishes spoiled from discarded', async () => {
    const batchId = await scheduleBatch(discrete, '2026-09-16');
    const id = await markCooked(batchId, 6);
    await discardRemaining(id, 'spoiled', 'left out overnight');

    const [adjustment] = await listAdjustments(id);
    expect(adjustment?.reason).toBe('spoiled');
    expect(adjustment?.note).toBe('left out overnight');
  });
});

describe('deleteFridgeEntry', () => {
  it('removes a mistaken entry and returns the batch to planned', async () => {
    const batchId = await scheduleBatch(discrete, '2026-09-16');
    const id = await markCooked(batchId, 6);

    await deleteFridgeEntry(id);

    expect(await db.fridgeEntries.get(id)).toBeUndefined();
    expect((await db.batches.get(batchId))?.status).toBe('planned');
  });

  it('clears the entry audit trail with it', async () => {
    const batchId = await scheduleBatch(discrete, '2026-09-16');
    const id = await markCooked(batchId, 6);
    await adjustStock(id, 4);

    await deleteFridgeEntry(id);
    expect(await db.stockAdjustments.count()).toBe(0);
  });

  it('refuses once meals have been logged from it', async () => {
    const batchId = await scheduleBatch(discrete, '2026-09-16');
    const id = await markCooked(batchId, 6);

    await db.mealLogs.add({
      date: '2026-09-16',
      loggedAt: Date.now(),
      items: [
        {
          kind: 'fridge',
          fridgeEntryId: id,
          label: 'Chicken Thighs',
          quantity: 1,
          unit: 'serving',
          grams: 233,
          nutrients: { energy_kcal: 200 },
          coverage: { energy_kcal: 1 },
        },
      ],
      nutrients: { energy_kcal: 200 },
      coverage: { energy_kcal: 1 },
      totalGrams: 233,
    });

    await expect(deleteFridgeEntry(id)).rejects.toThrow(/already logged meals/);
    expect(await db.fridgeEntries.get(id)).toBeDefined();
  });
});
