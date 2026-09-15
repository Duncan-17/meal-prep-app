/**
 * Integration tests for the persistence layer.
 *
 * Everything else in this project is tested as pure functions, but the write
 * path is where a real bug would hide: a wrong index, a transaction that does
 * not span the tables it touches, a guard that does not actually guard.
 * `fake-indexeddb` runs the real Dexie code against an in-memory IndexedDB, so
 * these exercise the genuine schema rather than a mock of it.
 */

import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/schema';
import { ensureDefaults } from '@/db/init';
import {
  ComponentInUseError,
  componentColors,
  componentUsage,
  deleteComponent,
  getComponent,
  listComponents,
  saveComponent,
} from '@/db/components';
import { getIngredients, rememberPortionWeight, upsertIngredient } from '@/db/ingredients';
import { cacheFoods, cacheSearch, getCachedSearch, clearFoodCaches } from '@/db/foods';
import { exportBackup, importBackup } from '@/db/backup';
import type { AdaptedFood } from '@/domain/types';

const chicken: AdaptedFood = {
  source: 'usda',
  sourceId: '171477',
  name: 'Chicken thigh, raw',
  dataType: 'SR Legacy',
  nutritionPer100g: { energy_kcal: 119, protein_g: 19.66, vitamin_b12_ug: 0.6 },
  portionGrams: { each: 116 },
};

const rice: AdaptedFood = {
  source: 'usda',
  sourceId: '169756',
  name: 'Rice, white, raw',
  dataType: 'SR Legacy',
  // Deliberately no B12 — the coverage case.
  nutritionPer100g: { energy_kcal: 365, protein_g: 7.13 },
};

async function resetDb() {
  await db.delete();
  await db.open();
}

beforeEach(async () => {
  await resetDb();
});

describe('ingredients', () => {
  it('creates a row and returns its id', async () => {
    const id = await upsertIngredient(chicken);
    const stored = await db.ingredients.get(id);
    expect(stored?.name).toBe('Chicken thigh, raw');
    expect(stored?.nutritionPer100g.protein_g).toBe(19.66);
  });

  it('dedupes on source + sourceId rather than creating a second row', async () => {
    const first = await upsertIngredient(chicken);
    const second = await upsertIngredient(chicken);
    expect(second).toBe(first);
    expect(await db.ingredients.count()).toBe(1);
  });

  it('refreshes stored nutrition when a food is re-picked', async () => {
    const id = await upsertIngredient(chicken);
    // Detail-endpoint precision arriving after a search-grade row.
    await upsertIngredient({
      ...chicken,
      nutritionPer100g: { ...chicken.nutritionPer100g, protein_g: 19.664 },
    });
    const stored = await db.ingredients.get(id);
    expect(stored?.nutritionPer100g.protein_g).toBe(19.664);
  });

  it('keeps different foods apart', async () => {
    await upsertIngredient(chicken);
    await upsertIngredient(rice);
    expect(await db.ingredients.count()).toBe(2);
  });

  it('remembers a taught portion weight without losing existing ones', async () => {
    const id = await upsertIngredient(chicken);
    await rememberPortionWeight(id, 'cup', 140);
    const stored = await db.ingredients.get(id);
    expect(stored?.portionGrams).toEqual({ each: 116, cup: 140 });
  });

  it('bulk-gets by id', async () => {
    const a = await upsertIngredient(chicken);
    const b = await upsertIngredient(rice);
    const map = await getIngredients([a, b]);
    expect(map.size).toBe(2);
    expect(map.get(a)?.name).toContain('Chicken');
  });
});

