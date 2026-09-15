import { describe, expect, it } from 'vitest';

import {
  addDays,
  dayDifference,
  dayOfMonth,
  formatWeekRange,
  fromDayKey,
  isDayKey,
  isFuture,
  isPast,
  isToday,
  relativeDay,
  startOfWeek,
  toDayKey,
  weekDays,
  weekdayShort,
} from '@/domain/dates';

describe('day keys are LOCAL days', () => {
  // The bug this guards: `new Date('2026-09-15')` is UTC midnight, which is
  // the 14th in any negative-offset timezone. Round-tripping must not shift.
  it('round-trips a local date without shifting', () => {
    const local = new Date(2026, 8, 15, 23, 30);
    expect(toDayKey(local)).toBe('2026-09-15');
    expect(toDayKey(fromDayKey('2026-09-15'))).toBe('2026-09-15');
  });

  it('builds local midnight, not UTC midnight', () => {
    const date = fromDayKey('2026-09-15');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(8);
    expect(date.getDate()).toBe(15);
    expect(date.getHours()).toBe(0);
  });

  it('keeps a late-evening time on its own day', () => {
    expect(toDayKey(new Date(2026, 8, 15, 23, 59, 59))).toBe('2026-09-15');
  });

  it('keeps an early-morning time on its own day', () => {
    expect(toDayKey(new Date(2026, 8, 15, 0, 0, 1))).toBe('2026-09-15');
  });

  it('pads single-digit months and days', () => {
    expect(toDayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('isDayKey', () => {
  it('accepts a well-formed key', () => {
    expect(isDayKey('2026-09-15')).toBe(true);
  });

  it('rejects wrong shapes', () => {
    expect(isDayKey('2026-9-15')).toBe(false);
    expect(isDayKey('15/09/2026')).toBe(false);
    expect(isDayKey('')).toBe(false);
  });

  it('rejects a date that does not exist', () => {
    expect(isDayKey('2026-02-30')).toBe(false);
    expect(isDayKey('2026-13-01')).toBe(false);
  });

  it('accepts a real leap day and rejects a fake one', () => {
    expect(isDayKey('2028-02-29')).toBe(true);
    expect(isDayKey('2027-02-29')).toBe(false);
  });
});

describe('addDays', () => {
  it('moves within a month', () => {
    expect(addDays('2026-09-15', 3)).toBe('2026-09-18');
  });

  it('crosses a month boundary', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
  });

  it('crosses a year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('handles February in a leap year', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });

  it('is reversible', () => {
    expect(addDays(addDays('2026-09-15', 40), -40)).toBe('2026-09-15');
  });
});

describe('dayDifference', () => {
  it('counts forward and backward', () => {
    expect(dayDifference('2026-09-15', '2026-09-18')).toBe(3);
    expect(dayDifference('2026-09-18', '2026-09-15')).toBe(-3);
  });

  it('is zero for the same day', () => {
    expect(dayDifference('2026-09-15', '2026-09-15')).toBe(0);
  });

  it('counts across a DST change as whole days', () => {
    // Spring forward in most of the US/EU falls in this window; the count must
    // stay 7 even though one of those days is 23 hours long.
    expect(dayDifference('2026-03-05', '2026-03-12')).toBe(7);
    expect(dayDifference('2026-10-25', '2026-11-05')).toBe(11);
  });
});

describe('weeks', () => {
  // 2026-09-15 is a Tuesday.
  it('starts the week on Monday by default', () => {
    expect(startOfWeek('2026-09-15')).toBe('2026-09-14');
  });

  it('can start on Sunday', () => {
    expect(startOfWeek('2026-09-15', 0)).toBe('2026-09-13');
  });

  it('leaves a day that is already the start alone', () => {
    expect(startOfWeek('2026-09-14')).toBe('2026-09-14');
  });

  it('returns seven consecutive days', () => {
    const days = weekDays('2026-09-15');
    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2026-09-14');
    expect(days[6]).toBe('2026-09-20');
  });

  it('spans a month boundary correctly', () => {
    const days = weekDays('2026-10-01');
    expect(days[0]).toBe('2026-09-28');
    expect(days[6]).toBe('2026-10-04');
  });
});

describe('relative position', () => {
  const now = new Date(2026, 8, 15, 12, 0);

  it('identifies today', () => {
    expect(isToday('2026-09-15', now)).toBe(true);
    expect(isToday('2026-09-16', now)).toBe(false);
  });

  it('identifies past and future', () => {
    expect(isPast('2026-09-14', now)).toBe(true);
    expect(isPast('2026-09-15', now)).toBe(false); // today is not past
    expect(isFuture('2026-09-16', now)).toBe(true);
    expect(isFuture('2026-09-15', now)).toBe(false);
  });

  it('names nearby days', () => {
    expect(relativeDay('2026-09-15', now)).toBe('Today');
    expect(relativeDay('2026-09-16', now)).toBe('Tomorrow');
    expect(relativeDay('2026-09-14', now)).toBe('Yesterday');
  });

  it('falls back to a date further out', () => {
    expect(relativeDay('2026-09-20', now)).toContain('20');
  });
});

describe('display helpers', () => {
  it('names the weekday', () => {
    expect(weekdayShort('2026-09-14')).toBe('Mon');
    expect(weekdayShort('2026-09-20')).toBe('Sun');
  });

  it('gives the day of month', () => {
    expect(dayOfMonth('2026-09-15')).toBe(15);
  });

  it('formats a week inside one month', () => {
    expect(formatWeekRange('2026-09-14', new Date(2026, 8, 15))).toBe('14 – 20 Sep');
  });

  it('formats a week spanning two months', () => {
    const range = formatWeekRange('2026-09-28', new Date(2026, 8, 15));
    expect(range).toContain('28 Sep');
    expect(range).toContain('4 Oct');
  });

  it('includes the year when it differs from now', () => {
    expect(formatWeekRange('2027-01-04', new Date(2026, 8, 15))).toContain('2027');
  });
});
