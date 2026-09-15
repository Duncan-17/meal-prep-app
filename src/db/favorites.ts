/**
 * Quick Add favourites (PLAN.md §1.9).
 *
 * A separate lightweight table, deliberately not Components: a favourite is
 * "the yoghurt I always have", with no recipe, no batch and no fridge stock.
 * Modelling it as a Component would mean inventing a cook history it never has.
 */

import { db } from '@/db/schema';
import type { NutrientMap, QuickAddFavorite } from '@/domain/types';

export interface FavoriteDraft {
  label: string;
  quantity: number;
  unit: string;
  grams: number;
  nutrients: NutrientMap;
  coverage?: QuickAddFavorite['coverage'];
}

/** Most-used first, then most-recent — the order a favourites row wants. */
export async function listFavorites(limit = 12): Promise<QuickAddFavorite[]> {
  const rows = await db.quickAddFavorites.toArray();
  return rows
    .sort((a, b) => b.useCount - a.useCount || (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
    .slice(0, limit);
}

export async function saveFavorite(draft: FavoriteDraft): Promise<number> {
  const label = draft.label.trim();
  if (label === '') throw new Error('A favourite needs a name.');

  return db.transaction('rw', db.quickAddFavorites, async () => {
    // Same name = the same thing, updated. Otherwise saving twice quietly
    // fills the row with near-duplicates.
    const existing = await db.quickAddFavorites.where('label').equals(label).first();

    if (existing?.id !== undefined) {
      await db.quickAddFavorites.update(existing.id, {
        quantity: draft.quantity,
        unit: draft.unit,
        grams: draft.grams,
        nutrients: draft.nutrients,
        coverage: draft.coverage ?? {},
      });
      return existing.id;
    }

    return db.quickAddFavorites.add({
      label,
      quantity: draft.quantity,
      unit: draft.unit,
      grams: draft.grams,
      nutrients: draft.nutrients,
      coverage: draft.coverage ?? {},
      useCount: 0,
      createdAt: Date.now(),
    } as QuickAddFavorite);
  });
}

/** Called when a favourite is actually logged, so the row self-sorts. */
export async function recordFavoriteUse(id: number): Promise<void> {
  const favorite = await db.quickAddFavorites.get(id);
  if (favorite === undefined) return;
  await db.quickAddFavorites.update(id, {
    useCount: favorite.useCount + 1,
    lastUsedAt: Date.now(),
  });
}

export async function deleteFavorite(id: number): Promise<void> {
  await db.quickAddFavorites.delete(id);
}
