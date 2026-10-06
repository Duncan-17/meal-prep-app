import { describe, expect, it } from 'vitest';

import {
  addNutrients,
  aggregate,
  combineAggregates,
  contributionFromUnits,
  emptyAggregate,
  nutritionForGrams,
  perUnitNutrition,
  pickNutrients,
  scaleNutrients,
  withDerivedSums,
} from '@/domain/nutrients';
import type { NutrientContribution } from '@/domain/types';

describe('scaleNutrients', () => {
  it('scales every present nutrient', () => {
    const result = scaleNutrients({ energy_kcal: 210, protein_g: 28 }, 2);
    expect(result).toEqual({ energy_kcal: 420, protein_g: 56 });
  });

  it('leaves absent keys absent rather than inventing zeros', () => {
    const result = scaleNutrients({ energy_kcal: 210 }, 3);
    expect('vitamin_b12_ug' in result).toBe(false);
  });

  it('scaling by zero keeps the key — we still know the value, it is just 0', () => {
    const result = scaleNutrients({ protein_g: 28 }, 0);
    expect(result).toEqual({ protein_g: 0 });
    expect('protein_g' in result).toBe(true);
  });

  it('does not mutate its input', () => {
    const input = { protein_g: 28 };
    scaleNutrients(input, 5);
    expect(input).toEqual({ protein_g: 28 });
  });
});

describe('perUnitNutrition', () => {
  it('divides the base batch across its yield', () => {
    const perUnit = perUnitNutrition({ energy_kcal: 1260, protein_g: 168 }, 6);
    expect(perUnit).toEqual({ energy_kcal: 210, protein_g: 28 });
  });

  it('uses the same path for a bulk component measured in grams', () => {
    // 3000 g of chili at 3600 kcal → 1.2 kcal per gram. No separate branch.
    const perGram = perUnitNutrition({ energy_kcal: 3600 }, 3000);
    expect(perGram.energy_kcal).toBeCloseTo(1.2, 10);
  });

  it('rejects a zero or negative yield instead of returning Infinity', () => {
    expect(() => perUnitNutrition({ energy_kcal: 100 }, 0)).toThrow(/must be > 0/);
    expect(() => perUnitNutrition({ energy_kcal: 100 }, -3)).toThrow(/must be > 0/);
  });
});

describe('addNutrients', () => {
  it('sums shared keys and keeps unique ones', () => {
    const result = addNutrients({ energy_kcal: 100, iron_mg: 1 }, { energy_kcal: 50, zinc_mg: 2 });
    expect(result).toEqual({ energy_kcal: 150, iron_mg: 1, zinc_mg: 2 });
  });

  it('treats an explicit zero as a value, not as absent', () => {
    const result = addNutrients({ trans_fat_g: 0 }, { trans_fat_g: 0 });
    expect(result.trans_fat_g).toBe(0);
    expect('trans_fat_g' in result).toBe(true);
  });
});

describe('pickNutrients', () => {
  it('keeps only requested keys that have data', () => {
    const result = pickNutrients({ energy_kcal: 210, protein_g: 28 }, [
      'energy_kcal',
      'vitamin_b12_ug',
    ]);
    expect(result).toEqual({ energy_kcal: 210 });
  });
});

