import { describe, expect, it } from 'vitest';

import {
  AuthError,
  LOGIN_FAILURES_PER_IP,
  LOGIN_FAILURES_PER_USER,
  LOGIN_WINDOW_MS,
  MemoryAuthStore,
  SESSION_SLIDE_AFTER_MS,
  SESSION_TTL_MS,
  SIGNUPS_PER_IP,
  authenticate,
  changePassword,
  constantTimeEqual,
  logIn,
  logOut,
  logOutOthers,
  normalizeUsername,
  parseProof,
  sha256Hex,
  signUp,
} from './authLogic';

/** A login proof is base64 of 32 bytes; `fill` makes distinct ones. */
const proof = (fill: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));
const RIGHT = proof(1);
const WRONG = proof(2);

const ctx = (overrides: Partial<{ ip: string; now: number }> = {}) => ({
  ip: '203.0.113.7',
  userAgent: 'test',
  now: 1_000_000,
  ...overrides,
});

async function expectAuthError(promise: Promise<unknown>, status: number) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AuthError);
  expect((error as AuthError).status).toBe(status);
  return error as AuthError;
}

describe('input checks', () => {
  it('lowercases usernames, so Duncan and duncan are one account', () => {
    expect(normalizeUsername('  Duncan ')).toBe('duncan');
  });

  it.each(['ab', 'a'.repeat(33), '_lead', 'has space', 'semi;colon', 42])(
    'rejects the username %s',
    (raw) => {
      expect(() => normalizeUsername(raw)).toThrow(AuthError);
    },
  );

  it('accepts only a 32-byte proof', () => {
    expect(parseProof(RIGHT)).toHaveLength(32);
    expect(() => parseProof(btoa('short'))).toThrow(AuthError);
    expect(() => parseProof('not base64!')).toThrow(AuthError);
    expect(() => parseProof(undefined)).toThrow(AuthError);
  });

  it('compares hashes without short-circuiting', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'ab')).toBe(false);
  });
});

describe('sign-up and login', () => {
  it('stores only a hash of the proof, never the proof itself', async () => {
    const store = new MemoryAuthStore();
    await signUp(store, { username: 'duncan', proof: RIGHT }, ctx());
    const [user] = [...store.users.values()];
    expect(user?.authHash).toBe(await sha256Hex(parseProof(RIGHT)));
    expect(JSON.stringify(user)).not.toContain(RIGHT);
  });

  it('stores only a hash of the session token', async () => {
    const store = new MemoryAuthStore();
    const { token } = await signUp(store, { username: 'duncan', proof: RIGHT }, ctx());
    expect(store.sessions.has(token)).toBe(false);
    expect(store.sessions.has(await sha256Hex(token))).toBe(true);
  });

  it('refuses a taken username, whatever its case', async () => {
    const store = new MemoryAuthStore();
    await signUp(store, { username: 'duncan', proof: RIGHT }, ctx());
    await expectAuthError(signUp(store, { username: 'DUNCAN', proof: WRONG }, ctx()), 409);
  });

  it('logs in with the right proof', async () => {
    const store = new MemoryAuthStore();
    await signUp(store, { username: 'duncan', proof: RIGHT }, ctx());
    const session = await logIn(store, { username: 'Duncan', proof: RIGHT }, ctx());
    expect(session.user.username).toBe('duncan');
  });

  it('gives the SAME answer for a wrong password and an unknown user', async () => {
    const store = new MemoryAuthStore();
    await signUp(store, { username: 'duncan', proof: RIGHT }, ctx());
    const wrong = await expectAuthError(
      logIn(store, { username: 'duncan', proof: WRONG }, ctx()),
      401,
    );
    const unknown = await expectAuthError(
      logIn(store, { username: 'nobody', proof: RIGHT }, ctx()),
      401,
    );
    expect(wrong.message).toBe(unknown.message);
  });

  it('refuses a disabled account even with the right password', async () => {
    const store = new MemoryAuthStore();
    const { user } = await signUp(store, { username: 'duncan', proof: RIGHT }, ctx());
    store.users.get(user.id)!.disabled = true;
    await expectAuthError(logIn(store, { username: 'duncan', proof: RIGHT }, ctx()), 403);
  });
});

