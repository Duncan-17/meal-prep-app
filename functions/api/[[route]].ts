/**
 * Cloudflare Pages Function — the USDA / Open Food Facts proxy.
 *
 * Why this exists at all (PLAN.md §2):
 *
 *  1. The USDA key would otherwise ship inside the client bundle, where it can
 *     be scraped. USDA deactivates keys found published, so this is not a
 *     theoretical concern.
 *  2. Open Food Facts asks callers to identify themselves with a `User-Agent`,
 *     and browsers forbid JavaScript from setting that header.
 *  3. Edge caching makes a repeat ingredient lookup free.
 *
 * It deliberately returns FoodData Central's payload close to unchanged.
 * Mapping into canonical nutrient keys happens in `src/nutrition/usda.adapter.ts`,
 * where it is pure and unit-tested, and where `foodCache.raw` lets a registry
 * correction re-map old rows without refetching anything.
 *
 * This file shares no code with `src/` — Pages Functions bundle separately and
 * run on workerd, not in the browser. It is typechecked by tsconfig.functions.json.
 */

interface Env {
  /** Cloudflare secret in production; `.dev.vars` locally. Never sent to the client. */
  USDA_API_KEY?: string;
  /** `MealPrepApp/0.1 (contact@example.com)`. Deliberately unset for now. */
  OFF_USER_AGENT?: string;
}

const FDC_BASE = 'https://api.nal.usda.gov/fdc/v1';

/** A day. Ingredient nutrition does not change hour to hour. */
const CACHE_SECONDS = 60 * 60 * 24;

const MAX_QUERY_LENGTH = 200;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;

/** The FDC datasets worth searching, best-quality first. */
const DEFAULT_DATA_TYPES = ['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded'];

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env, waitUntil } = context;
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');

  try {
    if (route === 'health') {
      // Reports whether secrets are configured WITHOUT revealing them — this is
      // how to check the key is set without ever reading .dev.vars.
      return json({
        ok: true,
        usdaKeyConfigured: Boolean(env.USDA_API_KEY),
        offContactConfigured: Boolean(env.OFF_USER_AGENT),
      });
    }

    if (route === 'usda/search') {
      return await handleUsdaSearch(url, env, waitUntil);
    }

    const foodMatch = /^usda\/food\/(\d+)$/.exec(route);
    if (foodMatch?.[1] !== undefined) {
      return await handleUsdaFood(foodMatch[1], env, waitUntil);
    }

    if (route.startsWith('off/')) {
      // Deferred by choice — SETUP.md item 8. Kept as an explicit 501 so the
      // client gets a clear reason instead of a confusing 404.
      return json(
        {
          error: 'Open Food Facts is not enabled.',
          detail:
            'OFF_USER_AGENT is not configured. Open Food Facts asks callers to identify themselves, so lookups stay disabled until a contact address is set.',
        },
        501,
      );
    }

    return json({ error: `Unknown API route: ${route}` }, 404);
  } catch (error) {
    // Never let an upstream message leak the key into a client-visible body.
    return json({ error: 'Upstream request failed.', detail: redact(String(error)) }, 502);
  }
};

async function handleUsdaSearch(
  url: URL,
  env: Env,
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<Response> {
  // Validate the request before checking configuration, so a malformed call
  // reports 400 rather than being masked by a missing-key 503.
  const query = (url.searchParams.get('query') ?? '').trim();
  if (query.length === 0) {
    return json({ error: 'Missing `query` parameter.' }, 400);
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return json({ error: `Query too long (max ${MAX_QUERY_LENGTH} characters).` }, 400);
  }

  const key = env.USDA_API_KEY;
  if (!key) return missingKey();

  const pageSize = clamp(
    Number.parseInt(url.searchParams.get('pageSize') ?? '', 10) || DEFAULT_PAGE_SIZE,
    1,
    MAX_PAGE_SIZE,
  );

  const dataTypeParam = url.searchParams.get('dataType');
  const dataTypes = dataTypeParam ? dataTypeParam.split(',') : DEFAULT_DATA_TYPES;

  const upstream = new URL(`${FDC_BASE}/foods/search`);
  upstream.searchParams.set('query', query);
  upstream.searchParams.set('pageSize', String(pageSize));
  upstream.searchParams.set('dataType', dataTypes.join(','));
  upstream.searchParams.set('api_key', key);

  // Cache key excludes the api_key so the cache is not partitioned by secret.
  const cacheKey = new Request(
    `https://cache.local/usda/search?query=${encodeURIComponent(query)}&pageSize=${pageSize}&dataType=${encodeURIComponent(dataTypes.join(','))}`,
  );

  return fetchWithCache(upstream, cacheKey, waitUntil);
}

async function handleUsdaFood(
  fdcId: string,
  env: Env,
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<Response> {
  const key = env.USDA_API_KEY;
  if (!key) return missingKey();

  const upstream = new URL(`${FDC_BASE}/food/${fdcId}`);
  upstream.searchParams.set('api_key', key);

  const cacheKey = new Request(`https://cache.local/usda/food/${fdcId}`);

  return fetchWithCache(upstream, cacheKey, waitUntil);
}

/**
 * Fetch through the edge cache.
 *
 * `cacheKey` is a synthetic URL that never contains the API key — otherwise
 * the secret would sit in the cache index.
 */
async function fetchWithCache(
  upstream: URL,
  cacheKey: Request,
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<Response> {
  const cache = caches.default;

  const hit = await cache.match(cacheKey);
  if (hit) {
    const cached = new Response(hit.body, hit);
    cached.headers.set('x-proxy-cache', 'HIT');
    return cached;
  }

  const upstreamResponse = await fetch(upstream.toString(), {
    headers: { accept: 'application/json' },
  });

  const body = await upstreamResponse.text();

  if (!upstreamResponse.ok) {
    // Pass the status through, but redact the body — FDC echoes the request
    // URL (and therefore the key) in some error responses.
    return json(
      {
        error: `FoodData Central returned ${upstreamResponse.status}.`,
        detail: redact(body).slice(0, 500),
      },
      upstreamResponse.status === 429 ? 429 : 502,
    );
  }

  const response = new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${CACHE_SECONDS}`,
      'x-proxy-cache': 'MISS',
    },
  });

  waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

function missingKey(): Response {
  return json(
    {
      error: 'USDA_API_KEY is not configured.',
      detail:
        'Locally: add it to .dev.vars and restart wrangler. In production: Cloudflare Pages → Settings → Variables and Secrets.',
    },
    503,
  );
}

/**
 * Strip anything that looks like a key before a string reaches the client.
 * Belt and braces — nothing should ever put the key in a response body.
 */
function redact(text: string): string {
  return text.replace(/api_key=[^&\s"']+/gi, 'api_key=REDACTED');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
