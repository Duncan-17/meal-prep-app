import { describe, expect, it } from 'vitest';

import {
  defaultFoodPortions,
  defaultRecipePortions,
  itemTotal,
  newFoodItem,
  newRecipeItem,
  portionName,
} from '@/nutrition/scratchpad';
import type { Component } from '@/domain/types';

const pasta: Component & { id: number } = {
  id: 1_760_000_000_000_001,
  name: 'Pasta',
  color: '#c0392b',
  portionStyle: 'discrete',
  baseQuantity: 6,
  baseUnit: 'serving',
  ingredients: [],
  nutritionPerBase: { energy_kcal: 3000, protein_g: 120 },
  coveragePerBase: { energy_kcal: 1, protein_g: 0.8 },
  totalGrams: 1800,
  createdAt: 0,
  updatedAt: 0,
};
const components = new Map([[pasta.id, pasta]]);

describe('itemTotal', () => {
  it('a food: the whole amount bought', () => {
    const item = newFoodItem(
      {
        source: 'usda',
        sourceId: '1',
        name: 'Egg, whole, raw',
        nutritionPer100g: { energy_kcal: 143 },
        portionGrams: { each: 50 },
      },
      'u1',
      '#e8912e',
    );
    const total = itemTotal({ ...item, quantity: 20, unit: 'each' }, components);
    expect(total.totalGrams).toBe(1000);
    expect(total.nutrients.energy_kcal).toBeCloseTo(1430);
  });

  it('a recipe: every batch, carrying the recipe’s coverage', () => {
    const total = itemTotal({ ...newRecipeItem(pasta, 'u2'), batches: 2 }, components);
    expect(total.nutrients.energy_kcal).toBe(6000);
    expect(total.coverage.protein_g).toBe(0.8);
    expect(total.totalGrams).toBe(3600);
  });

  it('a deleted recipe contributes nothing rather than a guess', () => {
    expect(itemTotal(newRecipeItem(pasta, 'u3'), new Map()).nutrients).toEqual({});
  });
});

describe('default portions', () => {
  it('counted food splits one per unit — twenty eggs, twenty portions', () => {
    expect(defaultFoodPortions({ label: 'Eggs', quantity: 20, unit: 'each' })).toBe(20);
  });

  it('weighed food splits into its own serving', () => {
    // A gallon of milk in 244 g cups: 3785 ml at the ~1 g/ml fallback → 16 cups.
    expect(
      defaultFoodPortions({ label: 'Milk', quantity: 1, unit: 'gal', portionGrams: { cup: 244 } }),
    ).toBe(16);
  });

  it('weighed food with no serving splits into 100 g pieces', () => {
    expect(defaultFoodPortions({ label: 'Rice', quantity: 1, unit: 'kg' })).toBe(10);
  });

  it('a recipe splits into its servings, or ~250 g pieces if bulk', () => {
    expect(defaultRecipePortions(pasta, 1)).toBe(6);
    expect(defaultRecipePortions(pasta, 2)).toBe(12);
    expect(defaultRecipePortions({ ...pasta, portionStyle: 'bulk', totalGrams: 3000 }, 1)).toBe(12);
  });
});

describe('portionName', () => {
  it('names a portion after what it is', () => {
    expect(portionName(newRecipeItem(pasta, 'u'), components)).toBe('serving');
    const eggs = newFoodItem(
      {
        source: 'usda',
        sourceId: '1',
        name: 'Eggs',
        nutritionPer100g: {},
        portionGrams: { each: 50 },
      },
      'u',
      '#000',
    );
    expect(portionName(eggs, components)).toBe('each');
    expect(portionName({ ...eggs, unit: 'kg', portionGrams: undefined as never }, components)).toBe(
      'portion',
    );
  });
});
