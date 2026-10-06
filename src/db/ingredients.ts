/**
 * Ingredient persistence.
 *
 * An `AdaptedFood` is a search result; an `Ingredient` is a row the user's
 * Components point at. This is where one becomes the other, deduplicated so
 * picking the same USDA food in three recipes stores it once.
 */

import { db } from '@/db/schema';
import { normalizeUnit } from '@/nutrition/units';
import type { AdaptedFood, Ingredient, NutrientMap } from '@/domain/types';

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

// ── Custom foods ────────────────────────────────────────────────────────────

/**
 * Foods the user typed in themselves, because USDA does not have them.
 *
 * These are ordinary `Ingredient` rows with `source: 'manual'` — the specific
 * yoghurt drink from one supermarket is a food like any other, it just has no
 * FDC id behind it. Reusing the same table means they work everywhere a
 * looked-up food works: in a recipe, in the fridge, in Quick Add.
 */
export async function listCustomFoods(): Promise<Ingredient[]> {
  const rows = await db.ingredients.where('source').equals('manual').toArray();
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export interface CustomFoodDraft {
  /** Set when editing an existing one. */
  id?: number;
  name: string;
  /** What one serving weighs, in grams. */
  servingGrams: number;
  /** What the user calls one of them — "bottle", "bar", "each". */
  servingLabel: string;
  /** Canonical keys → amount PER 100 G. The form converts from per-serving. */
  nutritionPer100g: NutrientMap;
}

export async function saveCustomFood(draft: CustomFoodDraft): Promise<number> {
  const name = draft.name.trim();
  if (name === '') throw new Error('Give the food a name.');
  if (!(draft.servingGrams > 0)) {
    throw new Error(`A serving must weigh more than zero, got ${draft.servingGrams}.`);
  }

  const now = Date.now();
  const label = normalizeUnit(draft.servingLabel.trim() || 'serving');

  // Both the user's own word for it and a generic `serving` key, so
  // `resolveToGrams` finds a weight whichever the UI happens to ask for.
  const portionGrams: Record<string, number> = {
    serving: draft.servingGrams,
    [label]: draft.servingGrams,
  };

  if (draft.id !== undefined) {
    const existing = await db.ingredients.get(draft.id);
    if (existing === undefined) throw new Error('That food no longer exists.');
    await db.ingredients.put({
      ...existing,
      name,
      nutritionPer100g: draft.nutritionPer100g,
      portionGrams,
      updatedAt: now,
    });
    return draft.id;
  }

  return db.ingredients.add({
    name,
    source: 'manual',
    // Stable and local-only; never collides with an FDC id.
    sourceId: `custom-${now}`,
    nutritionPer100g: draft.nutritionPer100g,
    portionGrams,
    createdAt: now,
    updatedAt: now,
  } as Ingredient);
}

export class FoodInUseError extends Error {
  constructor(public readonly recipes: number) {
    super(
      `This food is in ${recipes} recipe${recipes === 1 ? '' : 's'}. Remove it from those first, or the recipe loses its nutrition.`,
    );
    this.name = 'FoodInUseError';
  }
}

/**
 * Delete a custom food, unless a recipe still lists it.
 *
 * Same reasoning as deleting a Component with cook history: the recipe's stored
 * nutrition was computed from this food, and removing it silently would leave a
 * recipe referencing something that no longer exists.
 */
export async function deleteCustomFood(id: number): Promise<void> {
  await db.transaction('rw', [db.ingredients, db.components], async () => {
    const components = await db.components.toArray();
    const used = components.filter((component) =>
      component.ingredients.some((entry) => entry.ingredientId === id),
    ).length;
    if (used > 0) throw new FoodInUseError(used);
    await db.ingredients.delete(id);
  });
}

/** How many recipes list this food — shown before offering to delete. */
export async function customFoodUsage(id: number): Promise<number> {
  const components = await db.components.toArray();
  return components.filter((component) =>
    component.ingredients.some((entry) => entry.ingredientId === id),
  ).length;
}