describe('aggregate — the sparse-data correctness case', () => {
  // PLAN.md §3c: rice has no B12 value; it does not have zero B12.
  const rice: NutrientContribution = {
    nutrients: { energy_kcal: 130, protein_g: 2.7 },
    grams: 100,
  };
  const beef: NutrientContribution = {
    nutrients: { energy_kcal: 250, protein_g: 26, vitamin_b12_ug: 2.4 },
    grams: 100,
  };

  it('totals the values that exist', () => {
    const result = aggregate([rice, beef]);
    expect(result.nutrients.energy_kcal).toBe(380);
    expect(result.nutrients.vitamin_b12_ug).toBe(2.4);
  });

  it('reports partial coverage for the nutrient only one food knew about', () => {
    const result = aggregate([rice, beef]);
    expect(result.coverage.vitamin_b12_ug).toBeCloseTo(0.5, 10);
  });

  it('reports full coverage for nutrients both foods carried', () => {
    const result = aggregate([rice, beef]);
    expect(result.coverage.energy_kcal).toBe(1);
    expect(result.coverage.protein_g).toBe(1);
  });

  it('weights coverage by grams, not by item count', () => {
    // 300 g of rice against 100 g of beef: B12 is known for a quarter of it.
    const result = aggregate([{ ...rice, grams: 300 }, beef]);
    expect(result.coverage.vitamin_b12_ug).toBeCloseTo(0.25, 10);
  });

  it('tracks total weight including food that contributed no data', () => {
    const result = aggregate([rice, beef]);
    expect(result.totalGrams).toBe(200);
  });

  it('never reports a nutrient nothing knew about', () => {
    const result = aggregate([rice, beef]);
    expect('vitamin_d_ug' in result.nutrients).toBe(false);
    expect('vitamin_d_ug' in result.coverage).toBe(false);
  });

  it('counts an explicit zero as data, not as missing', () => {
    const measured: NutrientContribution = { nutrients: { trans_fat_g: 0 }, grams: 100 };
    const unmeasured: NutrientContribution = { nutrients: { energy_kcal: 50 }, grams: 100 };
    const result = aggregate([measured, unmeasured]);
    expect(result.nutrients.trans_fat_g).toBe(0);
    expect(result.coverage.trans_fat_g).toBeCloseTo(0.5, 10);
  });

  it('returns an empty aggregate for no contributions', () => {
    expect(aggregate([])).toEqual(emptyAggregate());
  });
});

describe('aggregate — propagating prior coverage', () => {
  it('carries partial knowledge upward instead of laundering it', () => {
    // A component already known to be half-covered for B12, eaten alongside
    // an equal weight of something fully known.
    const partial: NutrientContribution = {
      nutrients: { vitamin_b12_ug: 2 },
      grams: 100,
      coverage: { vitamin_b12_ug: 0.5 },
    };
    const complete: NutrientContribution = {
      nutrients: { vitamin_b12_ug: 3 },
      grams: 100,
    };

    const result = aggregate([partial, complete]);
    expect(result.nutrients.vitamin_b12_ug).toBe(5);
    // 50 g covered + 100 g covered, out of 200 g.
    expect(result.coverage.vitamin_b12_ug).toBeCloseTo(0.75, 10);
  });

  it('cannot exceed full coverage', () => {
    const result = aggregate([{ nutrients: { iron_mg: 1 }, grams: 100, coverage: { iron_mg: 5 } }]);
    expect(result.coverage.iron_mg).toBe(1);
  });
});

describe('aggregate — degenerate inputs', () => {
  it('reports full coverage when nothing has weight', () => {
    const result = aggregate([{ nutrients: { energy_kcal: 10 }, grams: 0 }]);
    expect(result.nutrients.energy_kcal).toBe(10);
    expect(result.coverage.energy_kcal).toBe(1);
    expect(result.totalGrams).toBe(0);
  });

  it('treats a NaN weight as zero rather than poisoning the total', () => {
    const result = aggregate([
      { nutrients: { energy_kcal: 10 }, grams: Number.NaN },
      { nutrients: { energy_kcal: 20 }, grams: 100 },
    ]);
    expect(result.totalGrams).toBe(100);
    expect(Number.isFinite(result.coverage.energy_kcal ?? Number.NaN)).toBe(true);
  });
});

