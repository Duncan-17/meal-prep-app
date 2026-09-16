import { describe, expect, it } from 'vitest';

import {
  TARGET_TOLERANCE,
  describeGoal,
  fromDisplayWeight,
  hasCustomWeekly,
  kgToLb,
  lbToKg,
  observedWeeklyChange,
  progressFor,
  smoothedWeight,
  toDisplayWeight,
  weeklyAmount,
  weeklyProgressFor,
  weightOutlook,
  type NutrientTarget,
  type WeightEntry,
} from '@/domain/plan';
import { addDays, dayDifference } from '@/domain/dates';

const min = (amount: number): NutrientTarget => ({
  key: 'protein_g',
  amount,
  direction: 'min',
  isDefault: false,
});
const max = (amount: number): NutrientTarget => ({
  key: 'sodium_mg',
  amount,
  direction: 'max',
  isDefault: false,
});
const aim = (amount: number): NutrientTarget => ({
  key: 'energy_kcal',
  amount,
  direction: 'target',
  isDefault: false,
});

describe('weekly amounts', () => {
  it('defaults to seven days', () => {
    expect(weeklyAmount(min(150))).toBe(1050);
  });

  it('uses an explicit weekly figure when set', () => {
    expect(weeklyAmount({ ...min(150), weeklyAmount: 900 })).toBe(900);
  });

  it('knows which one it used', () => {
    expect(hasCustomWeekly(min(150))).toBe(false);
    expect(hasCustomWeekly({ ...min(150), weeklyAmount: 900 })).toBe(true);
  });
});

describe('progress direction', () => {
  // The point of directions: hitting 100% of sodium is not an achievement.
  it('treats a minimum as met once reached', () => {
    expect(progressFor(150, min(150)).status).toBe('met');
    expect(progressFor(200, min(150)).status).toBe('met');
    expect(progressFor(120, min(150)).status).toBe('under');
  });

  it('treats a limit as fine until exceeded', () => {
    expect(progressFor(1000, max(2300)).status).toBe('met');
    expect(progressFor(2300, max(2300)).status).toBe('met');
    expect(progressFor(2400, max(2300)).status).toBe('over');
  });

  it('never calls a low sodium reading "under"', () => {
    // Would be the bug: rendering a limit like a goal to chase.
    expect(progressFor(200, max(2300)).status).not.toBe('under');
  });

  it('gives an aim-for target a tolerance band either side', () => {
    expect(progressFor(2500, aim(2500)).status).toBe('met');
    expect(progressFor(2400, aim(2500)).status).toBe('met');
    expect(progressFor(2000, aim(2500)).status).toBe('under');
    expect(progressFor(3000, aim(2500)).status).toBe('over');
  });

  it('uses the documented tolerance', () => {
    const justInside = 2500 * (1 + TARGET_TOLERANCE - 0.001);
    const justOutside = 2500 * (1 + TARGET_TOLERANCE + 0.001);
    expect(progressFor(justInside, aim(2500)).status).toBe('met');
    expect(progressFor(justOutside, aim(2500)).status).toBe('over');
  });

  it('reports the raw fraction regardless of status', () => {
    expect(progressFor(75, min(150)).fraction).toBeCloseTo(0.5, 10);
  });

  it('does not divide by a zero target', () => {
    expect(progressFor(10, min(0))).toEqual({ fraction: 0, status: 'met' });
  });
});

describe('weeklyProgressFor', () => {
  it('measures against the weekly figure', () => {
    expect(weeklyProgressFor(1050, min(150)).status).toBe('met');
    expect(weeklyProgressFor(700, min(150)).status).toBe('under');
  });

  it('respects a custom weekly goal', () => {
    const target = { ...min(150), weeklyAmount: 700 };
    expect(weeklyProgressFor(700, target).status).toBe('met');
  });
});

describe('describeGoal', () => {
  it('says which direction the goal points', () => {
    expect(describeGoal(min(150))).toContain('at least');
    expect(describeGoal(max(2300))).toContain('at most');
    expect(describeGoal(aim(2500))).toContain('about');
  });

  it('mentions when the weekly figure was set by hand', () => {
    expect(describeGoal({ ...min(150), weeklyAmount: 900 })).toContain('set separately');
  });
});

