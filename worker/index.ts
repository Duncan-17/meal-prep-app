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
 * this file only adapts them to HTTP.
 *
 * Since 2026-11-04 every route except `/api/health` and `/api/auth/*` needs a
 * signed-in session (PLAN.md §11) — which also stops the USDA proxy being free
 * for anyone who finds the address. Rules in `authLogic.ts`, storage in
 * `d1Stores.ts`.
 *
 * Hardening (step 2, 2026-11-04): every API reply carries security headers
 * (`withSecurityHeaders`; the static pages get theirs from `public/_headers`),
 * request bodies are size-capped before parsing, and USDA lookups are
 * rate-limited per user.
 */

import {
  AuthError,
  USDA_REQUESTS_PER_USER,
  USDA_WINDOW_MS,
  authenticate,
  changePassword,
  logIn,
  logOut,
  logOutOthers,
  rateLimit,
  signUp,
  type Authenticated,
  type NewSession,
  type RequestContext,
} from './authLogic';
import { d1AuthStore, d1SyncStore, ensureSchema } from './d1Stores';
import { MAX_PUSH_BYTES, SyncRequestError, parsePush, pull, push } from './syncLogic';

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

/** Sign-in bodies are a username and a 44-character proof or two. */
const MAX_AUTH_BODY_BYTES = 16 * 1024;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Anything that is not an API call belongs to the static site. This is
    // also the safety net if the `run_worker_first` routing ever widens.
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    return withSecurityHeaders(await handleApi(request, url, env, ctx), url);
  },
} satisfies ExportedHandler<Env>;

