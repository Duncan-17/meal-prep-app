import { describe, expect, it } from 'vitest';

import { componentNutrition, componentPerUnit } from '@/domain/components';

// Rice carries no B12; chicken does. Rolling them together is the smallest
// honest test of the whole coverage idea.
const rice = {
  nutritionPer100g: { energy_kcal: 365, protein_g: 7.1, iron_mg: 0.8 },
  grams: 300,
};
const chicken = {
  nutritionPer100g: { energy_kcal: 119, protein_g: 19.7, iron_mg: 0.9, vitamin_b12_ug: 0.6 },
  grams: 700,
};

describe('componentNutrition', () => {
  it('scales each ingredient to its actual weight', () => {
    const total = componentNutrition([rice]);
    expect(total.nutrients.energy_kcal).toBeCloseTo(1095, 6);
    expect(total.nutrients.protein_g).toBeCloseTo(21.3, 6);
  });

  it('sums across ingredients', () => {
    const total = componentNutrition([rice, chicken]);
    expect(total.nutrients.energy_kcal).toBeCloseTo(1095 + 833, 6);
  });

  it('records total cooked weight', () => {
    expect(componentNutrition([rice, chicken]).totalGrams).toBe(1000);
  });

  it('reports partial coverage for a nutrient only one ingredient carried', () => {
    const total = componentNutrition([rice, chicken]);
    // Only the 700 g of chicken had a B12 value.
    expect(total.coverage.vitamin_b12_ug).toBeCloseTo(0.7, 10);
    expect(total.coverage.energy_kcal).toBe(1);
  });

  it('is empty for a component with no ingredients', () => {
    const total = componentNutrition([]);
    expect(total.nutrients).toEqual({});
    expect(total.totalGrams).toBe(0);
  });
});

describe('componentPerUnit', () => {
  it('divides the batch across its yield', () => {
    const total = componentNutrition([rice, chicken]);
    const perUnit = componentPerUnit(total, 4);
    expect(perUnit.nutrients.energy_kcal).toBeCloseTo((1095 + 833) / 4, 6);
  });

  it('divides weight too, so grams and nutrition stay in step', () => {
    const perUnit = componentPerUnit(componentNutrition([rice, chicken]), 4);
    expect(perUnit.gramsPerUnit).toBe(250);
  });

  it('leaves coverage unchanged — half a batch is half of the same knowledge', () => {
    const total = componentNutrition([rice, chicken]);
    const perUnit = componentPerUnit(total, 4);
    expect(perUnit.coverage).toEqual(total.coverage);
  });

  it('rejects a zero yield', () => {
    expect(() => componentPerUnit(componentNutrition([rice]), 0)).toThrow(/must be > 0/);
  });
});
