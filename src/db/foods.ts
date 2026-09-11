/**
 * The local food cache.
 *
 * Two layers exist: the proxy's edge cache makes a repeat request cheap, and
 * this makes a repeat search *instant* and offline-capable. Only this one
 * survives a flight-mode subway ride, which is the point of Phase 8.
 */

import { db } from '@/db/schema';
import type { AdaptedFood, FoodCacheEntry, FoodSource } from '@/domain/types';

/** Cached searches older than this are re-fetched. Nutrition data is stable. */
export const SEARCH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function foodKey(source: FoodSource, sourceId: string): string {
  return `${source}:${sourceId}`;
}

/** Lowercased and whitespace-collapsed, so "  Chicken  Thigh " hits one row. */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function cacheFoods(
  foods: readonly AdaptedFood[],
  raw?: ReadonlyMap<string, unknown>,
): Promise<void> {
  if (foods.length === 0) return;

  const now = Date.now();
  const rows: FoodCacheEntry[] = foods.map((food) => {
    const key = foodKey(food.source, food.sourceId);
    const rawPayload = raw?.get(key);
    return {
      ...food,
      key,
      fetchedAt: now,
      ...(rawPayload === undefined ? {} : { raw: rawPayload }),
    };
  });

  await db.foodCache.bulkPut(rows);
}

export async function getCachedFood(
  source: FoodSource,
  sourceId: string,
): Promise<FoodCacheEntry | undefined> {
  return db.foodCache.get(foodKey(source, sourceId));
}

/** Remember which foods a query returned, in result order. */
export async function cacheSearch(query: string, foods: readonly AdaptedFood[]): Promise<void> {
  await db.searchCache.put({
    query: normalizeQuery(query),
    keys: foods.map((food) => foodKey(food.source, food.sourceId)),
    fetchedAt: Date.now(),
  });
}

/**
 * Replay a cached search, or null to go to the network.
 *
 * Returns null if any food the search referenced has since been evicted —
 * a partial result would silently look like the search found fewer things.
 */
export async function getCachedSearch(
  query: string,
  ttlMs: number = SEARCH_CACHE_TTL_MS,
): Promise<AdaptedFood[] | null> {
  const entry = await db.searchCache.get(normalizeQuery(query));
  if (entry === undefined) return null;
  if (Date.now() - entry.fetchedAt > ttlMs) return null;

  const rows = await db.foodCache.bulkGet(entry.keys);
  const foods: AdaptedFood[] = [];
  for (const row of rows) {
    if (row === undefined) return null;
    foods.push(row);
  }
  return foods;
}

/** Drop everything cached. Offered in Settings; never touches user data. */
export async function clearFoodCaches(): Promise<void> {
  await db.transaction('rw', [db.foodCache, db.searchCache], async () => {
    await db.foodCache.clear();
    await db.searchCache.clear();
  });
}

export async function foodCacheStats(): Promise<{ foods: number; searches: number }> {
  const [foods, searches] = await Promise.all([db.foodCache.count(), db.searchCache.count()]);
  return { foods, searches };
}
