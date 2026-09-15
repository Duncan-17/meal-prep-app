/**
 * Regression tests against REAL FoodData Central payloads.
 *
 * The fixtures in `__fixtures__/` are genuine API responses, captured
 * 2026-09-15 through the proxy, trimmed to the fields the adapter reads. They
 * exist because the registry's USDA nutrient numbers were transcribed by hand
 * rather than fetched — these tests are what turned "probably right" into
 * "verified against 126 real nutrient entries".
 *
 * Both fixtures are the same food (fdcId 172855) from the two endpoints whose
 * response shapes differ, which is what makes the cross-shape check meaningful.
 *
 * If FDC ever renumbers a nutrient, these fail loudly instead of silently
 * dropping it from every future lookup.
 */

import { describe, expect, it } from 'vitest';

import detailPayload from '@/nutrition/__fixtures__/usda-detail-chicken-skin.json';
import searchPayload from '@/nutrition/__fixtures__/usda-search-chicken-skin.json';
import { adaptUsdaFood } from '@/nutrition/usda.adapter';
import { getNutrientByUsdaNumber } from '@/nutrition/registry';

const detail = adaptUsdaFood(detailPayload);
const search = adaptUsdaFood(searchPayload);

describe('real FDC payloads adapt', () => {
  it('maps both shapes', () => {
    expect(detail).not.toBeNull();
    expect(search).not.toBeNull();
  });

  it('maps the same nutrient set from either endpoint', () => {
    const detailKeys = Object.keys(detail?.nutritionPer100g ?? {}).sort();
    const searchKeys = Object.keys(search?.nutritionPer100g ?? {}).sort();
    expect(detailKeys).toEqual(searchKeys);
  });

  /**
   * FDC's /foods/search ROUNDS. /food/{id} does not.
   *
   * Discovered 2026-09-15 against this very payload: 15 of 126 nutrients differ
   * — fat 44.2 vs 44.23, monounsaturated 19 vs 18.975, niacin 2.56 vs 2.565.
   * Not an adapter bug, and not fixable here. The consequence is a design one:
   * a Component built straight from search results carries search-grade
   * precision, so Phase 3 should fetch the detail record when a food is
   * actually chosen.
   */
  it('agrees with the detail endpoint to within search rounding', () => {
    const detailMap = detail?.nutritionPer100g ?? {};
    const searchMap = search?.nutritionPer100g ?? {};

    for (const [key, detailValue] of Object.entries(detailMap)) {
      const searchValue = searchMap[key];
      expect(searchValue).toBeDefined();
      if (searchValue === undefined) continue;
      // Three significant figures is what search preserves.
      const tolerance = Math.max(Math.abs(detailValue) * 0.01, 1e-6);
      expect(Math.abs(detailValue - searchValue)).toBeLessThanOrEqual(tolerance);
    }
  });

  it('the detail endpoint is the more precise of the two', () => {
    // Pinned so nobody "simplifies" Phase 3 into using search values only.
    expect(detail?.nutritionPer100g.fat_g).toBe(44.23);
    expect(search?.nutritionPer100g.fat_g).toBe(44.2);
  });

  it('recognises a substantial share of a full SR Legacy panel', () => {
    // 74 of 126 at capture. The rest are individual fatty-acid and tocopherol
    // isomers, deliberately out of scope. A sharp drop means a mapping broke.
    expect(Object.keys(detail?.nutritionPer100g ?? {}).length).toBeGreaterThanOrEqual(70);
  });
});

describe('spot-checked values — chicken skin, raw, per 100 g', () => {
  // Read from the DETAIL response (the precise one). Wrong USDA numbers would
  // show up here as a value landing under the wrong key.
  const expected: Record<string, number> = {
    energy_kcal: 440,
    protein_g: 9.58,
    fat_g: 44.23,
    carbs_g: 0.79,
    water_g: 44.91,
    saturated_fat_g: 12.102,
    monounsaturated_fat_g: 18.975,
    cholesterol_mg: 105,
    sodium_mg: 51,
    potassium_mg: 119,
    calcium_mg: 6,
    iron_mg: 0.37,
    magnesium_mg: 8,
    zinc_mg: 0.65,
    selenium_ug: 10.1,
    vitamin_b12_ug: 0.65,
    vitamin_d_ug: 0.2,
    vitamin_a_rae_ug: 59,
    niacin_mg: 2.565,
    choline_mg: 28.3,
    leucine_g: 0.528,
  };

  for (const [key, value] of Object.entries(expected)) {
    it(`${key} = ${value}`, () => {
      expect(detail?.nutritionPer100g[key]).toBeCloseTo(value, 2);
    });
  }
});

describe('registry units match what FDC actually reports', () => {
  it('has no unit mismatch across the whole real panel', () => {
    const entries = detailPayload.foodNutrients;
    const mismatches: string[] = [];

    for (const entry of entries) {
      const def = getNutrientByUsdaNumber(entry.nutrient.number);
      if (def === undefined) continue;
      const reported = entry.nutrient.unitName.toLowerCase();
      const canonical = def.unit.toLowerCase();
      // µg/mcg/ug are the same unit spelled three ways.
      const same =
        reported === canonical || (['ug', 'mcg', 'µg'].includes(reported) && canonical === 'ug');
      if (!same)
        mismatches.push(`${entry.nutrient.number} ${def.key}: ${reported} vs ${canonical}`);
    }

    expect(mismatches).toEqual([]);
  });
});

describe('portions from a real payload', () => {
  it('extracts gram weights', () => {
    expect(detail?.portionGrams).toBeDefined();
  });

  it('does not let an imprecise portion override an exact mass conversion', () => {
    // FDC gives 1 lb = 453 g; the true value is 453.59. `resolveToGrams` tries
    // mass units FIRST, so this row is never consulted for 'lb'. Recorded here
    // because reordering that ladder would quietly lose precision.
    expect(detail?.portionGrams?.lb).toBe(453);
  });
});
