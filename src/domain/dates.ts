/**
 * Calendar days as local dates.
 *
 * Everything the user schedules or logs is a **local calendar day**, stored as
 * a `'YYYY-MM-DD'` string — never a timestamp. A timestamp would mean a meal
 * logged at 11pm could land on the wrong day after a timezone change, and a
 * week boundary could shift under you.
 *
 * The trap this file exists to avoid: `new Date('2026-09-15')` parses as
 * **UTC midnight**, which is 8pm on the 14th in New York. Every conversion
 * here goes through local date components instead, and `dates.test.ts` pins
 * that behaviour.
 */

export type DayKey = string;

const KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDayKey(value: string): boolean {
  if (!KEY_PATTERN.test(value)) return false;
  // Rejects 2026-02-30, which the pattern alone would accept.
  return toDayKey(fromDayKey(value)) === value;
}

/** Local calendar day for a Date. */
export function toDayKey(date: Date): DayKey {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Local midnight for a day key.
 * Built from components — NOT `new Date(key)`, which would be UTC.
 */
export function fromDayKey(key: DayKey): Date {
  const match = KEY_PATTERN.exec(key);
  if (match === null) return new Date(Number.NaN);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(year, month - 1, day);
}

export function todayKey(now: Date = new Date()): DayKey {
  return toDayKey(now);
}

/** Shift by whole days, crossing months, years and DST correctly. */
export function addDays(key: DayKey, days: number): DayKey {
  const date = fromDayKey(key);
  date.setDate(date.getDate() + days);
  return toDayKey(date);
}

export function dayDifference(from: DayKey, to: DayKey): number {
  const a = fromDayKey(from);
  const b = fromDayKey(to);
  // Compare at noon so a DST shift cannot round the division the wrong way.
  a.setHours(12, 0, 0, 0);
  b.setHours(12, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday, matching `Date.getDay`. */
export type WeekStart = 0 | 1;

export const DEFAULT_WEEK_START: WeekStart = 1; // Monday

export function startOfWeek(key: DayKey, weekStartsOn: WeekStart = DEFAULT_WEEK_START): DayKey {
  const date = fromDayKey(key);
  const shift = (date.getDay() - weekStartsOn + 7) % 7;
  return addDays(key, -shift);
}

/** The seven day keys of the week containing `key`. */
export function weekDays(key: DayKey, weekStartsOn: WeekStart = DEFAULT_WEEK_START): DayKey[] {
  const start = startOfWeek(key, weekStartsOn);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function isToday(key: DayKey, now: Date = new Date()): boolean {
  return key === todayKey(now);
}

/** Strictly before today — used for the past-due nudge. */
export function isPast(key: DayKey, now: Date = new Date()): boolean {
  return dayDifference(todayKey(now), key) < 0;
}

export function isFuture(key: DayKey, now: Date = new Date()): boolean {
  return dayDifference(todayKey(now), key) > 0;
}

// ── Display ─────────────────────────────────────────────────────────────────

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function weekdayShort(key: DayKey): string {
  return WEEKDAY_SHORT[fromDayKey(key).getDay()] ?? '';
}

/** Day of month, unpadded — what goes in a calendar cell. */
export function dayOfMonth(key: DayKey): number {
  return fromDayKey(key).getDate();
}

/** "15 Sep" / "15 Sep 2027" when the year differs from now. */
export function formatDay(key: DayKey, now: Date = new Date()): string {
  const date = fromDayKey(key);
  const month = date.toLocaleDateString(undefined, { month: 'short' });
  const yearPart = date.getFullYear() === now.getFullYear() ? '' : ` ${date.getFullYear()}`;
  return `${date.getDate()} ${month}${yearPart}`;
}

/** A week's heading: "8 – 14 Sep" or "29 Sep – 5 Oct". */
export function formatWeekRange(startKey: DayKey, now: Date = new Date()): string {
  const start = fromDayKey(startKey);
  const end = fromDayKey(addDays(startKey, 6));

  const startMonth = start.toLocaleDateString(undefined, { month: 'short' });
  const endMonth = end.toLocaleDateString(undefined, { month: 'short' });
  const year = end.getFullYear() === now.getFullYear() ? '' : ` ${end.getFullYear()}`;

  if (startMonth === endMonth) {
    return `${start.getDate()} – ${end.getDate()} ${endMonth}${year}`;
  }
  return `${start.getDate()} ${startMonth} – ${end.getDate()} ${endMonth}${year}`;
}

/** "Today", "Tomorrow", "Yesterday", or a date. */
export function relativeDay(key: DayKey, now: Date = new Date()): string {
  const difference = dayDifference(todayKey(now), key);
  if (difference === 0) return 'Today';
  if (difference === 1) return 'Tomorrow';
  if (difference === -1) return 'Yesterday';
  return formatDay(key, now);
}
