/**
 * The Worker: API proxy in front of the static app.
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
 * It was a Pages Function until 2026-09-17. Cloudflare's dashboard now creates
 * Workers rather than Pages projects, so this is the same code in the Worker
 * shape: one `fetch` handler instead of file-based routing, and `ctx.waitUntil`
 * instead of the Pages context.
 *
 * Static assets are bound as `ASSETS` and handled by the platform. `[assets]`
 * in wrangler.toml sends `/api/*` here first and serves everything else from
 * `dist/`, with `not_found_handling = "single-page-application"` doing the
 * client-side-routing fallback that `_redirects` used to attempt.
 *
 * Shares no code with `src/` — this runs on workerd, not in a browser, and is
 * typechecked separately by tsconfig.worker.json.
 */

interface Env {
  /** Cloudflare secret in production; `.dev.vars` locally. Never sent to the client. */
  USDA_API_KEY?: string;
  /** `MealPrepApp/0.1 (contact@example.com)`. Deliberately unset for now. */
  OFF_USER_AGENT?: string;
  /** The static site in `dist/`, bound by wrangler.toml. */
  ASSETS: Fetcher;
}

const FDC_BASE = 'https://api.nal.usda.gov/fdc/v1';

/** A day. Ingredient nutrition does not change hour to hour. */
const CACHE_SECONDS = 60 * 60 * 24;

const MAX_QUERY_LENGTH = 200;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;

/** The FDC datasets worth searching, best-quality first. */
const DEFAULT_DATA_TYPES = ['Foundation', 'SR Legacy', 'Survey (FNDDS)', 'Branded'];

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Anything that is not an API call belongs to the static site. This is
    // also the safety net if the `run_worker_first` routing ever widens.
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    if (request.method !== 'GET') {
      return json({ error: 'Only GET is supported.' }, 405);
    }

    const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
    const waitUntil = (promise: Promise<unknown>) => ctx.waitUntil(promise);

    try {
      if (route === 'health') {
        // Reports whether secrets are configured WITHOUT revealing them — this
        // is how to check the key is set without ever reading `.dev.vars`.
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
  },
} satisfies ExportedHandler<Env>;

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

  // Built by hand rather than with URLSearchParams, which encodes commas as
  // %2C and spaces as '+'. FoodData Central wants LITERAL commas separating
  // dataType values and %20 for spaces, and answers anything else with a bare
  // nginx 400 that names no parameter. See `encodeFdc`.
  const upstream = new URL(`${FDC_BASE}/foods/search`);
  upstream.search =
    `?query=${encodeFdc(query)}` +
    `&pageSize=${pageSize}` +
    `&dataType=${dataTypes.map((type) => encodeFdc(type.trim())).join(',')}` +
    `&api_key=${encodeFdc(key)}`;

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

  const { response: upstreamResponse, body } = await fetchWithRetry(upstream);

  if (!upstreamResponse.ok) {
    // Pass the status through, but redact the body — FDC echoes the request
    // URL (and therefore the key) in some error responses.
    //
    // `sent` is the request we actually made, with the key stripped. Without
    // it an upstream 400 is undiagnosable: the body is a generic nginx page
    // that says nothing about which parameter it objected to.
    return json(
      {
        error: `FoodData Central returned ${upstreamResponse.status}.`,
        sent: redact(`${upstream.pathname}${upstream.search}`),
        detail: redact(body).slice(0, 300),
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

/**
 * FoodData Central throttles rapid requests and reports it as a bare nginx
 * `400 Bad Request` rather than a `429`.
 *
 * Measured 2026-09-17. Fired back to back, the *same* query failed roughly one
 * time in three; spaced two seconds apart, sixteen consecutive requests all
 * succeeded. Identical URL, identical headers — only the rate differed. The
 * body is a generic nginx page naming no parameter, which is what makes this
 * look like a malformed request when it is nothing of the sort.
 *
 * A 400 is normally the one status you must never retry, since it means the
 * client is wrong. Retrying it here is justified by that measurement alone,
 * and the request is fully validated long before it reaches this function.
 *
 * The backoff has to be in SECONDS, not milliseconds — a 120 ms pause did not
 * move the failure rate at all, which is what revealed this as throttling
 * rather than a transient fault.
 *
 * 429 is excluded deliberately: retrying a declared rate limit earns a longer
 * one.
 */
const RETRYABLE_STATUSES = new Set([400, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [600, 1800];

async function fetchWithRetry(upstream: URL): Promise<{ response: Response; body: string }> {
  let last: { response: Response; body: string } | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(upstream.toString(), {
      headers: { accept: 'application/json' },
    });
    const body = await response.text();
    last = { response, body };

    if (response.ok || !RETRYABLE_STATUSES.has(response.status)) return last;

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt - 1] ?? 1800));
    }
  }

  return last!;
}

function missingKey(): Response {
  return json(
    {
      error: 'USDA_API_KEY is not configured.',
      detail:
        'Locally: add it to .dev.vars and restart wrangler. In production: the Worker’s Settings → Variables and Secrets.',
    },
    503,
  );
}

/**
 * Encode one query-string value the way FoodData Central accepts.
 *
 * `encodeURIComponent` is the right base — it uses %20 for spaces rather than
 * '+' — but it deliberately leaves `!'()*` alone, and FDC's front end rejects
 * literal parentheses with a bare nginx 400. One of the default dataTypes is
 * "Survey (FNDDS)", so this bites on the default search.
 *
 * It looked intermittent only because a cache HIT never reaches upstream.
 */
function encodeFdc(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
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