describe('weight units', () => {
  it('round-trips kg and lb', () => {
    expect(lbToKg(kgToLb(80))).toBeCloseTo(80, 10);
  });

  it('converts for display without changing what is stored', () => {
    expect(toDisplayWeight(80, 'kg')).toBe(80);
    expect(toDisplayWeight(80, 'lb')).toBeCloseTo(176.37, 2);
    expect(fromDisplayWeight(176.37, 'lb')).toBeCloseTo(80, 2);
  });
});

describe('smoothedWeight', () => {
  const entries: WeightEntry[] = [
    { date: '2026-09-10', kg: 81, loggedAt: 0 },
    { date: '2026-09-11', kg: 80, loggedAt: 0 },
    { date: '2026-09-12', kg: 82, loggedAt: 0 },
  ];

  it('averages recent readings rather than trusting one', () => {
    expect(smoothedWeight(entries)).toBeCloseTo(81, 10);
  });

  it('honours the window', () => {
    // Newest two: 82 and 80.
    expect(smoothedWeight(entries, 2)).toBeCloseTo(81, 10);
  });

  it('returns null with nothing to average', () => {
    expect(smoothedWeight([])).toBeNull();
  });
});

describe('observedWeeklyChange', () => {
  it('reports the real rate between first and last reading', () => {
    const entries: WeightEntry[] = [
      { date: '2026-09-01', kg: 82, loggedAt: 0 },
      { date: '2026-09-15', kg: 81, loggedAt: 0 },
    ];
    // −1 kg over 14 days = −0.5 kg/week.
    expect(observedWeeklyChange(entries, dayDifference)).toBeCloseTo(-0.5, 10);
  });

  it('needs at least two readings', () => {
    expect(
      observedWeeklyChange([{ date: '2026-09-01', kg: 82, loggedAt: 0 }], dayDifference),
    ).toBeNull();
    expect(observedWeeklyChange([], dayDifference)).toBeNull();
  });

  it('returns null when every reading is the same day', () => {
    const entries: WeightEntry[] = [
      { date: '2026-09-01', kg: 82, loggedAt: 0 },
      { date: '2026-09-01', kg: 81, loggedAt: 0 },
    ];
    expect(observedWeeklyChange(entries, dayDifference)).toBeNull();
  });
});

describe('weightOutlook', () => {
  it('projects an arrival date at the planned rate', () => {
    const outlook = weightOutlook(
      85,
      { targetKg: 80, weeklyChangeKg: -0.5 },
      '2026-09-15',
      addDays,
    );
    expect(outlook.remainingKg).toBe(-5);
    expect(outlook.weeksRemaining).toBe(10);
    expect(outlook.projectedDate).toBe('2026-11-24');
  });

  it('refuses to project when the rate points the wrong way', () => {
    // Wanting to lose but planning to gain never arrives.
    const outlook = weightOutlook(
      85,
      { targetKg: 80, weeklyChangeKg: 0.25 },
      '2026-09-15',
      addDays,
    );
    expect(outlook.weeksRemaining).toBeNull();
    expect(outlook.projectedDate).toBeNull();
  });

  it('refuses to project at a zero rate rather than claiming infinity', () => {
    const outlook = weightOutlook(85, { targetKg: 80, weeklyChangeKg: 0 }, '2026-09-15', addDays);
    expect(outlook.weeksRemaining).toBeNull();
  });

  it('handles gaining as readily as losing', () => {
    const outlook = weightOutlook(
      70,
      { targetKg: 75, weeklyChangeKg: 0.25 },
      '2026-09-15',
      addDays,
    );
    expect(outlook.remainingKg).toBe(5);
    expect(outlook.weeksRemaining).toBe(20);
  });

  it('is inert with no goal set', () => {
    const outlook = weightOutlook(85, { weeklyChangeKg: -0.5 }, '2026-09-15', addDays);
    expect(outlook.weeksRemaining).toBeNull();
    expect(outlook.projectedDate).toBeNull();
  });
});
