/**
 * Serving sizes come from the DETAIL endpoint, never from search.
 *
 * This exists because of a real bug. Picking a burger to put in the fridge
 * defaulted to "100 g" even though USDA knows a Whopper weighs 291 g — because
 * the sheet used the search result, and **FDC search responses carry no
 * `foodPortions` at all**. Only the Component Builder was fetching the detail
 * record, so only it got sensible defaults.
 *
 * The fixtures are real responses for the same food (fdcId 170727), captured
 * 2026-09-17. If FDC ever starts returning portions on search, the first test
 * fails and this note can be revisited — but until then, any screen that lets
 * the user pick a food must fetch the detail record first.
 */

import { describe, expect, it } from 'vitest';

import detailPayload from '@/nutrition/__fixtures__/usda-detail-burger.json';
import searchPayload from '@/nutrition/__fixtures__/usda-search-burger.json';
import { adaptUsdaFood } from '@/nutrition/usda.adapter';
import { defaultPortion, resolveToGrams, unitOptionsFor } from '@/nutrition/units';

const fromSearch = adaptUsdaFood(searchPayload);
const fromDetail = adaptUsdaFood(detailPayload);

describe('the search result cannot tell you a serving size', () => {
  it('carries no portions', () => {
    expect(fromSearch?.portionGrams).toBeUndefined();
  });

  it('therefore falls back to 100 g — which is the bug this guards', () => {
    expect(defaultPortion(fromSearch!)).toEqual({ quantity: 100, unit: 'g' });
  });
});

describe('the detail record does', () => {
  it('knows one burger weighs 291 g', () => {
    // USDA writes this as `modifier: "item"`, which normalises to `each`.
    expect(fromDetail?.portionGrams?.each).toBe(291);
  });

  it('defaults to one of them rather than 100 g', () => {
    expect(defaultPortion(fromDetail!)).toEqual({ quantity: 1, unit: 'each' });
  });

  it('resolves a count to real grams, exactly rather than by density guess', () => {
    const resolved = resolveToGrams(5, 'each', fromDetail!);
    expect(resolved.grams).toBe(1455); // five burgers
    expect(resolved.confidence).toBe('portion');
  });

  it('offers the food own unit before the generic ones', () => {
    expect(unitOptionsFor(fromDetail!)[0]).toBe('each');
  });
});

describe('both records describe the same food', () => {
  it('same id and name', () => {
    expect(fromDetail?.sourceId).toBe(fromSearch?.sourceId);
    expect(fromDetail?.name).toBe(fromSearch?.name);
  });
});
