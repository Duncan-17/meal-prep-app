/**
 * Client for the Pages Function proxy.
 *
 * The browser only ever talks to our own origin — it has no idea the USDA key
 * exists, which is the whole point of the proxy (PLAN.md §2).
 */

import { adaptUsdaFood, adaptUsdaSearchResponse } from '@/nutrition/usda.adapter';
import { cacheFoods, cacheSearch, foodKey, getCachedFood, getCachedSearch } from '@/db/foods';
import type { AdaptedFood } from '@/domain/types';

/** Candidates fetched per search. The Worker caps this at 50 too. */
export const SEARCH_PAGE_SIZE = 50;

export interface SearchOutcome {
  foods: AdaptedFood[];
  /** Where the results came from, so the UI can say so honestly. */
  from: 'cache' | 'network';
}

export class FoodApiError extends Error {
  readonly status: number;
  readonly detail: string | undefined;

  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.name = 'FoodApiError';
    this.status = status;
    this.detail = detail;
  }
}

export interface ProxyHealth {
  ok: boolean;
  usdaKeyConfigured: boolean;
  offContactConfigured: boolean;
}

/**
 * Is the proxy reachable and configured?
 *
 * Reports only WHETHER the key is set, never its value — this is how to check
 * `.dev.vars` is populated without reading the file.
 */
export async function checkProxyHealth(signal?: AbortSignal): Promise<ProxyHealth> {
  const response = await fetch('/api/health', signal === undefined ? {} : { signal });
  if (!response.ok) {
    throw new FoodApiError(
      'The API proxy is not responding. Is it running under wrangler?',
      response.status,
    );
  }
  const body: unknown = await response.json();
  const record = (body ?? {}) as Partial<ProxyHealth>;
  return {
    ok: record.ok === true,
    usdaKeyConfigured: record.usdaKeyConfigured === true,
    offContactConfigured: record.offContactConfigured === true,
  };
}

/**
 * Search foods, preferring the local cache.
 *
 * The cache is checked first so a repeated search is instant and works with no
 * connection at all.
 */
export async function searchFoods(
  query: string,
  options: { signal?: AbortSignal; skipCache?: boolean } = {},
): Promise<SearchOutcome> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return { foods: [], from: 'cache' };

  if (options.skipCache !== true) {
    const cached = await getCachedSearch(trimmed);
    if (cached !== null) return { foods: cached, from: 'cache' };
  }

  // A wider page than is ever shown: FDC's own order is poor for short
  // queries, so `rankFoods` needs candidates to choose from (domain/foodSearch).
  const url = `/api/usda/search?query=${encodeURIComponent(trimmed)}&pageSize=${SEARCH_PAGE_SIZE}`;
  const response = await fetch(url, options.signal === undefined ? {} : { signal: options.signal });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw toApiError(body, response.status);
  }

  const foods = adaptUsdaSearchResponse(body);

  // Keep the raw payload per food so a registry correction can re-map these
  // rows later without hitting the API again.
  const raw = new Map<string, unknown>();
  const rawFoods = (body as { foods?: unknown })?.foods;
  if (Array.isArray(rawFoods)) {
    for (const entry of rawFoods) {
      const id = (entry as { fdcId?: unknown })?.fdcId;
      if (typeof id === 'number' || typeof id === 'string') {
        raw.set(foodKey('usda', String(id)), entry);
      }
    }
  }

  await cacheFoods(foods, raw);
  await cacheSearch(trimmed, foods);

  return { foods, from: 'network' };
}

/**
 * Fetch the full-precision record for one food.
 *
 * Worth a round trip because FDC's search endpoint ROUNDS to about three
 * significant figures while `/food/{id}` does not — 15 of 126 values differed
 * on the payload in `usda.live.test.ts`. Search results are fine for choosing;
 * this is what should be stored once a choice is made.
 *
 * Falls back to the search-grade food on failure: slightly rounded nutrition
 * beats blocking the user over a network hiccup.
 */
export async function fetchFoodDetail(
  food: AdaptedFood,
  signal?: AbortSignal,
): Promise<{ food: AdaptedFood; precise: boolean }> {
  if (food.source !== 'usda') return { food, precise: true };

  const cached = await getCachedFood('usda', food.sourceId);
  if (cached?.raw !== undefined && cached.precise === true) {
    return { food: cached, precise: true };
  }

  try {
    const response = await fetch(
      `/api/usda/food/${encodeURIComponent(food.sourceId)}`,
      signal === undefined ? {} : { signal },
    );
    if (!response.ok) return { food, precise: false };

    const body: unknown = await response.json();
    const adapted = adaptUsdaFood(body);
    if (adapted === null) return { food, precise: false };

    const merged = mergeDetail(food, adapted);
    const raw = new Map<string, unknown>([[foodKey('usda', merged.sourceId), body]]);
    await cacheFoods([merged], raw);
    return { food: merged, precise: merged.precise === true };
  } catch {
    // Aborted or offline — the caller still gets something usable.
    return { food, precise: false };
  }
}

/**
 * Combine a search result with its detail record, taking the better half of
 * each. **A detail fetch must never make the data worse.**
 *
 * That is not hypothetical. FDC's detail response for a Branded food returns
 * `foodNutrients` entries carrying only an internal `id` and an `amount` — no
 * nutrient number, no name, no unit — and an empty `labelNutrients`. There is
 * nothing to map. The search result for the same food carries all fifteen
 * nutrients fully described. Blindly preferring the detail record would wipe
 * the nutrition off every branded food in the database.
 *
 * So: portions come from the detail record (search has none at all), and
 * nutrition comes from whichever actually knows more.
 */
function mergeDetail(fromSearch: AdaptedFood, fromDetail: AdaptedFood): AdaptedFood {
  const detailKnows = Object.keys(fromDetail.nutritionPer100g).length;
  const searchKnows = Object.keys(fromSearch.nutritionPer100g).length;
  const useDetailNutrition = detailKnows >= searchKnows;

  const portions = {
    ...(fromSearch.portionGrams ?? {}),
    ...(fromDetail.portionGrams ?? {}),
  };

  return {
    ...fromDetail,
    // Labels the detail record lacks must not vanish because it was fetched.
    ...(fromDetail.category === undefined && fromSearch.category !== undefined
      ? { category: fromSearch.category }
      : {}),
    ...(fromDetail.brand === undefined && fromSearch.brand !== undefined
      ? { brand: fromSearch.brand }
      : {}),
    nutritionPer100g: useDetailNutrition
      ? fromDetail.nutritionPer100g
      : fromSearch.nutritionPer100g,
    ...(Object.keys(portions).length > 0 ? { portionGrams: portions } : {}),
    // Only the detail endpoint gives full precision; if its nutrition was
    // unusable then what we kept is the rounded search copy, and saying
    // otherwise would be a lie the cache then remembers.
    precise: useDetailNutrition,
  };
}

function toApiError(body: unknown, status: number): FoodApiError {
  const record = (body ?? {}) as { error?: unknown; detail?: unknown };
  const message = typeof record.error === 'string' ? record.error : `Request failed (${status}).`;
  const detail = typeof record.detail === 'string' ? record.detail : undefined;
  return new FoodApiError(message, status, detail);
}
