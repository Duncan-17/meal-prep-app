/**
 * Ingredient persistence.
 *
 * An `AdaptedFood` is a search result; an `Ingredient` is a row the user's
 * Components point at. This is where one becomes the other, deduplicated so
 * picking the same USDA food in three recipes stores it once.
 */

import { db } from '@/db/schema';
import type { AdaptedFood, Ingredient } from '@/domain/types';

/**
 * Find or create the ingredient for a food, returning its id.
 *
 * Dedupes on `[source+sourceId]`. A re-picked food REFRESHES the stored
 * nutrition, because a food fetched from the detail endpoint carries more
 * precision than the same food from search — see `usda.live.test.ts`. Later,
 * better data should win.
 */
export async function upsertIngredient(food: AdaptedFood): Promise<number> {
  const now = Date.now();

  return db.transaction('rw', db.ingredients, async () => {
    const existing = await db.ingredients
      .where('[source+sourceId]')
      .equals([food.source, food.sourceId])
      .first();

    if (existing?.id !== undefined) {
      await db.ingredients.update(existing.id, {
        name: food.name,
        nutritionPer100g: food.nutritionPer100g,
        ...(food.portionGrams === undefined ? {} : { portionGrams: food.portionGrams }),
        updatedAt: now,
      });
      return existing.id;
    }

    const row: Omit<Ingredient, 'id'> = {
      name: food.name,
      source: food.source,
      nutritionPer100g: food.nutritionPer100g,
      createdAt: now,
      updatedAt: now,
      ...(food.sourceId === '' ? {} : { sourceId: food.sourceId }),
      ...(food.portionGrams === undefined ? {} : { portionGrams: food.portionGrams }),
    };

    return db.ingredients.add(row as Ingredient);
  });
}

export async function getIngredient(id: number): Promise<Ingredient | undefined> {
  return db.ingredients.get(id);
}

export async function getIngredients(ids: readonly number[]): Promise<Map<number, Ingredient>> {
  const rows = await db.ingredients.bulkGet([...ids]);
  const map = new Map<number, Ingredient>();
  for (const row of rows) {
    if (row?.id !== undefined) map.set(row.id, row);
  }
  return map;
}

/**
 * Teach an ingredient what one of a unit weighs, so `resolveToGrams` stops
 * having to ask. PLAN.md §4 step 4: prompt once, cache on the ingredient.
 */
export async function rememberPortionWeight(
  ingredientId: number,
  unit: string,
  grams: number,
): Promise<void> {
  const ingredient = await db.ingredients.get(ingredientId);
  if (ingredient === undefined) return;

  await db.ingredients.update(ingredientId, {
    portionGrams: { ...(ingredient.portionGrams ?? {}), [unit]: grams },
    updatedAt: Date.now(),
  });
}
