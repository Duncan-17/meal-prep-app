/**
 * Accounts and sessions — the server's rules, independent of where rows live.
 *
 * Design: PLAN.md §11. The parts that are easy to get subtly wrong:
 *
 *  - **The server never sees a password.** The browser stretches it with
 *    Argon2id and derives a 32-byte *login proof* (`src/auth/derive.ts`). The
 *    server stores SHA-256 of that proof. A fast hash is enough HERE because
 *    the input is already a 256-bit key, not a guessable password: someone
 *    holding the database still has to run Argon2id once per password guess.
 *    It also keeps the Worker inside its CPU budget — Argon2id on the server
 *    would not be.
 *  - **Password rules can only be enforced in the browser** (8 characters, by
 *    the user's choice) — the server cannot see the password to check it.
 *  - **Sessions are server-side.** The cookie holds a random token; the
 *    database holds only its SHA-256, so a leaked sessions table cannot be
 *    replayed. A server-side row is what makes "sign out everywhere" and an
 *    admin reset actually end sessions — a JWT could not be revoked.
 *  - **Login failures are counted per username AND per IP**, so neither
 *    guessing one account from many addresses nor many accounts from one
 *    address goes unthrottled. The count is read-then-write, so two requests
 *    racing can both slip through; at five a minute that is acceptable.
 *  - **Unknown username and wrong password are the same answer**, and an
 *    unknown username still does a hash comparison, so neither the message
 *    nor the timing says which one it was. Sign-up necessarily reveals that a
 *    name is taken; its own per-IP limit keeps that from being a fast oracle.
 *
 * No Cloudflare types in here: `d1Stores.ts` supplies the D1-backed store and
 * the tests an in-memory one, so both run exactly these rules.
 */

// ── Tunables (agreed with the user 2026-11-04) ──────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/** Sessions last 30 days, extended whenever used. */
export const SESSION_TTL_MS = 30 * DAY_MS;
/** Extend at most once a day, so an active session is not one write per request. */
export const SESSION_SLIDE_AFTER_MS = DAY_MS;

export const LOGIN_WINDOW_MS = 60_000;
/** Failed logins per username per minute. */
export const LOGIN_FAILURES_PER_USER = 5;
/** Failed logins per IP per minute — higher, since one household shares an IP. */
export const LOGIN_FAILURES_PER_IP = 20;

export const SIGNUP_WINDOW_MS = 60 * 60_000;
/** Account creations attempted per IP per hour. */
export const SIGNUPS_PER_IP = 5;

/** 3–32 characters: lowercase letters, digits, `_ . -`, starting with a letter or digit. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_.-]{2,31}$/;

// ── Types ───────────────────────────────────────────────────────────────────

export interface UserRow {
  id: string;
  username: string;
  /** Hex SHA-256 of the login proof. */
  authHash: string;
  createdAt: number;
  disabled: boolean;
}

export interface SessionRow {
  /** Hex SHA-256 of the cookie token — never the token itself. */
  tokenHash: string;
  userId: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  userAgent: string;
}

export interface AttemptWindow {
  windowStart: number;
  count: number;
}

export interface AuthStore {
  userByName(username: string): Promise<UserRow | null>;
  userById(id: string): Promise<UserRow | null>;
  /** False if the username is taken. */
  createUser(user: UserRow): Promise<boolean>;
  setAuthHash(userId: string, authHash: string): Promise<void>;

  createSession(session: SessionRow): Promise<void>;
  session(tokenHash: string): Promise<SessionRow | null>;
  touchSession(tokenHash: string, lastSeenAt: number, expiresAt: number): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Every session of a user, optionally sparing one (the caller's own). */
  deleteUserSessions(userId: string, except?: string): Promise<void>;
  deleteExpiredSessions(now: number): Promise<void>;

  attempts(key: string): Promise<AttemptWindow | null>;
  setAttempts(key: string, window: AttemptWindow): Promise<void>;
  clearAttempts(key: string): Promise<void>;
}

/** A refusal the client may see. `status` is the HTTP status to send. */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 409 | 429,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface NewSession {
  /** Goes in the cookie. Never stored. */
  token: string;
  user: { id: string; username: string };
  expiresAt: number;
}

export interface Authenticated {
  user: { id: string; username: string };
  tokenHash: string;
  /** Set when the session was just extended — the cookie should be re-sent. */
  renewedUntil?: number;
}

export interface RequestContext {
  ip: string;
  userAgent: string;
  now: number;
}

// ── Input checks ────────────────────────────────────────────────────────────

/** Usernames are case-insensitive: stored and compared lowercased. */
export function normalizeUsername(raw: unknown): string {
  if (typeof raw !== 'string') throw new AuthError('Enter a username.', 400);
  const username = raw.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    throw new AuthError(
      'Usernames are 3–32 characters: letters, numbers, and _ . - (starting with a letter or number).',
      400,
    );
  }
  return username;
}