describe('combineAggregates', () => {
  const meals: NutrientContribution[] = [
    { nutrients: { energy_kcal: 400, vitamin_b12_ug: 1.2 }, grams: 300 },
    { nutrients: { energy_kcal: 650 }, grams: 450 },
    { nutrients: { energy_kcal: 300, vitamin_b12_ug: 0.8 }, grams: 250 },
  ];

  it('is associative — a week totalled at once equals days totalled separately', () => {
    const allAtOnce = aggregate(meals);

    const firstTwo = aggregate(meals.slice(0, 2));
    const lastOne = aggregate(meals.slice(2));
    const dayByDay = combineAggregates([firstTwo, lastOne]);

    expect(dayByDay.totalGrams).toBeCloseTo(allAtOnce.totalGrams, 10);
    expect(dayByDay.nutrients.energy_kcal).toBeCloseTo(allAtOnce.nutrients.energy_kcal ?? 0, 10);
    expect(dayByDay.nutrients.vitamin_b12_ug).toBeCloseTo(
      allAtOnce.nutrients.vitamin_b12_ug ?? 0,
      10,
    );
    expect(dayByDay.coverage.vitamin_b12_ug).toBeCloseTo(
      allAtOnce.coverage.vitamin_b12_ug ?? 0,
      10,
    );
  });

  it('handles an empty set', () => {
    expect(combineAggregates([])).toEqual(emptyAggregate());
  });
});

describe('contributionFromUnits', () => {
  it('scales nutrition and weight together', () => {
    const contribution = contributionFromUnits({ energy_kcal: 210 }, 2, 150);
    expect(contribution.nutrients.energy_kcal).toBe(420);
    expect(contribution.grams).toBe(300);
  });

  it('omits coverage entirely when none is given', () => {
    const contribution = contributionFromUnits({ energy_kcal: 210 }, 1, 150);
    expect('coverage' in contribution).toBe(false);
  });

  it('attaches coverage when given', () => {
    const contribution = contributionFromUnits({ energy_kcal: 210 }, 1, 150, {
      energy_kcal: 0.5,
    });
    expect(contribution.coverage).toEqual({ energy_kcal: 0.5 });
  });
});

describe('nutritionForGrams', () => {
  it('scales a per-100g map', () => {
    expect(nutritionForGrams({ protein_g: 20 }, 150)).toEqual({ protein_g: 30 });
  });

  it('handles a sub-100g weight', () => {
    expect(nutritionForGrams({ protein_g: 20 }, 50)).toEqual({ protein_g: 10 });
  });
});

describe('withDerivedSums', () => {
  const specs = { omega3_total_g: ['ala', 'epa', 'dha'] };

  it('sums the parts that are present', () => {
    const out = withDerivedSums(
      { nutrients: { ala: 1.2, epa: 0.3 }, coverage: { ala: 1, epa: 1 }, totalGrams: 200 },
      specs,
    );
    expect(out.nutrients.omega3_total_g).toBeCloseTo(1.5);
    expect(out.coverage.omega3_total_g).toBe(1);
  });

  it('leaves the total ABSENT when no part has data — not zero', () => {
    const out = withDerivedSums(
      { nutrients: { protein_g: 30 }, coverage: { protein_g: 1 }, totalGrams: 200 },
      specs,
    );
    expect('omega3_total_g' in out.nutrients).toBe(false);
    expect('omega3_total_g' in out.coverage).toBe(false);
  });

  it('reports the best part coverage, a lower bound on grams with any data', () => {
    // Walnuts reported ALA only; salmon reported all three.
    const day = aggregate([
      { nutrients: { ala: 2.5 }, grams: 30 },
      { nutrients: { ala: 0.1, epa: 0.4, dha: 1.1 }, grams: 120 },
    ]);
    const out = withDerivedSums(day, specs);
    expect(out.nutrients.omega3_total_g).toBeCloseTo(4.1);
    expect(out.coverage.omega3_total_g).toBe(1);
    expect(out.coverage.epa).toBeCloseTo(0.8);
  });

  it('recomputes from the parts, overwriting a stale total', () => {
    const out = withDerivedSums(
      {
        nutrients: { ala: 1, omega3_total_g: 99 },
        coverage: { ala: 0.5, omega3_total_g: 1 },
        totalGrams: 100,
      },
      specs,
    );
    expect(out.nutrients.omega3_total_g).toBe(1);
    expect(out.coverage.omega3_total_g).toBe(0.5);
  });

  it('does not mutate its input', () => {
    const input = { nutrients: { ala: 1 }, coverage: { ala: 1 }, totalGrams: 10 };
    withDerivedSums(input, specs);
    expect(input.nutrients).toEqual({ ala: 1 });
  });
});