async function handleApi(
  request: Request,
  url: URL,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');

  // A write must come from this app's own pages. The session cookie is
  // SameSite=Strict, which already stops other sites sending it; this is a
  // second lock on the same door.
  if (request.method !== 'GET' && request.method !== 'HEAD' && !sameOrigin(request, url)) {
    return noStoreJson({ error: 'Cross-origin request refused.' }, 403);
  }

  if (route === 'health' && request.method === 'GET') {
    // Reports whether secrets are configured WITHOUT revealing them — this
    // is how to check the key is set without ever reading `.dev.vars`.
    return json({
      ok: true,
      usdaKeyConfigured: Boolean(env.USDA_API_KEY),
      offContactConfigured: Boolean(env.OFF_USER_AGENT),
      syncConfigured: Boolean(env.DB),
    });
  }

  if (env.DB === undefined) {
    return noStoreJson(
      {
        error: 'The server has no database.',
        detail: 'No D1 database is bound as DB in wrangler.toml, so nobody can sign in.',
      },
      503,
    );
  }
  await ensureSchema(env.DB);

  if (route.startsWith('auth/')) {
    return handleAuth(route, request, url, env.DB);
  }

  // Everything below needs a signed-in user.
  const auth = await authenticate(d1AuthStore(env.DB), readSessionCookie(request), Date.now());
  if (auth === null) {
    return noStoreJson({ error: 'Sign in first.' }, 401);
  }

  if (route === 'sync') {
    return withRenewal(await handleSync(request, url, env.DB, auth.user.id), request, auth, url);
  }

  if (request.method !== 'GET') {
    return json({ error: 'Only GET is supported.' }, 405);
  }

  const waitUntil = (promise: Promise<unknown>) => ctx.waitUntil(promise);

  try {
    if (route.startsWith('usda/')) {
      // Counted per account, cache hits included: the point is to bound
      // what one account can make the Worker do, not only upstream calls.
      await rateLimit(
        d1AuthStore(env.DB),
        `usda:${auth.user.id}`,
        USDA_REQUESTS_PER_USER,
        USDA_WINDOW_MS,
        Date.now(),
        'Too many food lookups. Wait a minute and try again.',
      );
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
    if (error instanceof AuthError) {
      return json({ error: error.message }, error.status, {
        'retry-after': String(error.retryAfterSeconds ?? 60),
      });
    }
    // Log the cause server-side only; the client gets a generic message so no
    // upstream text, stack trace, or key can reach a response body.
    console.error('Upstream request failed:', redact(String(error)));
    return json({ error: 'Upstream request failed.' }, 502);
  }
}

// ── Auth ────────────────────────────────────────────────────────────────────

async function handleAuth(
  route: string,
  request: Request,
  url: URL,
  db: D1Database,
): Promise<Response> {
  const store = d1AuthStore(db);
  const context: RequestContext = {
    ip: request.headers.get('cf-connecting-ip') ?? 'local',
    userAgent: request.headers.get('user-agent') ?? '',
    now: Date.now(),
  };

  try {
    if (route === 'auth/me' && request.method === 'GET') {
      const auth = await authenticate(store, readSessionCookie(request), context.now);
      if (auth === null) {
        return noStoreJson({ error: 'Not signed in.' }, 401, clearCookie(url));
      }
      return withRenewal(noStoreJson({ username: auth.user.username }), request, auth, url);
    }

    if (request.method !== 'POST') return noStoreJson({ error: 'Use POST.' }, 405);
    const body = await readJson(request, MAX_AUTH_BODY_BYTES);
    if (body === TOO_LARGE) return noStoreJson({ error: 'Request too large.' }, 413);

    if (route === 'auth/signup') {
      return sessionResponse(await signUp(store, body, context), url, 201);
    }
    if (route === 'auth/login') {
      return sessionResponse(await logIn(store, body, context), url);
    }

    const auth = await authenticate(store, readSessionCookie(request), context.now);
    if (auth === null) return noStoreJson({ error: 'Sign in first.' }, 401, clearCookie(url));

    if (route === 'auth/logout') {
      await logOut(store, auth);
      return noStoreJson({ ok: true }, 200, clearCookie(url));
    }
    if (route === 'auth/logout-others') {
      await logOutOthers(store, auth);
      return noStoreJson({ ok: true });
    }
    if (route === 'auth/password') {
      await changePassword(store, auth, body, context);
      return noStoreJson({ ok: true });
    }

    return noStoreJson({ error: `Unknown API route: ${route}` }, 404);
  } catch (error) {
    if (error instanceof AuthError) {
      const retry: Record<string, string> =
        error.retryAfterSeconds === undefined
          ? {}
          : { 'retry-after': String(error.retryAfterSeconds) };
      return noStoreJson({ error: error.message }, error.status, retry);
    }
    // Never echo internals from the auth path.
    console.error('auth failed', error);
    return noStoreJson({ error: 'Something went wrong. Try again.' }, 500);
  }
}

/*
 * The session cookie. The `__Host-` prefix makes the browser refuse it unless
 * it is Secure, has Path=/ and no Domain — so nothing else can set or read it.
 * HttpOnly keeps page scripts (and so any XSS) from reading the token;
 * SameSite=Strict keeps other sites from making the browser send it.
 *
 * Over plain http (a phone testing `npm run serve:full` on the LAN) a Secure
 * cookie would be dropped, so there it is a plain `session` cookie instead.
 * Browsers treat localhost as secure, so `npm run dev` gets the real one.
 */
const SECURE_COOKIE = '__Host-session';
const PLAIN_COOKIE = 'session';

function isSecureOrigin(url: URL): boolean {
  return url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1';
}

function sessionCookie(url: URL, value: string, maxAgeSeconds: number): string {
  const secure = isSecureOrigin(url);
  return [
    `${secure ? SECURE_COOKIE : PLAIN_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.max(0, maxAgeSeconds)}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

function readSessionCookie(request: Request): string | null {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SECURE_COOKIE || name === PLAIN_COOKIE) return rest.join('=');
  }
  return null;
}

function sessionResponse(session: NewSession, url: URL, status = 200): Response {
  const maxAge = Math.floor((session.expiresAt - Date.now()) / 1000);
  return noStoreJson({ username: session.user.username }, status, {
    'set-cookie': sessionCookie(url, session.token, maxAge),
  });
}

function clearCookie(url: URL): Record<string, string> {
  return { 'set-cookie': sessionCookie(url, '', 0) };
}

/**
 * When a session was just extended, re-send its cookie with the new lifetime.
 * The server keeps only the token's hash, so the token comes from the request
 * that presented it.
 */
function withRenewal(
  response: Response,
  request: Request,
  auth: Authenticated,
  url: URL,
): Response {
  const token = readSessionCookie(request);
  if (auth.renewedUntil === undefined || token === null) return response;
  const renewed = new Response(response.body, response);
  renewed.headers.append(
    'set-cookie',
    sessionCookie(url, token, Math.floor((auth.renewedUntil - Date.now()) / 1000)),
  );
  return renewed;
}

/**
 * The request's Origin is this site — or, in development only, both are
 * loopback addresses: Vite on :5173 proxies to wrangler on :8788, so the
 * browser's Origin and the URL the Worker sees differ by port. Production is
 * always a single origin.
 */
function sameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get('origin');
  // Browsers send Origin on every POST; a request without one did not come
  // from a page, and the app has no other clients.
  if (origin === null) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.host === url.host) return true;
  const loopback = (host: string) => host === 'localhost' || host === '127.0.0.1';
  return loopback(parsed.hostname) && loopback(url.hostname);
}

// ── Request bodies and response headers ─────────────────────────────────────

const TOO_LARGE = Symbol('too large');

/**
 * Parse a JSON body, reading at most `maxBytes` of it. The declared length is
 * checked first, but not trusted: a chunked body declares none, so the stream
 * is counted as it arrives and abandoned the moment it passes the cap. Bad
 * JSON comes back as null, for the caller's own validation to refuse.
 */
async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > maxBytes) return TOO_LARGE;
  if (request.body === null) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return TOO_LARGE;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

/*
 * Every API reply is data, never a page, so its policy forbids everything: if
 * a browser were ever tricked into rendering one as HTML, nothing in it could
 * run or load. `nosniff` stops it being guessed into a script or stylesheet;
 * CORP stops other sites embedding it. HSTS only over https — browsers ignore
 * it on http, and localhost must stay reachable.
 *
 * The static pages get their own, page-shaped policy from public/_headers.
 */
const API_SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
};

function withSecurityHeaders(response: Response, url: URL): Response {
  // Re-wrapped because a Response from the cache or fetch() has immutable headers.
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
    secured.headers.set(name, value);
  }
  if (url.protocol === 'https:') {
    secured.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  }
  return secured;
}

// ── Sync ────────────────────────────────────────────────────────────────────

async function handleSync(
  request: Request,
  url: URL,
  db: D1Database,
  userId: string,
): Promise<Response> {
  const store = d1SyncStore(db);

  try {
    if (request.method === 'GET' && url.searchParams.has('stats')) {
      return noStoreJson(await store.stats(userId));
    }

    if (request.method === 'GET') {
      const since = Number.parseInt(url.searchParams.get('since') ?? '0', 10);
      return noStoreJson(
        await pull(store, userId, Number.isFinite(since) && since > 0 ? since : 0),
      );
    }

    if (request.method === 'POST') {
      const body = await readJson(request, MAX_PUSH_BYTES);
      if (body === TOO_LARGE) {
        return noStoreJson({ error: `Push larger than ${MAX_PUSH_BYTES / 1024 / 1024} MB.` }, 413);
      }
      const changes = parsePush(body);
      const written = await push(store, userId, changes);
      return noStoreJson({ received: changes.length, written });
    }

    return noStoreJson({ error: 'Sync takes GET or POST.' }, 405);
  } catch (error) {
    if (error instanceof SyncRequestError) {
      return noStoreJson({ error: error.message }, error.status);
    }
    console.error('sync failed', error);
    return noStoreJson({ error: 'Sync failed.' }, 500);
  }
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

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

/**
 * Every sync and auth reply is marked never-cache. A pull URL repeats exactly
 * (`?since=0` until something arrives), and a browser that kept the first,
 * empty answer would report "synced" forever while never seeing new data.
 * Suspected on mobile Safari 2026-10-08 — the phone could load the data by
 * visiting the URL directly, yet the app on it never received any.
 */
const NO_STORE = { 'cache-control': 'no-store' };

function noStoreJson(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return json(body, status, { ...NO_STORE, ...extraHeaders });
}