/** The login proof: base64 of exactly 32 bytes. */
export function parseProof(raw: unknown): Uint8Array {
  if (typeof raw !== 'string' || raw.length > 64) throw new AuthError('Malformed request.', 400);
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(raw), (char) => char.charCodeAt(0));
  } catch {
    throw new AuthError('Malformed request.', 400);
  }
  if (bytes.length !== 32) throw new AuthError('Malformed request.', 400);
  return bytes;
}

// ── Crypto helpers ──────────────────────────────────────────────────────────

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** URL- and cookie-safe base64 of 32 random bytes. */
export function newToken(): string {
  return btoa(String.fromCharCode(...randomBytes(32)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

/** Compares in time independent of WHERE the strings differ. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Compared against when the username does not exist, so the timing matches. */
const DUMMY_HASH = '0'.repeat(64);

// ── Rate limiting ───────────────────────────────────────────────────────────

async function assertUnderLimit(
  store: AuthStore,
  key: string,
  limit: number,
  windowMs: number,
  now: number,
  message: string,
): Promise<void> {
  const window = await store.attempts(key);
  if (window === null || now - window.windowStart >= windowMs) return;
  if (window.count >= limit) {
    const retryAfter = Math.ceil((window.windowStart + windowMs - now) / 1000);
    throw new AuthError(message, 429, Math.max(1, retryAfter));
  }
}

async function countAttempt(
  store: AuthStore,
  key: string,
  windowMs: number,
  now: number,
): Promise<void> {
  const window = await store.attempts(key);
  if (window === null || now - window.windowStart >= windowMs) {
    await store.setAttempts(key, { windowStart: now, count: 1 });
  } else {
    await store.setAttempts(key, { windowStart: window.windowStart, count: window.count + 1 });
  }
}

const TOO_MANY_LOGINS = 'Too many failed sign-ins. Wait a minute and try again.';

// ── Operations ──────────────────────────────────────────────────────────────

async function startSession(
  store: AuthStore,
  user: { id: string; username: string },
  context: RequestContext,
): Promise<NewSession> {
  const token = newToken();
  const expiresAt = context.now + SESSION_TTL_MS;
  await store.createSession({
    tokenHash: await sha256Hex(token),
    userId: user.id,
    createdAt: context.now,
    lastSeenAt: context.now,
    expiresAt,
    userAgent: context.userAgent.slice(0, 200),
  });
  return { token, user: { id: user.id, username: user.username }, expiresAt };
}

export async function signUp(
  store: AuthStore,
  body: unknown,
  context: RequestContext,
): Promise<NewSession> {
  const { username: rawName, proof: rawProof } = (body ?? {}) as Record<string, unknown>;
  const ipKey = `signup:ip:${context.ip}`;

  await assertUnderLimit(
    store,
    ipKey,
    SIGNUPS_PER_IP,
    SIGNUP_WINDOW_MS,
    context.now,
    'Too many new accounts from this network. Try again later.',
  );
  await countAttempt(store, ipKey, SIGNUP_WINDOW_MS, context.now);

  const username = normalizeUsername(rawName);
  const proof = parseProof(rawProof);

  const user: UserRow = {
    id: toHex(randomBytes(16)),
    username,
    authHash: await sha256Hex(proof),
    createdAt: context.now,
    disabled: false,
  };
  if (!(await store.createUser(user))) {
    throw new AuthError('That username is taken.', 409);
  }
  return startSession(store, user, context);
}

export async function logIn(
  store: AuthStore,
  body: unknown,
  context: RequestContext,
): Promise<NewSession> {
  const { username: rawName, proof: rawProof } = (body ?? {}) as Record<string, unknown>;
  const username = normalizeUsername(rawName);
  const proof = parseProof(rawProof);

  const userKey = `login:user:${username}`;
  const ipKey = `login:ip:${context.ip}`;
  await assertUnderLimit(
    store,
    userKey,
    LOGIN_FAILURES_PER_USER,
    LOGIN_WINDOW_MS,
    context.now,
    TOO_MANY_LOGINS,
  );
  await assertUnderLimit(
    store,
    ipKey,
    LOGIN_FAILURES_PER_IP,
    LOGIN_WINDOW_MS,
    context.now,
    TOO_MANY_LOGINS,
  );

  const user = await store.userByName(username);
  const matches = constantTimeEqual(await sha256Hex(proof), user?.authHash ?? DUMMY_HASH);

  if (user === null || !matches) {
    await countAttempt(store, userKey, LOGIN_WINDOW_MS, context.now);
    await countAttempt(store, ipKey, LOGIN_WINDOW_MS, context.now);
    throw new AuthError('Wrong username or password.', 401);
  }
  if (user.disabled) throw new AuthError('This account is disabled.', 403);

  await store.clearAttempts(userKey);
  // Opportunistic tidy-up: logins are rare enough that this costs nothing.
  await store.deleteExpiredSessions(context.now);
  return startSession(store, user, context);
}

/** Who holds this cookie token, or null. Slides the expiry when due. */
export async function authenticate(
  store: AuthStore,
  token: string | null,
  now: number,
): Promise<Authenticated | null> {
  if (token === null || token.length === 0 || token.length > 100) return null;
  const tokenHash = await sha256Hex(token);
  const session = await store.session(tokenHash);
  if (session === null) return null;

  if (session.expiresAt <= now) {
    await store.deleteSession(tokenHash);
    return null;
  }

  const user = await store.userById(session.userId);
  if (user === null || user.disabled) return null;

  const result: Authenticated = { user: { id: user.id, username: user.username }, tokenHash };
  if (now - session.lastSeenAt >= SESSION_SLIDE_AFTER_MS) {
    const expiresAt = now + SESSION_TTL_MS;
    await store.touchSession(tokenHash, now, expiresAt);
    result.renewedUntil = expiresAt;
  }
  return result;
}

export async function logOut(store: AuthStore, auth: Authenticated): Promise<void> {
  await store.deleteSession(auth.tokenHash);
}

/** Every session but this one. */
export async function logOutOthers(store: AuthStore, auth: Authenticated): Promise<void> {
  await store.deleteUserSessions(auth.user.id, auth.tokenHash);
}

/**
 * Change password: the current proof must match, and every OTHER session ends
 * — the point of changing a password is usually that someone else has it.
 */
export async function changePassword(
  store: AuthStore,
  auth: Authenticated,
  body: unknown,
  context: RequestContext,
): Promise<void> {
  const { currentProof: rawCurrent, newProof: rawNew } = (body ?? {}) as Record<string, unknown>;
  const current = parseProof(rawCurrent);
  const next = parseProof(rawNew);

  const userKey = `login:user:${auth.user.username}`;
  await assertUnderLimit(
    store,
    userKey,
    LOGIN_FAILURES_PER_USER,
    LOGIN_WINDOW_MS,
    context.now,
    TOO_MANY_LOGINS,
  );

  const user = await store.userById(auth.user.id);
  if (user === null || !constantTimeEqual(await sha256Hex(current), user.authHash)) {
    await countAttempt(store, userKey, LOGIN_WINDOW_MS, context.now);
    throw new AuthError('Current password is wrong.', 401);
  }

  await store.setAuthHash(user.id, await sha256Hex(next));
  await store.deleteUserSessions(user.id, auth.tokenHash);
}

// ── In-memory store, for tests ──────────────────────────────────────────────

export class MemoryAuthStore implements AuthStore {
  readonly users = new Map<string, UserRow>();
  readonly sessions = new Map<string, SessionRow>();
  readonly attemptWindows = new Map<string, AttemptWindow>();

  async userByName(username: string) {
    return [...this.users.values()].find((user) => user.username === username) ?? null;
  }
  async userById(id: string) {
    return this.users.get(id) ?? null;
  }
  async createUser(user: UserRow) {
    if (await this.userByName(user.username)) return false;
    this.users.set(user.id, { ...user });
    return true;
  }
  async setAuthHash(userId: string, authHash: string) {
    const user = this.users.get(userId);
    if (user) user.authHash = authHash;
  }
  async createSession(session: SessionRow) {
    this.sessions.set(session.tokenHash, { ...session });
  }
  async session(tokenHash: string) {
    return this.sessions.get(tokenHash) ?? null;
  }
  async touchSession(tokenHash: string, lastSeenAt: number, expiresAt: number) {
    const session = this.sessions.get(tokenHash);
    if (session) Object.assign(session, { lastSeenAt, expiresAt });
  }
  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }
  async deleteUserSessions(userId: string, except?: string) {
    for (const [hash, session] of this.sessions) {
      if (session.userId === userId && hash !== except) this.sessions.delete(hash);
    }
  }
  async deleteExpiredSessions(now: number) {
    for (const [hash, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(hash);
    }
  }
  async attempts(key: string) {
    return this.attemptWindows.get(key) ?? null;
  }
  async setAttempts(key: string, window: AttemptWindow) {
    this.attemptWindows.set(key, { ...window });
  }
  async clearAttempts(key: string) {
    this.attemptWindows.delete(key);
  }
}
