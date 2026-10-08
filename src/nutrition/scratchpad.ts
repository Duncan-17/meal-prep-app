/**
 * What a scratchpad item contains, and how it splits into portions.
 *
 * Lives in `nutrition/` rather than `domain/` because it needs unit
 * conversion (a gallon of milk → grams). Still pure and tested; the placing
 * arithmetic itself is in `domain/scratchpad.ts`.
 */

import { aggregate, emptyAggregate, nutritionForGrams, scaleNutrients } from '@/domain/nutrients';
import {
  defaultPortion,
  isCountUnit,
  isMassUnit,
  isVolumeUnit,
  resolveToGrams,
} from '@/nutrition/units';
import type {
  AdaptedFood,
  Component,
  NutrientAggregate,
  ScratchpadFood,
  ScratchpadItem,
  ScratchpadRecipe,
} from '@/domain/types';

/** Bulk recipes have no natural serving, so a batch splits into roughly this much each. */
export const BULK_PORTION_GRAMS = 250;

/** The nutrition of an item's WHOLE amount — all the eggs, every batch. */
export function itemTotal(
  item: ScratchpadItem,
  components: ReadonlyMap<number, Component>,
): NutrientAggregate {
  if (item.kind === 'food') {
    const grams = resolveToGrams(item.quantity, item.unit, {
      name: item.label,
      ...(item.portionGrams === undefined ? {} : { portionGrams: item.portionGrams }),
    }).grams;
    if (!(grams > 0)) return emptyAggregate();
    return aggregate([{ nutrients: nutritionForGrams(item.nutritionPer100g, grams), grams }]);
  }

  const recipe = components.get(item.componentId);
  // A deleted recipe contributes nothing rather than a guess.
  if (recipe === undefined) return emptyAggregate();
  return {
    nutrients: scaleNutrients(recipe.nutritionPerBase, item.batches),
    coverage: { ...recipe.coveragePerBase },
    totalGrams: recipe.totalGrams * item.batches,
  };
}

/**
 * How many pieces a food naturally splits into.
 *
 * Counted things split one per unit: twenty eggs are twenty portions. Weighed
 * or poured things split into the food's own serving where it has one (a
 * gallon of milk into cups), and into 100 g pieces where it has none.
 */
export function defaultFoodPortions(
  food: Pick<ScratchpadFood, 'quantity' | 'unit' | 'portionGrams' | 'label'>,
): number {
  const { quantity, unit } = food;
  const weighed = isMassUnit(unit) || isVolumeUnit(unit);
  if (!weighed) return Math.max(1, Math.round(quantity));

  const portionGrams = food.portionGrams;
  const grams = resolveToGrams(quantity, unit, {
    name: food.label,
    ...(portionGrams === undefined ? {} : { portionGrams }),
  }).grams;
  if (!(grams > 0)) return 1;

  // The food's own serving, whatever it is measured in — a USDA "cup" comes
  // with its gram weight, so it is as good a portion as "each".
  const servingGrams = ownServing(portionGrams)?.grams;
  return Math.max(1, Math.round(grams / (servingGrams ?? 100)));
}

/** A recipe batch: its own servings if counted, ~250 g pieces if bulk. */
export function defaultRecipePortions(recipe: Component, batches: number): number {
  if (recipe.portionStyle === 'discrete') {
    return Math.max(1, Math.round(recipe.baseQuantity * batches));
  }
  return Math.max(1, Math.round((recipe.totalGrams * batches) / BULK_PORTION_GRAMS));
}

/** What one portion is called on a chip: "egg", "serving", "cup", or "portion". */
export function portionName(
  item: ScratchpadItem,
  components: ReadonlyMap<number, Component>,
): string {
  if (item.kind === 'recipe') {
    const recipe = components.get(item.componentId);
    return recipe?.portionStyle === 'discrete' ? recipe.baseUnit : 'portion';
  }
  if (isCountUnit(item.unit) || !(isMassUnit(item.unit) || isVolumeUnit(item.unit))) {
    return item.unit === 'each' ? 'each' : item.unit;
  }
  return ownServing(item.portionGrams)?.unit ?? 'portion';
}

/** The food's preferred portion and its weight, if it has one recorded. */
function ownServing(
  portionGrams: Record<string, number> | undefined,
): { unit: string; grams: number } | undefined {
  if (portionGrams === undefined) return undefined;
  const { unit } = defaultPortion({ portionGrams });
  const grams = portionGrams[unit];
  return grams === undefined || !(grams > 0) ? undefined : { unit, grams };
}

/** A new food item: one of the food's own portion, split naturally. */
export function newFoodItem(food: AdaptedFood, uid: string, color: string): ScratchpadFood {
  const start = defaultPortion(food);
  const base = {
    kind: 'food' as const,
    uid,
    label: food.name,
    color,
    source: food.source,
    sourceId: food.sourceId,
    nutritionPer100g: food.nutritionPer100g,
    quantity: start.quantity,
    unit: start.unit,
    placed: {},
    ...(food.portionGrams === undefined ? {} : { portionGrams: food.portionGrams }),
  };
  return { ...base, portions: defaultFoodPortions(base) };
}

/** A new recipe item: one whole batch, as the user plans to cook it. */
export function newRecipeItem(recipe: Component & { id: number }, uid: string): ScratchpadRecipe {
  return {
    kind: 'recipe',
    uid,
    componentId: recipe.id,
    label: recipe.name,
    color: recipe.color,
    batches: 1,
    portions: defaultRecipePortions(recipe, 1),
    placed: {},
  };
}
