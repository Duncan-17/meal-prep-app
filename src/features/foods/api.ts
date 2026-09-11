/**
 * Client for the Pages Function proxy.
 *
 * The browser only ever talks to our own origin — it has no idea the USDA key
 * exists, which is the whole point of the proxy (PLAN.md §2).
 */

import { adaptUsdaSearchResponse } from '@/nutrition/usda.adapter';
import { cacheFoods, cacheSearch, foodKey, getCachedSearch } from '@/db/foods';
import type { AdaptedFood } from '@/domain/types';

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

  const url = `/api/usda/search?query=${encodeURIComponent(trimmed)}`;
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

function toApiError(body: unknown, status: number): FoodApiError {
  const record = (body ?? {}) as { error?: unknown; detail?: unknown };
  const message = typeof record.error === 'string' ? record.error : `Request failed (${status}).`;
  const detail = typeof record.detail === 'string' ? record.detail : undefined;
  return new FoodApiError(message, status, detail);
}
