import { describe, expect, it } from 'vitest';

import {
  convert,
  densityForName,
  isCountUnit,
  isMassUnit,
  isVolumeUnit,
  needsGramPrompt,
  normalizeUnit,
  resolveToGrams,
  weakestConfidence,
} from '@/nutrition/units';

describe('normalizeUnit', () => {
  it('maps aliases onto canonical units', () => {
    expect(normalizeUnit('Grams')).toBe('g');
    expect(normalizeUnit('tablespoon')).toBe('tbsp');
    expect(normalizeUnit(' OZ ')).toBe('oz');
    expect(normalizeUnit('fl oz')).toBe('fl_oz');
  });

  it('strips a trailing period', () => {
    expect(normalizeUnit('tbsp.')).toBe('tbsp');
  });

  it('passes through anything unrecognised', () => {
    expect(normalizeUnit('handful')).toBe('handful');
  });
});

describe('unit classification', () => {
  it('classifies mass, volume and count', () => {
    expect(isMassUnit('kg')).toBe(true);
    expect(isVolumeUnit('cup')).toBe(true);
    expect(isCountUnit('serving')).toBe(true);
    expect(isMassUnit('cup')).toBe(false);
  });
});

describe('convert', () => {
  it('converts within mass', () => {
    expect(convert(1, 'kg', 'g')).toBe(1000);
    expect(convert(16, 'oz', 'lb')).toBeCloseTo(1, 10);
  });

  it('converts within volume', () => {
    expect(convert(3, 'tsp', 'tbsp')).toBeCloseTo(1, 10);
    expect(convert(1, 'cup', 'ml')).toBeCloseTo(236.588, 3);
  });

  it('refuses to cross mass and volume without a density', () => {
    expect(() => convert(1, 'cup', 'g')).toThrow(/without a density/);
  });
});

describe('resolveToGrams — the ladder in PLAN.md §4', () => {
  it('1. mass units resolve exactly', () => {
    expect(resolveToGrams(2, 'kg')).toEqual({ grams: 2000, confidence: 'exact' });
    expect(resolveToGrams(1, 'oz').grams).toBeCloseTo(28.3495, 3);
  });

  it('2. a recorded portion weight beats any density guess', () => {
    const result = resolveToGrams(2, 'tbsp', {
      name: 'Olive oil',
      portionGrams: { tbsp: 13.5 },
    });
    expect(result).toEqual({ grams: 27, confidence: 'portion' });
  });

  it('3. the ingredient own density is used for volumes', () => {
    const result = resolveToGrams(1, 'cup', { name: 'Mystery sauce', densityGPerMl: 1.1 });
    expect(result.confidence).toBe('density');
    expect(result.grams).toBeCloseTo(260.2, 1);
  });

  it('4. the builtin table covers common ingredients', () => {
    const result = resolveToGrams(1, 'tbsp', { name: 'Olive oil, extra virgin' });
    expect(result.confidence).toBe('density');
    expect(result.grams).toBeCloseTo(13.57, 2);
  });

  it('4. longest name match wins so olive oil is not generic oil', () => {
    expect(densityForName('Olive oil, extra virgin')).toBe(0.918);
    expect(densityForName('Sunflower oil')).toBe(0.92);
  });

  it('5. an unknown ingredient falls back to water, flagged as assumed', () => {
    const result = resolveToGrams(1, 'cup', { name: 'Something novel' });
    expect(result.confidence).toBe('assumed');
    expect(result.grams).toBeCloseTo(236.588, 3);
  });

  it('a count unit with no recorded weight returns unknown, not a guess', () => {
    const result = resolveToGrams(1, 'each', { name: 'Egg' });
    expect(result).toEqual({ grams: 0, confidence: 'unknown' });
    expect(needsGramPrompt(result)).toBe(true);
  });

  it('a count unit resolves once the user has taught it', () => {
    const result = resolveToGrams(2, 'each', { name: 'Egg', portionGrams: { each: 50 } });
    expect(result).toEqual({ grams: 100, confidence: 'portion' });
  });

  it('an entirely unknown unit returns unknown rather than throwing', () => {
    expect(resolveToGrams(1, 'handful', { name: 'Spinach' }).confidence).toBe('unknown');
  });

  it('resolves mass without any ingredient context at all', () => {
    expect(resolveToGrams(100, 'g').confidence).toBe('exact');
  });
});

describe('weakestConfidence', () => {
  it('surfaces the least trustworthy conversion in a recipe', () => {
    expect(
      weakestConfidence([
        { grams: 100, confidence: 'exact' },
        { grams: 14, confidence: 'density' },
        { grams: 200, confidence: 'portion' },
      ]),
    ).toBe('density');
  });

  it('is exact when everything is exact', () => {
    expect(weakestConfidence([{ grams: 100, confidence: 'exact' }])).toBe('exact');
  });

  it('is exact for an empty list', () => {
    expect(weakestConfidence([])).toBe('exact');
  });
});
