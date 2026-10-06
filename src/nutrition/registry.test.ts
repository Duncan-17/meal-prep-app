import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PINNED_NUTRIENTS,
  DERIVED_TOTALS,
  NUTRIENTS,
  NUTRIENT_GROUP_ORDER,
  formatAmount,
  getNutrient,
  getNutrientByUsdaNumber,
  isKnownNutrient,
  nutrientName,
  nutrientsInGroup,
} from '@/nutrition/registry';

describe('registry integrity', () => {
  // These guard the invariant the whole nutrition layer rests on: one key per
  // nutrient, one USDA number per key. A duplicate would silently overwrite.
  it('has no duplicate canonical keys', () => {
    const keys = NUTRIENTS.map((n) => n.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has no duplicate USDA numbers, fallbacks included', () => {
    // A fallback that collided with a primary would be read twice, as two
    // different nutrients.
    const numbers = NUTRIENTS.flatMap((n) => [
      ...(n.usdaNumber === undefined ? [] : [n.usdaNumber]),
      ...(n.usdaFallbacks ?? []),
    ]);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('gives every nutrient either a USDA number or the parts it is derived from', () => {
    for (const nutrient of NUTRIENTS) {
      expect((nutrient.usdaNumber === undefined) !== (nutrient.derivedFrom === undefined)).toBe(
        true,
      );
    }
  });

  it('derives totals only from measured nutrients in the same unit', () => {
    for (const [key, parts] of Object.entries(DERIVED_TOTALS)) {
      for (const part of parts) {
        const def = getNutrient(part);
        expect(def?.usdaNumber, `${key} ← ${part}`).toBeDefined();
        expect(def?.unit).toBe(getNutrient(key)?.unit);
      }
    }
  });

  it('gives every nutrient a group in the display order', () => {
    for (const nutrient of NUTRIENTS) {
      expect(NUTRIENT_GROUP_ORDER).toContain(nutrient.group);
    }
  });

  it('gives every nutrient a non-negative integer precision', () => {
    for (const nutrient of NUTRIENTS) {
      expect(Number.isInteger(nutrient.precision)).toBe(true);
      expect(nutrient.precision).toBeGreaterThanOrEqual(0);
    }
  });

  it('names every key in the canonical unit suffix convention', () => {
    // A key ending _mg must be stored in mg, so no call site has to convert.
    for (const nutrient of NUTRIENTS) {
      if (nutrient.key.endsWith('_mg')) expect(nutrient.unit).toBe('mg');
      if (nutrient.key.endsWith('_ug')) expect(nutrient.unit).toBe('ug');
      if (nutrient.key.endsWith('_g')) expect(['g', 'mg', 'ug']).toContain(nutrient.unit);
      if (nutrient.key.endsWith('_kcal')) expect(nutrient.unit).toBe('kcal');
      if (nutrient.key.endsWith('_iu')) expect(nutrient.unit).toBe('iu');
    }
  });
});

describe('lookups', () => {
  it('finds a nutrient by key', () => {
    expect(getNutrient('energy_kcal')?.name).toBe('Calories');
  });

  it('finds a nutrient by USDA number', () => {
    expect(getNutrientByUsdaNumber('203')?.key).toBe('protein_g');
  });

  it('returns undefined for an unknown key rather than throwing', () => {
    expect(getNutrient('unobtainium_mg')).toBeUndefined();
    expect(isKnownNutrient('unobtainium_mg')).toBe(false);
  });

  it('falls back to the raw key so unmapped data stays visible', () => {
    expect(nutrientName('unobtainium_mg')).toBe('unobtainium_mg');
  });
});

describe('groups', () => {
  it('covers the full panel, not just macros', () => {
    expect(nutrientsInGroup('vitamin').length).toBeGreaterThan(15);
    expect(nutrientsInGroup('mineral').length).toBeGreaterThan(10);
    expect(nutrientsInGroup('amino_acid').length).toBe(18);
  });
});

describe('default pins', () => {
  it('every pinned key exists in the registry', () => {
    for (const key of DEFAULT_PINNED_NUTRIENTS) {
      expect(isKnownNutrient(key)).toBe(true);
    }
  });

  it('matches the default list agreed in SETUP.md item 10', () => {
    // Ten from SETUP.md item 10, plus omega-3 and omega-6 (2026-10-06).
    expect(DEFAULT_PINNED_NUTRIENTS).toHaveLength(12);
    expect(DEFAULT_PINNED_NUTRIENTS[0]).toBe('energy_kcal');
  });
});

describe('formatAmount', () => {
  it('rounds calories to whole numbers', () => {
    expect(formatAmount('energy_kcal', 210.4)).toBe('210');
  });

  it('keeps precision where it matters', () => {
    expect(formatAmount('vitamin_b12_ug', 2.437)).toBe('2.44');
  });

  it('falls back to one decimal for an unknown key', () => {
    expect(formatAmount('unobtainium_mg', 1.26)).toBe('1.3');
  });
});
