/**
 * Scratchpad persistence.
 *
 * A scratchpad is saved whole on every change — items, amounts and
 * placements are one row. Drag-and-drop writes often, and one small put per
 * drop is simpler and cheaper than keeping items in their own table; sync
 * then carries the scratchpad as one record (later edit wins, as everywhere).
 */

import { db } from '@/db/schema';
import type { Scratchpad } from '@/domain/types';

/** A week, unless chosen otherwise. */
export const DEFAULT_DAYS = 7;

export async function listScratchpads(): Promise<Scratchpad[]> {
  const rows = await db.scratchpads.toArray();
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getScratchpad(id: number): Promise<Scratchpad | undefined> {
  return db.scratchpads.get(id);
}

export async function createScratchpad(name: string): Promise<number> {
  const now = Date.now();
  return db.scratchpads.add({
    name: name.trim() || 'Untitled',
    days: DEFAULT_DAYS,
    items: [],
    createdAt: now,
    updatedAt: now,
  });
}

/** Save the whole scratchpad as it now stands. */
export async function saveScratchpad(pad: Scratchpad): Promise<void> {
  if (pad.id === undefined) throw new Error('Cannot save a scratchpad that was never created.');
  await db.scratchpads.put({ ...pad, updatedAt: Date.now() });
}

export async function deleteScratchpad(id: number): Promise<void> {
  await db.scratchpads.delete(id);
}

/** Item ids only need to be unique within one scratchpad. */
export function newItemUid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
