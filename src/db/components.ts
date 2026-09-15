/**
 * Component persistence.
 *
 * Reads are done with `useLiveQuery` in the screens; these are the writes and
 * the guards around them.
 */

import { db } from '@/db/schema';
import type { Component, ComponentIngredient, Coverage, NutrientMap } from '@/domain/types';

export interface ComponentDraft {
  id?: number;
  name: string;
  color: string;
  category?: string;
  portionStyle: Component['portionStyle'];
  baseQuantity: number;
  baseUnit: string;
  ingredients: ComponentIngredient[];
  nutritionPerBase: NutrientMap;
  coveragePerBase: Coverage;
  totalGrams: number;
}

export async function getComponent(id: number): Promise<Component | undefined> {
  return db.components.get(id);
}

export async function listComponents(): Promise<Component[]> {
  return db.components.orderBy('name').toArray();
}

export async function saveComponent(draft: ComponentDraft): Promise<number> {
  const now = Date.now();

  const category = draft.category?.trim();
  const base = {
    name: draft.name.trim(),
    color: draft.color,
    portionStyle: draft.portionStyle,
    baseQuantity: draft.baseQuantity,
    baseUnit: draft.baseUnit,
    ingredients: draft.ingredients,
    nutritionPerBase: draft.nutritionPerBase,
    coveragePerBase: draft.coveragePerBase,
    totalGrams: draft.totalGrams,
    updatedAt: now,
    // exactOptionalPropertyTypes: omit rather than store undefined.
    ...(category === undefined || category === '' ? {} : { category }),
  };

  if (draft.id !== undefined) {
    const existing = await db.components.get(draft.id);
    if (existing === undefined) throw new Error(`Component ${draft.id} no longer exists.`);
    // Editing a Component must never rewrite history — Batch, FridgeEntry and
    // MealLog all snapshot their own nutrition (PLAN.md §3d), so this is safe.
    await db.components.put({ ...existing, ...base, id: draft.id });
    return draft.id;
  }

  return db.components.add({ ...base, createdAt: now });
}

export interface ComponentUsage {
  batches: number;
  fridgeEntries: number;
}

/** What already depends on this Component. */
export async function componentUsage(id: number): Promise<ComponentUsage> {
  const [batches, fridgeEntries] = await Promise.all([
    db.batches.where('componentId').equals(id).count(),
    db.fridgeEntries.where('componentId').equals(id).count(),
  ]);
  return { batches, fridgeEntries };
}

export class ComponentInUseError extends Error {
  readonly usage: ComponentUsage;

  constructor(usage: ComponentUsage) {
    super(
      `This Component has been cooked before (${usage.batches} batch${
        usage.batches === 1 ? '' : 'es'
      }, ${usage.fridgeEntries} fridge entr${usage.fridgeEntries === 1 ? 'y' : 'ies'}). Deleting it would leave that history pointing at nothing.`,
    );
    this.name = 'ComponentInUseError';
    this.usage = usage;
  }
}

/**
 * Delete a Component, refusing if it has cook history.
 *
 * History rows snapshot their own nutrition so the NUMBERS would survive, but
 * they also carry `componentId` — deleting would orphan those references and
 * break any future "show me every time I cooked this". Phase 3 guards it;
 * an archive flag would be the kinder answer later.
 */
export async function deleteComponent(id: number): Promise<void> {
  await db.transaction('rw', [db.components, db.batches, db.fridgeEntries], async () => {
    const usage = await componentUsage(id);
    if (usage.batches > 0 || usage.fridgeEntries > 0) {
      throw new ComponentInUseError(usage);
    }
    await db.components.delete(id);
  });
}

/** Colours already in use, for the distinctness check and swatch defaulting. */
export async function componentColors(
  excludeId?: number,
): Promise<Array<{ name: string; color: string }>> {
  const all = await db.components.toArray();
  return all
    .filter((component) => component.id !== excludeId)
    .map((component) => ({ name: component.name, color: component.color }));
}
