import { describe, expect, it } from 'vitest';

import {
  coverageFor,
  coverageNote,
  hasData,
  isFullyCovered,
  isLowCoverage,
  missingKeys,
  weakestCoverage,
} from '@/domain/coverage';
import { aggregate } from '@/domain/nutrients';

const dayWithGaps = aggregate([
  { nutrients: { energy_kcal: 130, protein_g: 2.7 }, grams: 200 },
  { nutrients: { energy_kcal: 250, protein_g: 26, vitamin_b12_ug: 2.4 }, grams: 100 },
]);

describe('coverageFor', () => {
  it('returns the fraction that had data', () => {
    expect(coverageFor(dayWithGaps.coverage, 'vitamin_b12_ug')).toBeCloseTo(1 / 3, 10);
  });

  it('returns 0 for a nutrient nothing knew about', () => {
    expect(coverageFor(dayWithGaps.coverage, 'vitamin_d_ug')).toBe(0);
  });
});

describe('isFullyCovered', () => {
  it('is true when every gram carried data', () => {
    expect(isFullyCovered(dayWithGaps.coverage, 'energy_kcal')).toBe(true);
  });

  it('is false for partial data', () => {
    expect(isFullyCovered(dayWithGaps.coverage, 'vitamin_b12_ug')).toBe(false);
  });

  it('tolerates float drift from repeated aggregation', () => {
    expect(isFullyCovered({ iron_mg: 0.99999 }, 'iron_mg')).toBe(true);
  });
});

describe('isLowCoverage', () => {
  it('flags a total that is missing enough data to mislead', () => {
    expect(isLowCoverage(dayWithGaps.coverage, 'vitamin_b12_ug')).toBe(true);
  });

  it('does not flag a well-covered total', () => {
    expect(isLowCoverage(dayWithGaps.coverage, 'protein_g')).toBe(false);
  });
});

describe('hasData', () => {
  it('distinguishes an unknown nutrient from a measured zero', () => {
    const withZero = aggregate([{ nutrients: { trans_fat_g: 0 }, grams: 100 }]);
    expect(hasData(withZero, 'trans_fat_g')).toBe(true);
    expect(hasData(withZero, 'vitamin_d_ug')).toBe(false);
  });
});

describe('coverageNote', () => {
  it('states the fact rather than warning', () => {
    expect(coverageNote({ vitamin_b12_ug: 0.68 }, 'vitamin_b12_ug')).toBe('68% of intake had data');
  });

  it('is silent when the number stands on its own', () => {
    expect(coverageNote({ energy_kcal: 1 }, 'energy_kcal')).toBeNull();
  });

  it('reports 0% rather than nothing for a wholly unknown nutrient', () => {
    expect(coverageNote({}, 'vitamin_d_ug')).toBe('0% of intake had data');
  });
});

describe('missingKeys', () => {
  it('lists the sparse tail that Day Detail hides by default', () => {
    const missing = missingKeys(dayWithGaps, ['energy_kcal', 'vitamin_d_ug', 'iodine_ug']);
    expect(missing).toEqual(['vitamin_d_ug', 'iodine_ug']);
  });
});

describe('weakestCoverage', () => {
  it('finds the least-known nutrient in a panel', () => {
    expect(weakestCoverage(dayWithGaps.coverage, ['energy_kcal', 'vitamin_b12_ug'])).toBeCloseTo(
      1 / 3,
      10,
    );
  });

  it('returns 1 for an empty panel — nothing to doubt', () => {
    expect(weakestCoverage(dayWithGaps.coverage, [])).toBe(1);
  });
});