describe('components', () => {
  async function makeComponent(name = 'Chicken Thighs') {
    const ingredientId = await upsertIngredient(chicken);
    return saveComponent({
      name,
      color: '#c0392b',
      category: 'Protein',
      portionStyle: 'discrete',
      baseQuantity: 6,
      baseUnit: 'serving',
      ingredients: [{ ingredientId, quantity: 1400, unit: 'g', order: 0 }],
      nutritionPerBase: { energy_kcal: 1666, protein_g: 275 },
      coveragePerBase: { energy_kcal: 1, protein_g: 1 },
      totalGrams: 1400,
    });
  }

  it('saves and reads back', async () => {
    const id = await makeComponent();
    const stored = await getComponent(id);
    expect(stored?.name).toBe('Chicken Thighs');
    expect(stored?.ingredients).toHaveLength(1);
    expect(stored?.createdAt).toBeGreaterThan(0);
  });

  it('omits an empty category rather than storing a blank string', async () => {
    const ingredientId = await upsertIngredient(rice);
    const id = await saveComponent({
      name: 'Rice',
      color: '#c5cf3c',
      category: '   ',
      portionStyle: 'discrete',
      baseQuantity: 6,
      baseUnit: 'serving',
      ingredients: [{ ingredientId, quantity: 500, unit: 'g', order: 0 }],
      nutritionPerBase: {},
      coveragePerBase: {},
      totalGrams: 500,
    });
    expect('category' in ((await getComponent(id)) ?? {})).toBe(false);
  });

  it('updates in place instead of inserting a duplicate', async () => {
    const id = await makeComponent();
    await saveComponent({
      id,
      name: 'Chicken Thighs (spicy)',
      color: '#c0392b',
      portionStyle: 'discrete',
      baseQuantity: 8,
      baseUnit: 'serving',
      ingredients: [],
      nutritionPerBase: {},
      coveragePerBase: {},
      totalGrams: 0,
    });

    expect(await db.components.count()).toBe(1);
    const stored = await getComponent(id);
    expect(stored?.name).toBe('Chicken Thighs (spicy)');
    expect(stored?.baseQuantity).toBe(8);
  });

  it('preserves createdAt across an edit', async () => {
    const id = await makeComponent();
    const before = await getComponent(id);
    await saveComponent({
      id,
      name: 'Renamed',
      color: '#c0392b',
      portionStyle: 'discrete',
      baseQuantity: 6,
      baseUnit: 'serving',
      ingredients: [],
      nutritionPerBase: {},
      coveragePerBase: {},
      totalGrams: 0,
    });
    expect((await getComponent(id))?.createdAt).toBe(before?.createdAt);
  });

  it('refuses to update a component that no longer exists', async () => {
    await expect(
      saveComponent({
        id: 9999,
        name: 'Ghost',
        color: '#c0392b',
        portionStyle: 'discrete',
        baseQuantity: 1,
        baseUnit: 'serving',
        ingredients: [],
        nutritionPerBase: {},
        coveragePerBase: {},
        totalGrams: 0,
      }),
    ).rejects.toThrow(/no longer exists/);
  });

  it('lists alphabetically', async () => {
    await makeComponent('Rice');
    await makeComponent('Avocado');
    const names = (await listComponents()).map((component) => component.name);
    expect(names).toEqual(['Avocado', 'Rice']);
  });

  it('reports colours in use, excluding the one being edited', async () => {
    const id = await makeComponent();
    expect(await componentColors()).toHaveLength(1);
    expect(await componentColors(id)).toHaveLength(0);
  });
});

describe('component delete guard', () => {
  async function componentWithBatch() {
    const ingredientId = await upsertIngredient(chicken);
    const componentId = await saveComponent({
      name: 'Chicken Thighs',
      color: '#c0392b',
      portionStyle: 'discrete',
      baseQuantity: 6,
      baseUnit: 'serving',
      ingredients: [{ ingredientId, quantity: 1400, unit: 'g', order: 0 }],
      nutritionPerBase: {},
      coveragePerBase: {},
      totalGrams: 1400,
    });

    await db.batches.add({
      componentId,
      scheduledFor: '2026-09-15',
      scale: 1,
      status: 'cooked',
      componentName: 'Chicken Thighs',
      componentColor: '#c0392b',
      portionStyle: 'discrete',
      baseQuantity: 6,
      baseUnit: 'serving',
      nutritionPerBase: {},
      coveragePerBase: {},
      totalGrams: 1400,
      createdAt: Date.now(),
    });

    return componentId;
  }

  it('deletes a component with no history', async () => {
    const ingredientId = await upsertIngredient(rice);
    const id = await saveComponent({
      name: 'Rice',
      color: '#c5cf3c',
      portionStyle: 'discrete',
      baseQuantity: 6,
      baseUnit: 'serving',
      ingredients: [{ ingredientId, quantity: 500, unit: 'g', order: 0 }],
      nutritionPerBase: {},
      coveragePerBase: {},
      totalGrams: 500,
    });

    await deleteComponent(id);
    expect(await getComponent(id)).toBeUndefined();
  });

  it('refuses to delete one that has been cooked', async () => {
    const id = await componentWithBatch();
    await expect(deleteComponent(id)).rejects.toThrow(ComponentInUseError);
  });

  it('leaves the component intact after a refused delete', async () => {
    const id = await componentWithBatch();
    await expect(deleteComponent(id)).rejects.toThrow();
    expect(await getComponent(id)).toBeDefined();
  });

  it('counts what depends on it', async () => {
    const id = await componentWithBatch();
    expect(await componentUsage(id)).toEqual({ batches: 1, fridgeEntries: 0 });
  });
});

