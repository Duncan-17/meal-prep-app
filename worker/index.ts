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
 *
 * Since 2026-10-07 it also hosts `/api/sync`, which swaps the user's data with
 * a D1 database (PLAN.md §10 "Storage"). The rules live in `syncLogic.ts`;
 * this file only adapts them to D1. No authentication, by the user's decision
 * — single user, one address; revisit when it becomes multi-user.
 */

import {
  SyncRequestError,
  parsePush,
  pull,
  type IncomingRecord,
  type StoredRecord,
  type SyncStore,
} from './syncLogic';

interface Env {
  /** Cloudflare secret in production; `.dev.vars` locally. Never sent to the client. */
  USDA_API_KEY?: string;
  /** `MealPrepApp/0.1 (contact@example.com)`. Deliberately unset for now. */
  OFF_USER_AGENT?: string;
  /** The static site in `dist/`, bound by wrangler.toml. */
  ASSETS: Fetcher;
  /**
   * The sync database. Optional on purpose: until the binding is in
   * wrangler.toml, `/api/sync` answers 503 and the app simply stays local.
   */
  DB?: D1Database;
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

    const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');

    if (route === 'sync') {
      return handleSync(request, url, env);
    }

    if (request.method !== 'GET') {
      return json({ error: 'Only GET is supported.' }, 405);
    }

    const waitUntil = (promise: Promise<unknown>) => ctx.waitUntil(promise);

