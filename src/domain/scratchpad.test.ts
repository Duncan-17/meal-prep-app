import { describe, expect, it } from 'vitest';

import {
  adjustDay,
  averageDay,
  contributors,
  dayTotal,
  moveOne,
  placeOne,
  placedOn,
  unplaced,
  withDays,
  withPortions,
  type CostedItem,
} from '@/domain/scratchpad';
import type { Scratchpad, ScratchpadFood } from '@/domain/types';

/** Twenty eggs, 70 kcal each — the user's own example. */
const eggs: ScratchpadFood = {
  kind: 'food',
  uid: 'eggs',
  label: 'Eggs',
  color: '#e8912e',
  source: 'usda',
  sourceId: '1',
  nutritionPer100g: { energy_kcal: 140 },
  portionGrams: { each: 50 },
  quantity: 20,
  unit: 'each',
  portions: 20,
  placed: {},
};
const eggsCosted = (item = eggs): CostedItem => ({
  item,
  total: {
    nutrients: { energy_kcal: 1400, protein_g: 120 },
    coverage: { energy_kcal: 1, protein_g: 1 },
    totalGrams: 1000,
  },
});

describe('placing portions', () => {
  it('places one from the tray, and stops when the tray is empty', () => {
    let item: ScratchpadFood = { ...eggs, portions: 2 };
    item = placeOne(item, 0);
    item = placeOne(item, 0);
    expect(placedOn(item, 0)).toBe(2);
    expect(unplaced(item)).toBe(0);
    expect(placeOne(item, 1)).toBe(item);
  });

  it('adjusts a day up and down, clamped at zero and at what is left', () => {
    let item = adjustDay(eggs, 0, 10); // "eat 10 eggs on Monday"
    expect(placedOn(item, 0)).toBe(10);
    item = adjustDay(item, 2, 50);
    expect(placedOn(item, 2)).toBe(10);
    item = adjustDay(item, 0, -15);
    expect(placedOn(item, 0)).toBe(0);
    expect('0' in item.placed).toBe(false);
  });

  it('moves one portion between days', () => {
    const item = moveOne(adjustDay(eggs, 0, 3), 0, 4);
    expect(placedOn(item, 0)).toBe(2);
    expect(placedOn(item, 4)).toBe(1);
  });

  it('ignores a move from a day with nothing on it', () => {
    expect(moveOne(eggs, 0, 1)).toBe(eggs);
  });

  it('never mutates the item it was given', () => {
    const before = JSON.stringify(eggs);
    placeOne(eggs, 0);
    adjustDay(eggs, 0, 5);
    expect(JSON.stringify(eggs)).toBe(before);
  });
});

describe('reshaping', () => {
  it('splitting into fewer portions takes back from the last days first', () => {
    const item = withPortions({ ...eggs, placed: { '0': 3, '5': 3 } }, 4);
    expect(item.portions).toBe(4);
    expect(item.placed).toEqual({ '0': 3, '5': 1 });
  });

  it('shortening the period sends food on dropped days back to the tray', () => {
    const pad: Scratchpad = {
      id: 1,
      name: 'Month',
      days: 30,
      items: [{ ...eggs, placed: { '2': 4, '20': 6 } }],
      createdAt: 0,
      updatedAt: 0,
    };
    const week = withDays(pad, 7);
    expect(week.days).toBe(7);
    expect(week.items[0]?.placed).toEqual({ '2': 4 });
    expect(unplaced(week.items[0]!)).toBe(16);
  });
});

describe('nutrition views', () => {
  it('averages the whole haul over the period, placed or not', () => {
    const average = averageDay([eggsCosted()], 7);
    expect(average.nutrients.energy_kcal).toBeCloseTo(200);
    expect(average.coverage.energy_kcal).toBe(1);
  });

  it('counts only what was placed on a day', () => {
    const item = adjustDay(eggs, 0, 10); // 10 eggs Monday
    const monday = dayTotal([eggsCosted(item)], 0);
    expect(monday.nutrients.energy_kcal).toBeCloseTo(700);
    expect(dayTotal([eggsCosted(item)], 1).nutrients).toEqual({});
  });

  it('splits each view by item, for the segmented meters', () => {
    const item = adjustDay(eggs, 0, 2);
    expect(contributors([eggsCosted(item)], 7, 0)[0]).toMatchObject({
      label: 'Eggs',
      color: '#e8912e',
      nutrients: { energy_kcal: 140 },
    });
    expect(contributors([eggsCosted(item)], 7)[0]?.nutrients.energy_kcal).toBeCloseTo(200);
  });
});
