import { describe, expect, it } from 'vitest';

import {
  canConsume,
  fractionRemaining,
  gramsForQuantity,
  nutritionForQuantity,
  perUnitForActualYield,
  percentOfRemaining,
  quantityFromPercentOfRemaining,
  remainingAfter,
  remainingAfterRestore,
} from '@/domain/portions';

describe('quantityFromPercentOfRemaining', () => {
  it('takes the percentage of what is left, not of the original batch', () => {
    // Locked decision PLAN.md §1.2b.
    expect(quantityFromPercentOfRemaining(2000, 50)).toBe(1000);
  });

  it('compounds: eating half twice leaves a quarter, not nothing', () => {
    const start = 2000;
    const first = quantityFromPercentOfRemaining(start, 50);
    const afterFirst = remainingAfter(start, first);
    const second = quantityFromPercentOfRemaining(afterFirst, 50);
    const afterSecond = remainingAfter(afterFirst, second);

    expect(afterFirst).toBe(1000);
    expect(afterSecond).toBe(500);
  });

  it('clamps out-of-range percentages', () => {
    expect(quantityFromPercentOfRemaining(1000, 150)).toBe(1000);
    expect(quantityFromPercentOfRemaining(1000, -20)).toBe(0);
  });

  it('never returns a negative quantity from negative stock', () => {
    expect(quantityFromPercentOfRemaining(-500, 50)).toBe(0);
  });
});

describe('percentOfRemaining', () => {
  it('inverts quantityFromPercentOfRemaining', () => {
    expect(percentOfRemaining(2000, 500)).toBe(25);
  });

  it('returns 0 when there is nothing left, rather than dividing by zero', () => {
    expect(percentOfRemaining(0, 100)).toBe(0);
  });

  it('clamps above 100', () => {
    expect(percentOfRemaining(100, 500)).toBe(100);
  });
});

describe('remainingAfter', () => {
  it('subtracts what was eaten', () => {
    expect(remainingAfter(6, 2)).toBe(4);
  });

  it('floors at zero — you cannot eat more than is there', () => {
    expect(remainingAfter(2, 5)).toBe(0);
  });
});

describe('remainingAfterRestore', () => {
  it('gives stock back when a log is deleted', () => {
    expect(remainingAfterRestore(4, 2, 6)).toBe(6);
  });

  it('never restores past the original yield', () => {
    expect(remainingAfterRestore(5, 4, 6)).toBe(6);
  });
});

describe('fractionRemaining', () => {
  it('reports the bulk progress fraction', () => {
    expect(fractionRemaining({ remaining: 1900, initialQuantity: 3000 })).toBeCloseTo(0.6333, 3);
  });

  it('clamps to 0..1', () => {
    expect(fractionRemaining({ remaining: -5, initialQuantity: 100 })).toBe(0);
    expect(fractionRemaining({ remaining: 150, initialQuantity: 100 })).toBe(1);
  });

  it('returns 0 for a zero yield instead of NaN', () => {
    expect(fractionRemaining({ remaining: 0, initialQuantity: 0 })).toBe(0);
  });
});

describe('canConsume', () => {
  it('allows exactly the remaining amount', () => {
    expect(canConsume(4, 4)).toBe(true);
  });

  it('rejects more than remains', () => {
    expect(canConsume(4, 4.5)).toBe(false);
  });

  it('rejects a zero or negative request', () => {
    expect(canConsume(4, 0)).toBe(false);
    expect(canConsume(4, -1)).toBe(false);
  });

  it('tolerates float drift so 0.1 × 3 still clears a stock of 0.3', () => {
    const remaining = 0.1 + 0.1 + 0.1; // 0.30000000000000004
    expect(canConsume(0.3, remaining)).toBe(true);
  });
});

describe('discrete and bulk share one arithmetic path', () => {
  // PLAN.md §3a — portionStyle never appears in this math.
  it('gives the same answer for a serving as for a gram', () => {
    const discretePerUnit = { energy_kcal: 210 };
    const bulkPerGram = { energy_kcal: 1.2 };

    expect(nutritionForQuantity(discretePerUnit, 2).energy_kcal).toBe(420);
    expect(nutritionForQuantity(bulkPerGram, 350).energy_kcal).toBeCloseTo(420, 10);
  });

  it('scales grams alongside nutrition', () => {
    expect(gramsForQuantity(150, 2)).toBe(300);
  });
});

describe('perUnitForActualYield', () => {
  it('spreads the batch across what actually came out of the pan', () => {
    // Planned 6 servings, got 5. Same total nutrition, bigger servings.
    const perUnit = perUnitForActualYield({ energy_kcal: 1260 }, 5);
    expect(perUnit.energy_kcal).toBe(252);
  });

  it('rejects a zero yield', () => {
    expect(() => perUnitForActualYield({ energy_kcal: 100 }, 0)).toThrow(/must be > 0/);
  });
});
