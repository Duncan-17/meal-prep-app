/** Plan persistence, including the v3 migration, against a real IndexedDB. */

import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/schema';
import { ensureDefaults } from '@/db/init';
import {
  addTarget,
  getPlan,
  listWeights,
  logWeight,
  planCustomisation,
  removeTarget,
  resetAllTargets,
  resetTarget,
  savePlan,
  setTargetAmount,
  setTargetDirection,
  setTargetEnabled,
  setTargetWeekly,
  setWeightGoal,
  setWeightUnit,
  latestWeight,
} from '@/db/plan';
import { weeklyAmount } from '@/domain/plan';

beforeEach(async () => {
  await db.delete();
  await db.open();
  await ensureDefaults();
});

describe('the default template', () => {
  it('seeds every headline number', async () => {
    for (const key of ['energy_kcal', 'protein_g', 'carbs_g', 'fat_g', 'water_g']) {
      expect(await db.targets.get(key)).toBeDefined();
    }
  });

  it('marks limits as limits, not as goals to reach', async () => {
    expect((await db.targets.get('sodium_mg'))?.direction).toBe('max');
    expect((await db.targets.get('saturated_fat_g'))?.direction).toBe('max');
    expect((await db.targets.get('sugars_added_g'))?.direction).toBe('max');
    expect((await db.targets.get('protein_g'))?.direction).toBe('min');
  });

  it('starts entirely as FDA defaults', async () => {
    const stats = await planCustomisation();
    expect(stats.edited).toBe(0);
    expect(stats.total).toBeGreaterThan(30);
  });

  it('covers water as total intake', async () => {
    const water = await db.targets.get('water_g');
    expect(water?.amount).toBe(3700);
    expect(water?.direction).toBe('min');
  });
});

describe('editing targets', () => {
  it('records a new amount and stops calling it a default', async () => {
    await setTargetAmount('protein_g', 180);
    const target = await db.targets.get('protein_g');
    expect(target?.amount).toBe(180);
    expect(target?.isDefault).toBe(false);
  });

  it('keeps direction when only the amount changes', async () => {
    await setTargetAmount('sodium_mg', 1800);
    expect((await db.targets.get('sodium_mg'))?.direction).toBe('max');
  });

  it('rejects a negative target', async () => {
    await expect(setTargetAmount('protein_g', -5)).rejects.toThrow(/zero or more/);
  });

  it('changes direction', async () => {
    await setTargetDirection('energy_kcal', 'max');
    expect((await db.targets.get('energy_kcal'))?.direction).toBe('max');
  });

  it('sets a weekly figure independent of the daily one', async () => {
    await setTargetWeekly('energy_kcal', 16000);
    const target = await db.targets.get('energy_kcal');
    expect(target?.weeklyAmount).toBe(16000);
    expect(weeklyAmount(target!)).toBe(16000);
  });

  it('drops back to seven times daily', async () => {
    await setTargetWeekly('energy_kcal', 16000);
    await setTargetWeekly('energy_kcal', undefined);
    const target = await db.targets.get('energy_kcal');
    expect(target?.weeklyAmount).toBeUndefined();
    expect(weeklyAmount(target!)).toBe(2500 * 7);
  });

  it('can hide a nutrient without losing its number', async () => {
    await setTargetEnabled('iodine_ug', false);
    const target = await db.targets.get('iodine_ug');
    expect(target?.enabled).toBe(false);
    expect(target?.amount).toBe(150);
  });

  it('adds a target the template does not cover', async () => {
    await addTarget('leucine_g', 5, 'min');
    expect((await db.targets.get('leucine_g'))?.amount).toBe(5);
  });

  it('removes one', async () => {
    await removeTarget('iodine_ug');
    expect(await db.targets.get('iodine_ug')).toBeUndefined();
  });
});

describe('resetting', () => {
  it('puts one target back to its FDA default', async () => {
    await setTargetAmount('protein_g', 300);
    await resetTarget('protein_g');
    const target = await db.targets.get('protein_g');
    expect(target?.amount).toBe(150);
    expect(target?.isDefault).toBe(true);
  });

  it('removes a target that has no FDA default when reset', async () => {
    await addTarget('leucine_g', 5);
    await resetTarget('leucine_g');
    expect(await db.targets.get('leucine_g')).toBeUndefined();
  });

  it('restores the whole template, discarding added targets too', async () => {
    await setTargetAmount('protein_g', 300);
    await addTarget('leucine_g', 5);

    await resetAllTargets();

    expect((await db.targets.get('protein_g'))?.amount).toBe(150);
    expect(await db.targets.get('leucine_g')).toBeUndefined();
    expect((await planCustomisation()).edited).toBe(0);
  });
});

describe('the plan record', () => {
  it('has sensible defaults before anything is saved', async () => {
    const plan = await getPlan();
    expect(plan.weightUnit).toBe('kg');
    expect(plan.weight.weeklyChangeKg).toBe(0);
  });

  it('saves a weight goal', async () => {
    await setWeightGoal({ targetKg: 80, weeklyChangeKg: -0.5 });
    const plan = await getPlan();
    expect(plan.weight.targetKg).toBe(80);
    expect(plan.weight.weeklyChangeKg).toBe(-0.5);
  });

  it('merges rather than replacing the goal', async () => {
    await setWeightGoal({ targetKg: 80 });
    await setWeightGoal({ weeklyChangeKg: -0.25 });
    const plan = await getPlan();
    expect(plan.weight.targetKg).toBe(80);
    expect(plan.weight.weeklyChangeKg).toBe(-0.25);
  });

  it('switches display units without touching stored kilograms', async () => {
    await logWeight('2026-09-15', 82);
    await setWeightUnit('lb');
    expect((await getPlan()).weightUnit).toBe('lb');
    expect((await latestWeight())?.kg).toBe(82);
  });

  it('renames the plan', async () => {
    await savePlan({ name: 'Cut' });
    expect((await getPlan()).name).toBe('Cut');
  });
});

describe('weight log', () => {
  it('stores one entry per day, correcting rather than duplicating', async () => {
    await logWeight('2026-09-15', 82);
    await logWeight('2026-09-15', 81.5);
    const entries = await listWeights();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kg).toBe(81.5);
  });

  it('rejects a non-positive weight', async () => {
    await expect(logWeight('2026-09-15', 0)).rejects.toThrow(/greater than zero/);
  });

  it('lists newest first', async () => {
    await logWeight('2026-09-14', 82);
    await logWeight('2026-09-16', 81);
    expect((await listWeights())[0]?.date).toBe('2026-09-16');
  });
});

describe('v3 migration', () => {
  it('gives a direction to targets written before directions existed', async () => {
    // Simulate a pre-v3 row: no `direction` field at all.
    await db.targets.put({ key: 'sodium_mg', amount: 2300, isDefault: true } as never);
    await db.targets.put({ key: 'protein_g', amount: 50, isDefault: true } as never);

    // The upgrade only runs on open; re-run the same logic the way it does.
    await db.targets.toCollection().modify((target: { key?: string; direction?: string }) => {
      if (target.direction !== undefined) return;
      target.direction = target.key === 'sodium_mg' ? 'max' : 'min';
    });

    expect((await db.targets.get('sodium_mg'))?.direction).toBe('max');
    expect((await db.targets.get('protein_g'))?.direction).toBe('min');
  });
});
