import { describe, expect, it } from 'vitest';

import chickenSkinSearch from '@/nutrition/__fixtures__/usda-search-chicken-skin.json';
import { withDerivedTotals } from '@/nutrition/registry';
import {
  adaptUsdaFood,
  adaptUsdaSearchResponse,
  convertToCanonical,
} from '@/nutrition/usda.adapter';

// Shape returned by /foods/search — flat descriptor, `value`.
const searchShapeFood = {
  fdcId: 171477,
  description: 'Chicken, broilers or fryers, thigh, meat only, raw',
  dataType: 'SR Legacy',
  foodNutrients: [
    { nutrientNumber: '208', unitName: 'KCAL', value: 119 },
    { nutrientNumber: '203', unitName: 'G', value: 19.66 },
    { nutrientNumber: '418', unitName: 'UG', value: 0.6 },
    { nutrientNumber: '301', unitName: 'MG', value: 8 },
  ],
};

// Shape returned by /food/{id} — nested descriptor, `amount`.
const detailShapeFood = {
  fdcId: 171477,
  description: 'Chicken, broilers or fryers, thigh, meat only, raw',
  dataType: 'SR Legacy',
  foodNutrients: [
    { nutrient: { number: '208', name: 'Energy', unitName: 'kcal' }, amount: 119 },
    { nutrient: { number: '203', name: 'Protein', unitName: 'g' }, amount: 19.66 },
    { nutrient: { number: '418', name: 'Vitamin B-12', unitName: 'µg' }, amount: 0.6 },
  ],
  foodPortions: [
    { amount: 1, gramWeight: 116, measureUnit: { name: 'undetermined' }, modifier: 'thigh' },
    { amount: 1, gramWeight: 140, measureUnit: { name: 'cup' } },
  ],
};

describe('convertToCanonical', () => {
  it('passes a matching unit straight through', () => {
    expect(convertToCanonical(19.66, 'g', 'g')).toBe(19.66);
  });

  it('is case-insensitive about the reported unit', () => {
    expect(convertToCanonical(8, 'MG', 'mg')).toBe(8);
  });

  it('converts between mass units', () => {
    expect(convertToCanonical(1, 'mg', 'ug')).toBeCloseTo(1000, 6);
    expect(convertToCanonical(2500, 'ug', 'mg')).toBeCloseTo(2.5, 10);
    expect(convertToCanonical(1, 'g', 'mg')).toBeCloseTo(1000, 6);
  });

  it('accepts the micro-sign and mcg spellings USDA mixes', () => {
    expect(convertToCanonical(0.6, 'µg', 'ug')).toBeCloseTo(0.6, 10);
    expect(convertToCanonical(0.6, 'mcg', 'ug')).toBeCloseTo(0.6, 10);
  });

  it('refuses IU → µg, which needs a per-substance factor', () => {
    expect(convertToCanonical(400, 'IU', 'ug')).toBeNull();
  });

  it('refuses kJ → kcal rather than silently converting a different nutrient', () => {
    expect(convertToCanonical(500, 'kJ', 'kcal')).toBeNull();
  });

  it('rejects a non-finite value', () => {
    expect(convertToCanonical(Number.NaN, 'g', 'g')).toBeNull();
  });
});

