/**
 * The builder's in-progress state.
 *
 * A draft holds `AdaptedFood` objects rather than ingredient ids, so nothing
 * is written to the database until Save. Abandoning a half-built Component
 * should leave no trace.
 */

import { componentNutrition } from '@/domain/components';
import { resolveToGrams } from '@/nutrition/units';
import type { AdaptedFood, NutrientAggregate, PortionStyle } from '@/domain/types';

export interface DraftIngredient {
  /** Stable local id — dnd-kit needs one, and rows predate their DB ids. */
  uid: string;
  food: AdaptedFood;
  quantity: number;
  unit: string;
}

export interface ComponentDraftState {
  id?: number;
  name: string;
  color: string;
  category: string;
  portionStyle: PortionStyle;
  baseQuantity: number;
  baseUnit: string;
  ingredients: DraftIngredient[];
}

let counter = 0;
export function nextUid(): string {
  counter += 1;
  return `draft-${counter}-${Date.now().toString(36)}`;
}

export function emptyDraft(color: string): ComponentDraftState {
  return {
    name: '',
    color,
    category: '',
    portionStyle: 'discrete',
    baseQuantity: 6,
    baseUnit: 'serving',
    ingredients: [],
  };
}

/** Grams for one draft row, via the PLAN.md §4 ladder. */
export function draftGrams(item: DraftIngredient): number {
  return resolveToGrams(item.quantity, item.unit, item.food).grams;
}

/**
 * Live nutrition for the whole draft.
 *
 * Runs on every keystroke, which is fine — it is pure arithmetic over a
 * handful of maps, with no I/O.
 */
export function draftNutrition(draft: ComponentDraftState): NutrientAggregate {
  return componentNutrition(
    draft.ingredients.map((item) => ({
      nutritionPer100g: item.food.nutritionPer100g,
      grams: draftGrams(item),
    })),
  );
}

/**
 * For bulk Components the base quantity IS the cooked weight, so it follows
 * the ingredients automatically. Discrete keeps whatever serving count the
 * user typed.
 */
export function effectiveBaseQuantity(draft: ComponentDraftState, totalGrams: number): number {
  return draft.portionStyle === 'bulk' ? totalGrams : draft.baseQuantity;
}

export interface DraftProblem {
  field: string;
  message: string;
}

/** Everything that would make this Component invalid or silently wrong. */
export function validateDraft(draft: ComponentDraftState, totalGrams: number): DraftProblem[] {
  const problems: DraftProblem[] = [];

  if (draft.name.trim().length === 0) {
    problems.push({ field: 'name', message: 'Give it a name.' });
  }

  if (draft.ingredients.length === 0) {
    problems.push({ field: 'ingredients', message: 'Add at least one ingredient.' });
  }

  if (draft.portionStyle === 'discrete' && !(draft.baseQuantity > 0)) {
    problems.push({ field: 'baseQuantity', message: 'Yield must be greater than zero.' });
  }

  if (draft.portionStyle === 'bulk' && !(totalGrams > 0)) {
    problems.push({
      field: 'ingredients',
      message: 'A bulk Component needs ingredients with a known weight.',
    });
  }

  // Not fatal, but it means the ingredient contributes nothing at all, which
  // is worth saying out loud rather than silently producing a lighter batch.
  const unresolved = draft.ingredients.filter((item) => draftGrams(item) <= 0);
  for (const item of unresolved) {
    problems.push({
      field: 'ingredients',
      message: `“${item.food.name}” has no usable weight — it will contribute nothing.`,
    });
  }

  return problems;
}
