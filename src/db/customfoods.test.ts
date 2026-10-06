/**
 * Custom foods: the per-serving ↔ per-100 g conversion, and the delete guard.
 *
 * The conversion is the part that goes silently wrong. A label says "150 kcal
 * per 250 ml bottle"; everything downstream wants per 100 g. Get the division
 * backwards and the numbers stay plausible while being 2.5× out.
 */

import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/schema';
import {
  FoodInUseError,
  customFoodUsage,
  deleteCustomFood,
  listCustomFoods,
  saveCustomFood,
  upsertIngredient,
} from '@/db/ingredients';
import { nutritionForGrams } from '@/domain/nutrients';
import { resolveToGrams } from '@/nutrition/units';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

/** A 250 g bottle at 150 kcal — the worked example from the request. */
async function kefir() {
  return saveCustomFood({
    name: 'Yeo Valley kefir drink',
    servingGrams: 250,
    servingLabel: 'bottle',
    // Already converted to per 100 g, as the form does before saving.
    nutritionPer100g: { energy_kcal: 60, protein_g: 4, calcium_mg: 120 },
  });
}

describe('saving', () => {
  it('stores it as a manual ingredient, so it works everywhere a food works', async () => {
    const id = await kefir();
    const stored = await db.ingredients.get(id);
    expect(stored?.source).toBe('manual');
    expect(stored?.name).toBe('Yeo Valley kefir drink');
  });

  it('records the serving weight under both `serving` and the user own word', async () => {
    const id = await kefir();
    const stored = await db.ingredients.get(id);
    expect(stored?.portionGrams?.serving).toBe(250);
    expect(stored?.portionGrams?.bottle).toBe(250);
  });

  it('resolves one bottle to its real weight rather than guessing a density', async () => {
    const id = await kefir();
    const stored = await db.ingredients.get(id);
    const resolved = resolveToGrams(2, 'bottle', stored!);
    expect(resolved.grams).toBe(500);
    expect(resolved.confidence).toBe('portion');
  });

  it('round-trips the label figure: 250 g at 60/100 g is 150 kcal a bottle', async () => {
    const id = await kefir();
    const stored = await db.ingredients.get(id);
    const perBottle = nutritionForGrams(stored!.nutritionPer100g, 250);
    expect(perBottle.energy_kcal).toBe(150);
    expect(perBottle.protein_g).toBe(10);
  });

  it('rejects a nameless food', async () => {
    await expect(
      saveCustomFood({ name: '  ', servingGrams: 100, servingLabel: 'each', nutritionPer100g: {} }),
    ).rejects.toThrow(/name/);
  });

  it('rejects a zero-weight serving, which would divide by zero', async () => {
    await expect(
      saveCustomFood({ name: 'X', servingGrams: 0, servingLabel: 'each', nutritionPer100g: {} }),
    ).rejects.toThrow(/more than zero/);
  });

  it('updates in place rather than creating a second copy', async () => {
    const id = await kefir();
    await saveCustomFood({
      id,
      name: 'Kefir (new recipe)',
      servingGrams: 250,
      servingLabel: 'bottle',
      nutritionPer100g: { energy_kcal: 70 },
    });
    expect(await db.ingredients.count()).toBe(1);
    expect((await db.ingredients.get(id))?.name).toBe('Kefir (new recipe)');
  });

  it('refuses to update one that has gone', async () => {
    await expect(
      saveCustomFood({
        id: 9999,
        name: 'Ghost',
        servingGrams: 100,
        servingLabel: 'each',
        nutritionPer100g: {},
      }),
    ).rejects.toThrow(/no longer exists/);
  });
});

describe('listing', () => {
  it('shows only the user own foods, not looked-up ones', async () => {
    await kefir();
    await upsertIngredient({
      source: 'usda',
      sourceId: '171477',
      name: 'Chicken thigh',
      nutritionPer100g: { energy_kcal: 119 },
    });

    const foods = await listCustomFoods();
    expect(foods).toHaveLength(1);
    expect(foods[0]?.name).toContain('kefir');
  });

  it('sorts alphabetically', async () => {
    await saveCustomFood({ name: 'Zinc bar', servingGrams: 50, servingLabel: 'bar', nutritionPer100g: {} });
    await kefir();
    expect((await listCustomFoods()).map((f) => f.name[0])).toEqual(['Y', 'Z']);
  });
});

describe('the delete guard', () => {
  async function kefirInARecipe() {
    const id = await kefir();
    await db.components.add({
      name: 'Breakfast',
      color: '#c0392b',
      portionStyle: 'discrete',
      baseQuantity: 1,
      baseUnit: 'serving',
      ingredients: [{ ingredientId: id, quantity: 1, unit: 'bottle', order: 0 }],
      nutritionPerBase: { energy_kcal: 150 },
      coveragePerBase: { energy_kcal: 1 },
      totalGrams: 250,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return id;
  }

  it('deletes a food nothing uses', async () => {
    const id = await kefir();
    await deleteCustomFood(id);
    expect(await db.ingredients.get(id)).toBeUndefined();
  });

  it('refuses while a recipe still lists it', async () => {
    const id = await kefirInARecipe();
    await expect(deleteCustomFood(id)).rejects.toThrow(FoodInUseError);
  });

  it('leaves the food intact after a refused delete', async () => {
    const id = await kefirInARecipe();
    await expect(deleteCustomFood(id)).rejects.toThrow();
    expect(await db.ingredients.get(id)).toBeDefined();
  });

  it('counts the recipes depending on it', async () => {
    const id = await kefirInARecipe();
    expect(await customFoodUsage(id)).toBe(1);
  });
});
