/**
 * Scheduled cooking.
 *
 * A Batch **snapshots** its Component at the moment it is scheduled
 * (PLAN.md §3d). Editing the recipe next month must not rewrite what was
 * planned or cooked — so name, colour, yield and nutrition are all copied in
 * rather than looked up later.
 *
 * `scale` stays separate from the snapshot: the snapshot describes one base
 * batch, and `scale` says how many of them. Multiplying at schedule time would
 * lose the distinction between "the recipe" and "how much I made".
 */

import { db } from '@/db/schema';
import { scaleNutrients } from '@/domain/nutrients';
import type { Batch, BatchStatus, Component, NutrientMap } from '@/domain/types';
import type { DayKey } from '@/domain/dates';

export async function scheduleBatch(
  component: Component,
  scheduledFor: DayKey,
  scale = 1,
): Promise<number> {
  if (component.id === undefined) {
    throw new Error('Cannot schedule a Component that has not been saved.');
  }
  if (!(scale > 0)) {
    throw new Error(`Batch scale must be greater than zero, got ${scale}.`);
  }

  return db.batches.add({
    componentId: component.id,
    scheduledFor,
    scale,
    status: 'planned',
    componentName: component.name,
    componentColor: component.color,
    portionStyle: component.portionStyle,
    baseQuantity: component.baseQuantity,
    baseUnit: component.baseUnit,
    nutritionPerBase: component.nutritionPerBase,
    coveragePerBase: component.coveragePerBase,
    totalGrams: component.totalGrams,
    createdAt: Date.now(),
  });
}

/** Inclusive on both ends. */
export async function listBatchesInRange(from: DayKey, to: DayKey): Promise<Batch[]> {
  return db.batches.where('scheduledFor').between(from, to, true, true).toArray();
}

export async function listBatchesForDay(day: DayKey): Promise<Batch[]> {
  return db.batches.where('scheduledFor').equals(day).toArray();
}

/** Group a week's batches by day, so the strip can render in one pass. */
export function groupByDay(batches: readonly Batch[]): Map<DayKey, Batch[]> {
  const map = new Map<DayKey, Batch[]>();
  for (const batch of batches) {
    const existing = map.get(batch.scheduledFor);
    if (existing === undefined) map.set(batch.scheduledFor, [batch]);
    else existing.push(batch);
  }
  return map;
}

export async function deleteBatch(id: number): Promise<void> {
  await db.transaction('rw', [db.batches, db.fridgeEntries], async () => {
    const cooked = await db.fridgeEntries.where('batchId').equals(id).count();
    if (cooked > 0) {
      throw new Error(
        'This batch has already been cooked and is in the fridge. Discard the fridge entry instead.',
      );
    }
    await db.batches.delete(id);
  });
}

export async function rescheduleBatch(id: number, scheduledFor: DayKey): Promise<void> {
  const batch = await db.batches.get(id);
  if (batch === undefined) return;
  if (batch.status === 'cooked') {
    throw new Error('A cooked batch cannot be moved.');
  }
  await db.batches.update(id, { scheduledFor });
}

export async function setBatchScale(id: number, scale: number): Promise<void> {
  if (!(scale > 0)) throw new Error(`Batch scale must be greater than zero, got ${scale}.`);
  await db.batches.update(id, { scale });
}

export async function setBatchStatus(id: number, status: BatchStatus): Promise<void> {
  await db.batches.update(id, { status });
}

/**
 * Planned batches whose day has passed — the nudge on the Calendar.
 * Only `planned`: skipped ones were a decision, not an oversight.
 */
export async function pastDueBatches(today: DayKey): Promise<Batch[]> {
  const rows = await db.batches.where('status').equals('planned').toArray();
  return rows
    .filter((batch) => batch.scheduledFor < today)
    .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
}

/** Nutrition for the whole scheduled batch, scale included. */
export function batchNutrition(batch: Pick<Batch, 'nutritionPerBase' | 'scale'>): NutrientMap {
  return scaleNutrients(batch.nutritionPerBase, batch.scale);
}

/** How many portions this batch is planned to yield. */
export function batchYield(batch: Pick<Batch, 'baseQuantity' | 'scale'>): number {
  return batch.baseQuantity * batch.scale;
}