    try {
      if (route === 'health') {
        // Reports whether secrets are configured WITHOUT revealing them — this
        // is how to check the key is set without ever reading `.dev.vars`.
        return json({
          ok: true,
          usdaKeyConfigured: Boolean(env.USDA_API_KEY),
          offContactConfigured: Boolean(env.OFF_USER_AGENT),
          syncConfigured: Boolean(env.DB),
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

// ── Sync ────────────────────────────────────────────────────────────────────

async function handleSync(request: Request, url: URL, env: Env): Promise<Response> {
  if (env.DB === undefined) {
    return json(
      {
        error: 'Sync is not configured.',
        detail: 'No D1 database is bound as DB in wrangler.toml, so data stays on each device.',
      },
      503,
    );
  }

  const store = await d1Store(env.DB);

  try {
    if (request.method === 'GET') {
      const since = Number.parseInt(url.searchParams.get('since') ?? '0', 10);
      return json(await pull(store, Number.isFinite(since) && since > 0 ? since : 0));
    }

    if (request.method === 'POST') {
      const changes = parsePush(await request.json().catch(() => null));
      const written = await store.upsertNewer(changes);
      return json({ received: changes.length, written });
    }

    return json({ error: 'Sync takes GET or POST.' }, 405);
  } catch (error) {
    if (error instanceof SyncRequestError) return json({ error: error.message }, 400);
    return json({ error: 'Sync failed.', detail: String(error).slice(0, 300) }, 500);
  }
}

/**
 * The table is created on first use rather than by a migration step, so a
 * fresh database works the moment it is bound — no command to remember to
 * run against production. `IF NOT EXISTS` makes the check idempotent, and it
 * runs once per Worker instance, not per request.
 */
let schemaReady: Promise<unknown> | null = null;

function ensureSchema(db: D1Database): Promise<unknown> {
  schemaReady ??= db
    .batch([
      db.prepare(
        `CREATE TABLE IF NOT EXISTS records (
           tbl TEXT NOT NULL,
           id TEXT NOT NULL,
           data TEXT,
           updated_at INTEGER NOT NULL,
           deleted INTEGER NOT NULL DEFAULT 0,
           rev INTEGER NOT NULL,
           PRIMARY KEY (tbl, id)
         )`,
      ),
      db.prepare('CREATE INDEX IF NOT EXISTS records_rev ON records (rev)'),
    ])
    .catch((error: unknown) => {
      schemaReady = null; // let the next request try again
      throw error;
    });
  return schemaReady;
}

/** D1 statements per batch call — comfortably inside D1's limits. */
const D1_CHUNK = 50;

/*
 * One statement does the whole "strictly newer wins" rule: insert, or on a
 * clash update only WHERE the incoming change is newer. The rev subquery runs
 * per statement, and a D1 batch runs its statements in order inside one
 * transaction, so revs come out strictly increasing.
 */
const UPSERT_NEWER = `
  INSERT INTO records (tbl, id, data, updated_at, deleted, rev)
  VALUES (?1, ?2, ?3, ?4, ?5, (SELECT COALESCE(MAX(rev), 0) + 1 FROM records))
  ON CONFLICT (tbl, id) DO UPDATE SET
    data = excluded.data,
    updated_at = excluded.updated_at,
    deleted = excluded.deleted,
    rev = excluded.rev
  WHERE excluded.updated_at > records.updated_at`;

async function d1Store(db: D1Database): Promise<SyncStore> {
  await ensureSchema(db);

  return {
    async upsertNewer(records: readonly IncomingRecord[]): Promise<number> {
      let written = 0;
      for (let start = 0; start < records.length; start += D1_CHUNK) {
        const chunk = records.slice(start, start + D1_CHUNK);
        const results = await db.batch(
          chunk.map((record) =>
            db
              .prepare(UPSERT_NEWER)
              .bind(
                record.tbl,
                record.id,
                record.deleted ? null : JSON.stringify(record.data),
                record.updatedAt,
                record.deleted ? 1 : 0,
              ),
          ),
        );
        for (const result of results) written += result.meta.changes ?? 0;
      }
      return written;
    },

    async changesSince(since: number, limit: number): Promise<StoredRecord[]> {
      const { results } = await db
        .prepare(
          'SELECT tbl, id, data, updated_at, deleted, rev FROM records WHERE rev > ?1 ORDER BY rev LIMIT ?2',
        )
        .bind(since, limit)
        .all<{
          tbl: string;
          id: string;
          data: string | null;
          updated_at: number;
          deleted: number;
          rev: number;
        }>();
      return results.map((row) => ({
        tbl: row.tbl,
        id: row.id,
        data: row.data,
        updatedAt: row.updated_at,
        deleted: row.deleted === 1,
        rev: row.rev,
      }));
    },
  };
}

// ── USDA ────────────────────────────────────────────────────────────────────

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

  return fetchWithCache(upstream, cacheKey, waitUntil, slimSearchBody);
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
  transform: (body: string) => string = (body) => body,
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

  const response = new Response(transform(body), {
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
 * Keep only what the app reads from a search response.
 *
 * FDC sends a great deal per food — ingredient lists, GTINs, highlight
 * fragments, a dozen descriptor fields on every one of ~100 nutrients. Measured
 * 2026-10-06: 25 results were 347 kB raw and 82 kB slimmed. That matters twice
 * over on a phone, because the client also stores each food in IndexedDB.
 *
 * Nutrients keep number, unit and value — everything `adaptNutrients` needs to
 * re-map a food later if the registry changes. Anything unparseable passes
 * through untouched rather than failing the search.
 */
const SEARCH_FOOD_FIELDS = [
  'fdcId',
  'description',
  'dataType',
  'brandOwner',
  'brandName',
  'foodCategory',
  'servingSize',
  'servingSizeUnit',
  'householdServingFullText',
] as const;

function slimSearchBody(body: string): string {
  try {
    const parsed = JSON.parse(body) as { foods?: unknown; totalHits?: unknown };
    if (!Array.isArray(parsed.foods)) return body;

    const foods = parsed.foods.map((raw: unknown) => {
      const food = (raw ?? {}) as Record<string, unknown>;
      const slim: Record<string, unknown> = {};
      for (const field of SEARCH_FOOD_FIELDS) {
        if (food[field] !== undefined) slim[field] = food[field];
      }
      if (Array.isArray(food.foodNutrients)) {
        slim.foodNutrients = food.foodNutrients.map((entry: unknown) => {
          const nutrient = (entry ?? {}) as Record<string, unknown>;
          return {
            nutrientNumber: nutrient.nutrientNumber,
            unitName: nutrient.unitName,
            value: nutrient.value,
          };
        });
      }
      return slim;
    });

    return JSON.stringify({ totalHits: parsed.totalHits, foods });
  } catch {
    return body;
  }
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