describe('food cache', () => {
  it('round-trips a search', async () => {
    await cacheFoods([chicken, rice]);
    await cacheSearch('chicken thigh', [chicken, rice]);

    const cached = await getCachedSearch('chicken thigh');
    expect(cached?.map((food) => food.sourceId)).toEqual(['171477', '169756']);
  });

  it('normalises the query so spacing and case still hit', async () => {
    await cacheFoods([chicken]);
    await cacheSearch('Chicken  Thigh', [chicken]);
    expect(await getCachedSearch('  chicken thigh ')).not.toBeNull();
  });

  it('expires by TTL', async () => {
    await cacheFoods([chicken]);
    await cacheSearch('chicken', [chicken]);
    expect(await getCachedSearch('chicken', -1)).toBeNull();
  });

  it('returns null rather than a partial result when a food was evicted', async () => {
    await cacheFoods([chicken, rice]);
    await cacheSearch('two foods', [chicken, rice]);
    await db.foodCache.delete('usda:169756');
    expect(await getCachedSearch('two foods')).toBeNull();
  });

  it('clears both cache tables and nothing else', async () => {
    await upsertIngredient(chicken);
    await cacheFoods([chicken]);
    await cacheSearch('chicken', [chicken]);

    await clearFoodCaches();

    expect(await db.foodCache.count()).toBe(0);
    expect(await db.searchCache.count()).toBe(0);
    expect(await db.ingredients.count()).toBe(1);
  });
});

describe('defaults', () => {
  it('seeds targets and settings once', async () => {
    await ensureDefaults();
    const targetCount = await db.targets.count();
    expect(targetCount).toBeGreaterThan(20);
    expect((await db.settings.get('settings'))?.pinnedNutrients).toHaveLength(10);

    await ensureDefaults();
    expect(await db.targets.count()).toBe(targetCount);
  });

  it('does not overwrite an edited target', async () => {
    await ensureDefaults();
    await db.targets.put({ key: 'protein_g', amount: 200, isDefault: false });
    await ensureDefaults();
    expect((await db.targets.get('protein_g'))?.amount).toBe(200);
  });
});

describe('backup round-trip', () => {
  it('exports user data and restores it over a wiped database', async () => {
    await ensureDefaults();
    const ingredientId = await upsertIngredient(chicken);
    await saveComponent({
      name: 'Chicken Thighs',
      color: '#c0392b',
      portionStyle: 'discrete',
      baseQuantity: 6,
      baseUnit: 'serving',
      ingredients: [{ ingredientId, quantity: 1400, unit: 'g', order: 0 }],
      nutritionPerBase: { energy_kcal: 1666 },
      coveragePerBase: { energy_kcal: 1 },
      totalGrams: 1400,
    });

    const backup = await exportBackup();
    await resetDb();
    expect(await db.components.count()).toBe(0);

    await importBackup(JSON.stringify(backup));

    const restored = await listComponents();
    expect(restored).toHaveLength(1);
    expect(restored[0]?.name).toBe('Chicken Thighs');
    expect(restored[0]?.nutritionPerBase.energy_kcal).toBe(1666);
    expect(await db.ingredients.count()).toBe(1);
  });

  it('excludes the caches from the exported file', async () => {
    await cacheFoods([chicken]);
    const backup = await exportBackup();
    expect('foodCache' in backup.data).toBe(false);
    expect('searchCache' in backup.data).toBe(false);
  });

  it('leaves the database untouched when the file is invalid', async () => {
    await upsertIngredient(chicken);
    await expect(importBackup('{"format":"something-else"}')).rejects.toThrow();
    expect(await db.ingredients.count()).toBe(1);
  });

  it('rejects malformed JSON before touching anything', async () => {
    await upsertIngredient(chicken);
    await expect(importBackup('not json')).rejects.toThrow(/not valid JSON/);
    expect(await db.ingredients.count()).toBe(1);
  });
});