describe('adaptUsdaFood — both FDC response shapes', () => {
  it('reads the flat /foods/search shape', () => {
    const food = adaptUsdaFood(searchShapeFood);
    expect(food?.nutritionPer100g.protein_g).toBe(19.66);
    expect(food?.nutritionPer100g.energy_kcal).toBe(119);
  });

  it('reads the nested /food/{id} shape', () => {
    const food = adaptUsdaFood(detailShapeFood);
    expect(food?.nutritionPer100g.protein_g).toBe(19.66);
  });

  it('produces identical nutrition from either shape', () => {
    const fromSearch = adaptUsdaFood(searchShapeFood);
    const fromDetail = adaptUsdaFood(detailShapeFood);
    expect(fromDetail?.nutritionPer100g.energy_kcal).toBe(fromSearch?.nutritionPer100g.energy_kcal);
    expect(fromDetail?.nutritionPer100g.vitamin_b12_ug).toBe(
      fromSearch?.nutritionPer100g.vitamin_b12_ug,
    );
  });

  it('keeps identity fields', () => {
    const food = adaptUsdaFood(searchShapeFood);
    expect(food?.sourceId).toBe('171477');
    expect(food?.source).toBe('usda');
    expect(food?.dataType).toBe('SR Legacy');
  });

  it('omits a nutrient it cannot convert rather than guessing', () => {
    const food = adaptUsdaFood({
      fdcId: 1,
      description: 'Test',
      foodNutrients: [{ nutrientNumber: '328', unitName: 'IU', value: 400 }],
    });
    // 328 is vitamin_d_ug; an IU value cannot become µg safely.
    expect('vitamin_d_ug' in (food?.nutritionPer100g ?? {})).toBe(false);
  });

  it('skips nutrients that are not in the registry', () => {
    const food = adaptUsdaFood({
      fdcId: 1,
      description: 'Test',
      foodNutrients: [{ nutrientNumber: '99999', unitName: 'G', value: 5 }],
    });
    expect(food?.nutritionPer100g).toEqual({});
  });

  it('keeps a measured zero — 0 g is data, not a gap', () => {
    const food = adaptUsdaFood({
      fdcId: 1,
      description: 'Test',
      foodNutrients: [{ nutrientNumber: '605', unitName: 'G', value: 0 }],
    });
    expect(food?.nutritionPer100g.trans_fat_g).toBe(0);
    expect('trans_fat_g' in (food?.nutritionPer100g ?? {})).toBe(true);
  });

  it('parses numerics sent as strings', () => {
    const food = adaptUsdaFood({
      fdcId: '171477',
      description: 'Test',
      foodNutrients: [{ nutrientNumber: '203', unitName: 'G', value: '19.66' }],
    });
    expect(food?.nutritionPer100g.protein_g).toBe(19.66);
  });

  it('takes the first value when FDC lists a nutrient twice', () => {
    const food = adaptUsdaFood({
      fdcId: 1,
      description: 'Test',
      foodNutrients: [
        { nutrientNumber: '203', unitName: 'G', value: 19.66 },
        { nutrientNumber: '203', unitName: 'G', value: 21 },
      ],
    });
    expect(food?.nutritionPer100g.protein_g).toBe(19.66);
  });

  it('records a brand when present', () => {
    const food = adaptUsdaFood({
      fdcId: 1,
      description: 'Test',
      dataType: 'Branded',
      brandOwner: 'Some Brand Inc',
      foodNutrients: [],
    });
    expect(food?.brand).toBe('Some Brand Inc');
  });

  it('omits the brand key entirely when absent', () => {
    const food = adaptUsdaFood(searchShapeFood);
    expect('brand' in (food ?? {})).toBe(false);
  });
});

describe('adaptUsdaFood — portions', () => {
  it('normalises portion labels onto the app unit vocabulary', () => {
    const food = adaptUsdaFood(detailShapeFood);
    expect(food?.portionGrams?.cup).toBe(140);
  });

  it('falls back to the modifier when the measure unit is undetermined', () => {
    const food = adaptUsdaFood(detailShapeFood);
    expect(food?.portionGrams?.thigh).toBe(116);
  });

  it('divides by amount so the value is grams for ONE portion', () => {
    const food = adaptUsdaFood({
      fdcId: 1,
      description: 'Test',
      foodPortions: [{ amount: 4, gramWeight: 200, measureUnit: { name: 'tbsp' } }],
    });
    expect(food?.portionGrams?.tbsp).toBe(50);
  });

  it('omits portionGrams entirely when there are none', () => {
    const food = adaptUsdaFood(searchShapeFood);
    expect('portionGrams' in (food ?? {})).toBe(false);
  });

  it('ignores a portion with no usable weight', () => {
    const food = adaptUsdaFood({
      fdcId: 1,
      description: 'Test',
      foodPortions: [{ amount: 1, gramWeight: 0, measureUnit: { name: 'cup' } }],
    });
    expect('portionGrams' in (food ?? {})).toBe(false);
  });
});