describe('rate limits', () => {
  it(`locks a username after ${LOGIN_FAILURES_PER_USER} failures a minute — even for the right password`, async () => {
    const store = new MemoryAuthStore();
    await signUp(store, { username: 'duncan', proof: RIGHT }, ctx());
    for (let i = 0; i < LOGIN_FAILURES_PER_USER; i += 1) {
      // A different IP each time: the per-user limit must hold on its own.
      await expectAuthError(
        logIn(store, { username: 'duncan', proof: WRONG }, ctx({ ip: `10.0.0.${i}` })),
        401,
      );
    }
    const locked = await expectAuthError(
      logIn(store, { username: 'duncan', proof: RIGHT }, ctx()),
      429,
    );
    expect(locked.retryAfterSeconds).toBeGreaterThan(0);

    // A minute later it opens again.
    const later = ctx({ now: ctx().now + LOGIN_WINDOW_MS });
    await expect(logIn(store, { username: 'duncan', proof: RIGHT }, later)).resolves.toBeDefined();
  });

  it(`locks an IP after ${LOGIN_FAILURES_PER_IP} failures a minute across many usernames`, async () => {
    const store = new MemoryAuthStore();
    await signUp(store, { username: 'duncan', proof: RIGHT }, ctx({ ip: 'elsewhere' }));
    for (let i = 0; i < LOGIN_FAILURES_PER_IP; i += 1) {
      await expectAuthError(logIn(store, { username: `guess${i}`, proof: WRONG }, ctx()), 401);
    }
    await expectAuthError(logIn(store, { username: 'duncan', proof: RIGHT }, ctx()), 429);
  });

  it('clears the username count after a successful login', async () => {
    const store = new MemoryAuthStore();
    await signUp(store, { username: 'duncan', proof: RIGHT }, ctx());
    for (let i = 0; i < LOGIN_FAILURES_PER_USER - 1; i += 1) {
      await expectAuthError(logIn(store, { username: 'duncan', proof: WRONG }, ctx()), 401);
    }
    await logIn(store, { username: 'duncan', proof: RIGHT }, ctx());
    await expectAuthError(logIn(store, { username: 'duncan', proof: WRONG }, ctx()), 401);
  });

  it(`allows ${SIGNUPS_PER_IP} sign-ups per IP per hour`, async () => {
    const store = new MemoryAuthStore();
    for (let i = 0; i < SIGNUPS_PER_IP; i += 1) {
      await signUp(store, { username: `user${i}`, proof: RIGHT }, ctx());
    }
    await expectAuthError(signUp(store, { username: 'onemore', proof: RIGHT }, ctx()), 429);
  });
});

describe('sessions', () => {
  async function signedIn() {
    const store = new MemoryAuthStore();
    const session = await signUp(store, { username: 'duncan', proof: RIGHT }, ctx());
    return { store, session };
  }

  it('recognises its own token and nothing else', async () => {
    const { store, session } = await signedIn();
    expect((await authenticate(store, session.token, ctx().now))?.user.username).toBe('duncan');
    expect(await authenticate(store, 'forged', ctx().now)).toBeNull();
    expect(await authenticate(store, null, ctx().now)).toBeNull();
  });

  it('expires after 30 days unused', async () => {
    const { store, session } = await signedIn();
    expect(await authenticate(store, session.token, ctx().now + SESSION_TTL_MS)).toBeNull();
  });

  it('extends when used, at most once a day', async () => {
    const { store, session } = await signedIn();
    const soon = await authenticate(store, session.token, ctx().now + 1000);
    expect(soon?.renewedUntil).toBeUndefined();

    const nextDay = ctx().now + SESSION_SLIDE_AFTER_MS;
    const renewed = await authenticate(store, session.token, nextDay);
    expect(renewed?.renewedUntil).toBe(nextDay + SESSION_TTL_MS);
    // Still valid past the ORIGINAL expiry.
    expect(await authenticate(store, session.token, ctx().now + SESSION_TTL_MS + 1)).not.toBeNull();
  });

  it('ends on logout', async () => {
    const { store, session } = await signedIn();
    const auth = (await authenticate(store, session.token, ctx().now))!;
    await logOut(store, auth);
    expect(await authenticate(store, session.token, ctx().now)).toBeNull();
  });

  it('"sign out everywhere else" keeps only the current session', async () => {
    const { store, session: phone } = await signedIn();
    const laptop = await logIn(store, { username: 'duncan', proof: RIGHT }, ctx());
    const auth = (await authenticate(store, laptop.token, ctx().now))!;
    await logOutOthers(store, auth);
    expect(await authenticate(store, phone.token, ctx().now)).toBeNull();
    expect(await authenticate(store, laptop.token, ctx().now)).not.toBeNull();
  });

  it('stops working the moment an account is disabled', async () => {
    const { store, session } = await signedIn();
    store.users.get(session.user.id)!.disabled = true;
    expect(await authenticate(store, session.token, ctx().now)).toBeNull();
  });
});

describe('changing password', () => {
  it('needs the current password, then ends every other session', async () => {
    const store = new MemoryAuthStore();
    const phone = await signUp(store, { username: 'duncan', proof: RIGHT }, ctx());
    const laptop = await logIn(store, { username: 'duncan', proof: RIGHT }, ctx());
    const auth = (await authenticate(store, laptop.token, ctx().now))!;

    await expectAuthError(
      changePassword(store, auth, { currentProof: WRONG, newProof: proof(3) }, ctx()),
      401,
    );

    await changePassword(store, auth, { currentProof: RIGHT, newProof: proof(3) }, ctx());
    expect(await authenticate(store, phone.token, ctx().now)).toBeNull();
    expect(await authenticate(store, laptop.token, ctx().now)).not.toBeNull();
    await expectAuthError(logIn(store, { username: 'duncan', proof: RIGHT }, ctx()), 401);
    await expect(
      logIn(store, { username: 'duncan', proof: proof(3) }, ctx()),
    ).resolves.toBeDefined();
  });
});
