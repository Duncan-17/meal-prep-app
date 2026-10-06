/**
 * Descriptions here are real FoodData Central results, captured 2026-10-06
 * from the searches that prompted this module: "egg" and "rice".
 */

import { describe, expect, it } from 'vitest';

import { RESULT_CAP, describeFood, rankFoods } from '@/domain/foodSearch';
import type { AdaptedFood } from '@/domain/types';

let nextId = 1;
function food(name: string, dataType: string, extra: Partial<AdaptedFood> = {}): AdaptedFood {
  return {
    source: 'usda',
    sourceId: String(nextId++),
    name,
    dataType,
    nutritionPer100g: {},
    ...extra,
  };
}

describe('rankFoods', () => {
  it('puts the plain food ahead of a candy that shares its name', () => {
    // FDC's own order for "egg": the Snickers egg came first.
    const results = rankFoods(
      [
        food('EGG', 'Branded', { brand: 'SNICKERS', category: 'Candy' }),
        food('Bagels, egg', 'SR Legacy'),
        food('Egg, whole, cooked, fried', 'SR Legacy'),
        food('Eggs, Grade A, Large, egg whole', 'Foundation'),
      ],
      'egg',
    );
    expect(results.map((entry) => entry.name)).toEqual([
      'Eggs, Grade A, Large, egg whole',
      'Egg, whole, cooked, fried',
      'EGG',
      'Bagels, egg',
    ]);
  });

  it('surfaces plain rice from under the packaged products', () => {
    // FDC's order for "rice": seven Branded "RICE" products first, plain
    // cooked rice 41st.
    const results = rankFoods(
      [
        food('RICE', 'Branded', { brand: 'WINDMILL RICE' }),
        food('RICE', 'Branded', { brand: 'TEXAS' }),
        food('Rice dressing', 'Survey (FNDDS)'),
        food('Crackers, rice', 'Survey (FNDDS)'),
        food('Rice, cooked, NFS', 'Survey (FNDDS)'),
      ],
      'rice',
    );
    expect(results[0]?.name).toBe('Rice, cooked, NFS');
    expect(results.at(-1)?.name).toBe('Crackers, rice');
  });

  it('keeps one copy of a food listed by both Foundation and SR Legacy', () => {
    const results = rankFoods(
      [food('Egg, whole, dried', 'SR Legacy'), food('Egg, whole, dried', 'Foundation')],
      'egg',
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.dataType).toBe('Foundation');
  });

  it('keeps two brands of the same thing — they are different products', () => {
    const results = rankFoods(
      [
        food('RICE', 'Branded', { brand: 'WEIS' }),
        food('RICE', 'Branded', { brand: 'RICO' }),
        food('RICE', 'Branded', { brand: 'WEIS' }),
      ],
      'rice',
    );
    expect(results.map((entry) => entry.brand)).toEqual(['WEIS', 'RICO']);
  });

  it(`caps the list at ${RESULT_CAP}`, () => {
    const many = Array.from({ length: 50 }, (_, index) =>
      food(`Egg, variety ${index}`, 'SR Legacy'),
    );
    expect(rankFoods(many, 'egg')).toHaveLength(RESULT_CAP);
  });

  it('keeps FDC order among equals', () => {
    const a = food('Egg, white, raw, fresh', 'SR Legacy');
    const b = food('Egg, yolk, raw, fresh', 'SR Legacy');
    expect(rankFoods([a, b], 'egg')).toEqual([a, b]);
    expect(rankFoods([b, a], 'egg')).toEqual([b, a]);
  });
});

describe('describeFood', () => {
  it('splits headline from detail and names the cooking method', () => {
    expect(describeFood(food('Egg, whole, cooked, fried', 'SR Legacy'))).toMatchObject({
      title: 'Egg',
      detail: 'whole',
      prep: 'Cooked · fried',
      source: 'USDA reference',
    });
  });

  it('calls raw eggs raw', () => {
    expect(describeFood(food('Egg, whole, raw, fresh', 'SR Legacy'))).toMatchObject({
      prep: 'Raw',
      detail: 'whole, fresh',
    });
  });

  it('calls raw rice DRY, because that is what USDA means by it', () => {
    expect(
      describeFood(food('Rice, white, long-grain, regular, raw, enriched', 'SR Legacy')),
    ).toMatchObject({
      title: 'Rice',
      prep: 'Dry · uncooked',
      detail: 'white, long-grain, regular, enriched',
    });
    expect(describeFood(food('Rice noodles, dry', 'SR Legacy')).prep).toBe('Dry · uncooked');
    expect(describeFood(food('Beans, black, mature seeds, raw', 'SR Legacy')).prep).toBe(
      'Dry · uncooked',
    );
  });

  it('does not call green beans dry', () => {
    expect(describeFood(food('Beans, snap, green, raw', 'SR Legacy')).prep).toBe('Raw');
  });

  it('spells out NFS', () => {
    expect(describeFood(food('Rice, cooked, NFS', 'Survey (FNDDS)'))).toMatchObject({
      prep: 'Cooked',
      detail: 'type not specified',
    });
  });

  it('infers dry vs cooked for a packaged staple named only "RICE"', () => {
    const dry = describeFood(
      food('RICE', 'Branded', { brand: 'WEIS', nutritionPer100g: { energy_kcal: 356 } }),
    );
    expect(dry).toMatchObject({
      title: 'Rice',
      prep: 'Likely dry · uncooked',
      prepInferred: true,
      brand: 'Weis',
      source: 'Packaged product',
    });

    const cooked = describeFood(
      food('RICE', 'Branded', { nutritionPer100g: { energy_kcal: 130 } }),
    );
    expect(cooked.prep).toBe('Likely cooked');
  });

  it('infers nothing for ready-to-eat things made of rice', () => {
    const crackers = describeFood(
      food('RICE CRACKERS', 'Branded', { nutritionPer100g: { energy_kcal: 390 } }),
    );
    expect(crackers.prep).toBeNull();
  });

  it('gives the category always, and the brand for packaged food', () => {
    expect(
      describeFood(food('Bagels, egg', 'SR Legacy', { category: 'Baked Products' })),
    ).toMatchObject({ category: 'Baked Products', brand: null });
    // The Snickers egg: the category is what gives it away.
    expect(
      describeFood(food('EGG', 'Branded', { brand: 'SNICKERS', category: 'Candy' })),
    ).toMatchObject({ category: 'Candy', brand: 'Snickers' });
  });

  it('combines states', () => {
    expect(describeFood(food('Peas, green, frozen, unprepared', 'SR Legacy')).prep).toBe(
      'Unprepared · Frozen',
    );
  });
});