describe('adaptUsdaFood — malformed input', () => {
  it('returns null rather than throwing on junk', () => {
    expect(adaptUsdaFood(null)).toBeNull();
    expect(adaptUsdaFood('nope')).toBeNull();
    expect(adaptUsdaFood([])).toBeNull();
    expect(adaptUsdaFood({})).toBeNull();
  });

  it('requires an id and a description', () => {
    expect(adaptUsdaFood({ fdcId: 1 })).toBeNull();
    expect(adaptUsdaFood({ description: 'No id' })).toBeNull();
  });

  it('survives foodNutrients being absent or wrong', () => {
    expect(adaptUsdaFood({ fdcId: 1, description: 'T' })?.nutritionPer100g).toEqual({});
    expect(
      adaptUsdaFood({ fdcId: 1, description: 'T', foodNutrients: 'oops' })?.nutritionPer100g,
    ).toEqual({});
  });
});

describe('adaptUsdaSearchResponse', () => {
  it('maps a full search payload', () => {
    const results = adaptUsdaSearchResponse({ foods: [searchShapeFood] });
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toContain('Chicken');
  });

  it('drops unusable entries instead of failing the whole search', () => {
    const results = adaptUsdaSearchResponse({ foods: [searchShapeFood, {}, null] });
    expect(results).toHaveLength(1);
  });

  it('returns an empty list for a malformed payload', () => {
    expect(adaptUsdaSearchResponse(null)).toEqual([]);
    expect(adaptUsdaSearchResponse({ foods: 'nope' })).toEqual([]);
  });
});

/**
 * FDC's datasets split fatty acids to different depths. SR Legacy and
 * Foundation name ALA (851) and linoleic acid (675) precisely; Survey (FNDDS)
 * reports only the undifferentiated 18:3 (619) and 18:2 (618). The fallbacks
 * keep FNDDS foods from silently carrying no omega data at all.
 */
describe('fatty-acid fallbacks', () => {
  it('reads the precise numbers from a real SR Legacy record', () => {
    const food = adaptUsdaFood(chickenSkinSearch);
    // 851 is 0.397, the undifferentiated 619 is 0.441 — the precise one wins.
    expect(food?.nutritionPer100g.omega3_ala_g).toBeCloseTo(0.397);
    expect(food?.nutritionPer100g.omega6_la_g).toBeCloseTo(8.16);
    // No 855 in this record, so arachidonic acid comes from 620.
    expect(food?.nutritionPer100g.omega6_aa_g).toBeCloseTo(0.133);
  });

  it('falls back to the undifferentiated numbers when that is all there is', () => {
    const food = adaptUsdaFood({
      fdcId: 1,
      description: 'Egg omelet or scrambled egg, made with oil',
      dataType: 'Survey (FNDDS)',
      foodNutrients: [
        { nutrientNumber: '618', unitName: 'G', value: 2.1 },
        { nutrientNumber: '619', unitName: 'G', value: 0.3 },
      ],
    });
    expect(food?.nutritionPer100g.omega6_la_g).toBe(2.1);
    expect(food?.nutritionPer100g.omega3_ala_g).toBe(0.3);
  });

  it('prefers the primary even when the fallback is listed first', () => {
    const food = adaptUsdaFood({
      fdcId: 1,
      description: 'x',
      foodNutrients: [
        { nutrientNumber: '619', unitName: 'G', value: 0.441 },
        { nutrientNumber: '851', unitName: 'G', value: 0.397 },
      ],
    });
    expect(food?.nutritionPer100g.omega3_ala_g).toBe(0.397);
  });

  it('totals omega-3 and omega-6 for display', () => {
    const food = adaptUsdaFood(chickenSkinSearch);
    const totals = withDerivedTotals({
      nutrients: food?.nutritionPer100g ?? {},
      coverage: {},
      totalGrams: 100,
    });
    // ALA 0.397 + EPA 0.007 + DPA 0.014 + DHA 0.007
    expect(totals.nutrients.omega3_total_g).toBeCloseTo(0.425);
    // LA 8.16 + AA 0.133
    expect(totals.nutrients.omega6_total_g).toBeCloseTo(8.293);
  });
});
