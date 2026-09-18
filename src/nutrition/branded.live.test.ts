/**
 * Branded foods are a third response shape, and the nastiest one.
 *
 * Two things are true of the fixtures here, both captured 2026-09-17 from the
 * same food (fdcId 1870455):
 *
 * 1. The **detail** record has no usable nutrients at all. Its `foodNutrients`
 *    entries carry an internal `id` and an `amount` and nothing else — no
 *    number, no name, no unit — and `labelNutrients` is empty. The **search**
 *    result for the same food has all fifteen, fully described.
 * 2. The detail record is nonetheless the only place the **serving size**
 *    lives, because branded foods have no `foodPortions` whatsoever.
 *
 * So neither response is sufficient alone, and preferring either one wholesale
 * loses real data. That is what `mergeDetail` in `features/foods/api.ts` exists
 * for, and why it is written the way it is.
 */

import { describe, expect, it } from 'vitest';

import brandedDetail from '@/nutrition/__fixtures__/usda-detail-branded.json';
import brandedSearch from '@/nutrition/__fixtures__/usda-search-branded.json';
import { adaptUsdaFood } from '@/nutrition/usda.adapter';
import { defaultPortion, resolveToGrams } from '@/nutrition/units';

const fromDetail = adaptUsdaFood(brandedDetail);
const fromSearch = adaptUsdaFood(brandedSearch);

describe('a branded detail record cannot be trusted for nutrition', () => {
  it('maps nothing, because its nutrients carry no descriptor', () => {
    expect(Object.keys(fromDetail?.nutritionPer100g ?? {})).toHaveLength(0);
  });

  it('while the search result for the same food is complete', () => {
    expect(Object.keys(fromSearch?.nutritionPer100g ?? {}).length).toBeGreaterThan(5);
  });
});

describe('but it is the only source of the serving size', () => {
  it('has no foodPortions at all', () => {
    expect(brandedDetail.foodPortions).toHaveLength(0);
  });

  it('reads servingSize into a usable portion', () => {
    // The label says 17 g per serving.
    expect(fromDetail?.portionGrams?.serving).toBe(17);
  });

  it('also names the portion from the household text where it is a plain count', () => {
    // householdServingFullText is "1 Tbsp".
    expect(fromDetail?.portionGrams?.tbsp).toBe(17);
  });

  it('defaults to one serving rather than 100 g', () => {
    expect(defaultPortion(fromDetail!)).toEqual({ quantity: 1, unit: 'serving' });
  });

  it('resolves servings to exact grams, not a density guess', () => {
    const resolved = resolveToGrams(3, 'serving', fromDetail!);
    expect(resolved.grams).toBe(51);
    expect(resolved.confidence).toBe('portion');
  });

  it('the search result, by contrast, knows no portion at all', () => {
    expect(fromSearch?.portionGrams).toBeUndefined();
    expect(defaultPortion(fromSearch!)).toEqual({ quantity: 100, unit: 'g' });
  });
});
