/** Integration tests for scheduling, against a real in-memory IndexedDB. */

import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/schema';
import {
  batchNutrition,
  batchYield,
  deleteBatch,
  groupByDay,
  listBatchesForDay,
  listBatchesInRange,
  pastDueBatches,
  rescheduleBatch,
  scheduleBatch,
  setBatchScale,
  setBatchStatus,
} from '@/db/batches';
import type { Component } from '@/domain/types';

const component: Component = {
  id: 1,
  name: 'Chicken Thighs',
  color: '#c0392b',
  category: 'Protein',
  portionStyle: 'discrete',
  baseQuantity: 6,
  baseUnit: 'serving',
  ingredients: [],
  nutritionPerBase: { energy_kcal: 1666, protein_g: 275, vitamin_b12_ug: 8.4 },
  coveragePerBase: { energy_kcal: 1, protein_g: 1, vitamin_b12_ug: 0.7 },
  totalGrams: 1400,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('scheduleBatch', () => {
  it('creates a planned batch', async () => {
    const id = await scheduleBatch(component, '2026-09-16');
    const batch = await db.batches.get(id);
    expect(batch?.status).toBe('planned');
    expect(batch?.scheduledFor).toBe('2026-09-16');
    expect(batch?.scale).toBe(1);
  });

  it('snapshots the Component so later edits cannot rewrite history', async () => {
    const id = await scheduleBatch(component, '2026-09-16');

    // The recipe changes next month.
    await db.components.put({
      ...component,
      name: 'Chicken Thighs v2',
      color: '#000000',
      nutritionPerBase: { energy_kcal: 1 },
    });

    const batch = await db.batches.get(id);
    expect(batch?.componentName).toBe('Chicken Thighs');
    expect(batch?.componentColor).toBe('#c0392b');
    expect(batch?.nutritionPerBase.energy_kcal).toBe(1666);
  });

  it('keeps scale separate from the snapshot', async () => {
    const id = await scheduleBatch(component, '2026-09-16', 2);
    const batch = await db.batches.get(id);
    // The snapshot still describes ONE base batch.
    expect(batch?.nutritionPerBase.energy_kcal).toBe(1666);
    expect(batch?.baseQuantity).toBe(6);
    expect(batch?.scale).toBe(2);
  });

  it('rejects a non-positive scale', async () => {
    await expect(scheduleBatch(component, '2026-09-16', 0)).rejects.toThrow(/greater than zero/);
    await expect(scheduleBatch(component, '2026-09-16', -1)).rejects.toThrow(/greater than zero/);
  });

  it('refuses an unsaved Component', async () => {
    const unsaved = { ...component };
    delete unsaved.id;
    await expect(scheduleBatch(unsaved, '2026-09-16')).rejects.toThrow(/has not been saved/);
  });
});

describe('derived amounts', () => {
  it('scales nutrition by the batch scale', async () => {
    const id = await scheduleBatch(component, '2026-09-16', 2);
    const batch = await db.batches.get(id);
    expect(batchNutrition(batch!).energy_kcal).toBe(3332);
  });

  it('scales the yield', async () => {
    expect(batchYield({ baseQuantity: 6, scale: 2 })).toBe(12);
    expect(batchYield({ baseQuantity: 6, scale: 0.5 })).toBe(3);
  });

  it('leaves a 1× batch unchanged', async () => {
    const id = await scheduleBatch(component, '2026-09-16');
    const batch = await db.batches.get(id);
    expect(batchNutrition(batch!)).toEqual(component.nutritionPerBase);
  });
});

describe('querying by day', () => {
  beforeEach(async () => {
    await scheduleBatch(component, '2026-09-14');
    await scheduleBatch(component, '2026-09-16');
    await scheduleBatch(component, '2026-09-16');
    await scheduleBatch(component, '2026-09-21');
  });

  it('returns an inclusive range', async () => {
    const week = await listBatchesInRange('2026-09-14', '2026-09-20');
    expect(week).toHaveLength(3);
  });

  it('excludes days outside the range', async () => {
    const week = await listBatchesInRange('2026-09-14', '2026-09-20');
    expect(week.some((batch) => batch.scheduledFor === '2026-09-21')).toBe(false);
  });

  it('finds a single day', async () => {
    expect(await listBatchesForDay('2026-09-16')).toHaveLength(2);
  });

  it('groups by day', async () => {
    const grouped = groupByDay(await listBatchesInRange('2026-09-14', '2026-09-20'));
    expect(grouped.get('2026-09-16')).toHaveLength(2);
    expect(grouped.get('2026-09-14')).toHaveLength(1);
    expect(grouped.get('2026-09-15')).toBeUndefined();
  });
});

describe('editing', () => {
  it('reschedules a planned batch', async () => {
    const id = await scheduleBatch(component, '2026-09-16');
    await rescheduleBatch(id, '2026-09-18');
    expect((await db.batches.get(id))?.scheduledFor).toBe('2026-09-18');
  });

  it('refuses to move a cooked batch', async () => {
    const id = await scheduleBatch(component, '2026-09-16');
    await setBatchStatus(id, 'cooked');
    await expect(rescheduleBatch(id, '2026-09-18')).rejects.toThrow(/cannot be moved/);
  });

  it('changes scale', async () => {
    const id = await scheduleBatch(component, '2026-09-16');
    await setBatchScale(id, 3);
    expect((await db.batches.get(id))?.scale).toBe(3);
  });

  it('rejects a bad scale', async () => {
    const id = await scheduleBatch(component, '2026-09-16');
    await expect(setBatchScale(id, 0)).rejects.toThrow(/greater than zero/);
  });
});

describe('deleteBatch', () => {
  it('removes a planned batch', async () => {
    const id = await scheduleBatch(component, '2026-09-16');
    await deleteBatch(id);
    expect(await db.batches.get(id)).toBeUndefined();
  });

  it('refuses when the batch is already in the fridge', async () => {
    const id = await scheduleBatch(component, '2026-09-16');
    await db.fridgeEntries.add({
      batchId: id,
      componentId: 1,
      componentName: 'Chicken Thighs',
      componentColor: '#c0392b',
      portionStyle: 'discrete',
      unit: 'serving',
      initialQuantity: 6,
      remaining: 6,
      nutritionPerUnit: {},
      coverage: {},
      gramsPerUnit: 233,
      cookedAt: Date.now(),
      createdAt: Date.now(),
    });

    await expect(deleteBatch(id)).rejects.toThrow(/already been cooked/);
    expect(await db.batches.get(id)).toBeDefined();
  });
});

describe('pastDueBatches', () => {
  it('finds planned cooks whose day has gone', async () => {
    await scheduleBatch(component, '2026-09-10');
    await scheduleBatch(component, '2026-09-20');
    const overdue = await pastDueBatches('2026-09-15');
    expect(overdue).toHaveLength(1);
    expect(overdue[0]?.scheduledFor).toBe('2026-09-10');
  });

  it('ignores cooked and skipped ones — those were decisions', async () => {
    const cooked = await scheduleBatch(component, '2026-09-10');
    const skipped = await scheduleBatch(component, '2026-09-11');
    await setBatchStatus(cooked, 'cooked');
    await setBatchStatus(skipped, 'skipped');
    expect(await pastDueBatches('2026-09-15')).toHaveLength(0);
  });

  it('does not treat today as overdue', async () => {
    await scheduleBatch(component, '2026-09-15');
    expect(await pastDueBatches('2026-09-15')).toHaveLength(0);
  });

  it('sorts oldest first', async () => {
    await scheduleBatch(component, '2026-09-12');
    await scheduleBatch(component, '2026-09-08');
    const overdue = await pastDueBatches('2026-09-15');
    expect(overdue.map((batch) => batch.scheduledFor)).toEqual(['2026-09-08', '2026-09-12']);
  });
});
