import { describe, expect, it } from 'vitest';

import {
  addMonths,
  formatMonth,
  isSameMonth,
  monthGrid,
  startOfMonth,
  weekdayHeadings,
} from '@/domain/dates';

describe('startOfMonth', () => {
  it('snaps to the first', () => {
    expect(startOfMonth('2026-09-17')).toBe('2026-09-01');
    expect(startOfMonth('2026-09-01')).toBe('2026-09-01');
  });
});

describe('addMonths', () => {
  it('steps forward and back', () => {
    expect(addMonths('2026-09-17', 1)).toBe('2026-10-17');
    expect(addMonths('2026-09-17', -1)).toBe('2026-08-17');
  });

  it('crosses a year', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2027-01-15', -1)).toBe('2026-12-15');
  });

  /**
   * The bug this exists for: `new Date(2026, 0, 31)` plus one month is 3 March,
   * because February has no 31st and JavaScript rolls over silently. Paging a
   * calendar must never skip a month.
   */
  it('clamps to the last real day instead of rolling over', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-05-31', 1)).toBe('2026-06-30');
  });

  it('clamps into a leap February', () => {
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  });

  it('never skips a month when paged repeatedly from a 31st', () => {
    let key = '2026-01-31';
    const months: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      key = addMonths(key, 1);
      months.push(key.slice(0, 7));
    }
    expect(months).toEqual(['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']);
  });
});

describe('isSameMonth', () => {
  it('compares year and month only', () => {
    expect(isSameMonth('2026-09-01', '2026-09-30')).toBe(true);
    expect(isSameMonth('2026-09-30', '2026-10-01')).toBe(false);
    expect(isSameMonth('2026-09-15', '2027-09-15')).toBe(false);
  });
});

describe('monthGrid', () => {
  it('always returns whole weeks', () => {
    for (const key of ['2026-09-01', '2026-02-01', '2028-02-01', '2026-11-01']) {
      expect(monthGrid(key).length % 7).toBe(0);
    }
  });

  it('starts on the week start and covers the whole month', () => {
    const grid = monthGrid('2026-09-15');
    // September 2026 starts on a Tuesday, so a Monday-start grid opens 31 Aug.
    expect(grid[0]).toBe('2026-08-31');
    expect(grid).toContain('2026-09-01');
    expect(grid).toContain('2026-09-30');
  });

  it('pads with neighbouring days that the UI dims', () => {
    const grid = monthGrid('2026-09-15');
    const outside = grid.filter((day) => !isSameMonth(day, '2026-09-01'));
    expect(outside.length).toBeGreaterThan(0);
    expect(outside.every((day) => day < '2026-09-01' || day > '2026-09-30')).toBe(true);
  });

  it('handles a February that fits exactly', () => {
    // February 2027 starts on a Monday and has 28 days — exactly four weeks.
    const grid = monthGrid('2027-02-01');
    expect(grid).toHaveLength(28);
    expect(grid[0]).toBe('2027-02-01');
    expect(grid[27]).toBe('2027-02-28');
  });

  it('is contiguous with no gaps or repeats', () => {
    const grid = monthGrid('2026-09-15');
    expect(new Set(grid).size).toBe(grid.length);
  });
});

describe('display', () => {
  it('names the month and year', () => {
    expect(formatMonth('2026-09-15')).toContain('2026');
  });

  it('heads the columns in week order', () => {
    expect(weekdayHeadings(1)[0]).toBe('Mon');
    expect(weekdayHeadings(1)[6]).toBe('Sun');
    expect(weekdayHeadings(0)[0]).toBe('Sun');
  });
});
