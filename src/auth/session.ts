/**
 * Who is signed in on this device, and the calls that change it. PLAN.md §11.
 *
 * The session itself is an HttpOnly cookie this code can never read — that is
 * the point of HttpOnly. So "am I signed in?" is answered by asking the server
 * (`/api/auth/me`), and when there is no connection, by trusting the account
 * that owns the local data: the app is offline-first and must open on a train.
 *
 * **One device, one account's data.** IndexedDB holds a single account's copy.
 * `syncMeta.owner` records whose; signing out erases the whole database, so the
 * next person to sign in starts empty. Data on a device from before accounts
 * existed has no owner, and the person who signs in is asked whether to keep
 * it or erase it — it could be anyone's.
 */

import { db } from '@/db/schema';
import { SYNC_TABLE_NAMES } from '@/domain/sync';
import { loginProof } from '@/auth/derive';

// ── State ───────────────────────────────────────────────────────────────────

export type AuthState =
  | { status: 'checking' }
  | {
      status: 'signedOut';
      /** Prefill: the account whose data is on this device, if any. */
      lastUser?: string;
      /** Why we are here, when it was not a deliberate sign-out. */
      reason?: string;
    }
  | {
      /** Signed in, but the device holds data that is not (known to be) theirs. */
      status: 'claim';
      username: string;
      /** Undefined: data from before accounts. A name: another account's data. */
      otherOwner?: string;
      pending: number;
    }
  | { status: 'signedIn'; username: string; offline: boolean };

let state: AuthState = { status: 'checking' };
const listeners = new Set<() => void>();

function setState(next: AuthState) {
  state = next;
  for (const listener of listeners) listener();
}

/** For `useSyncExternalStore`. */
export function subscribeAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAuthState(): AuthState {
  return state;
}

// ── Server calls ────────────────────────────────────────────────────────────

/** The request never reached the server. */
export class OfflineError extends Error {
  constructor() {
    super('No connection. Check your signal and try again.');
    this.name = 'OfflineError';
  }
}

async function post(path: string, body: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      credentials: 'same-origin',
    });
  } catch {
    throw new OfflineError();
  }
  const parsed: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (parsed as { error?: unknown } | null)?.error;
    throw new Error(typeof message === 'string' ? message : `Request failed (${response.status}).`);
  }
  return parsed;
}

// ── Local ownership ─────────────────────────────────────────────────────────

async function localOwner(): Promise<string | undefined> {
  return (await db.syncMeta.get('sync'))?.owner;
}

/** Whether this device holds anything a person entered (seeded defaults do not count). */
async function hasUserData(): Promise<boolean> {
  if ((await db.syncMeta.get('sync')) !== undefined) return true;
  for (const name of SYNC_TABLE_NAMES) {
    if (name === 'targets' || name === 'settings') continue;
    if ((await db.table(name).count()) > 0) return true;
  }
  return false;
}

async function setOwner(username: string): Promise<void> {
  await db.transaction('rw', db.syncMeta, async () => {
    const meta = await db.syncMeta.get('sync');
    await db.syncMeta.put({
      ...(meta ?? { id: 'sync' as const, cursor: 0, firstPassDone: false }),
      owner: username,
    });
  });
}

/** Decide what the newly signed-in user sees: their data, or a question. */
async function arrive(username: string, offline: boolean): Promise<void> {
  const owner = await localOwner();
  if (owner === username) {
    setState({ status: 'signedIn', username, offline });
    return;
  }
  if (owner === undefined && !(await hasUserData())) {
    await setOwner(username);
    setState({ status: 'signedIn', username, offline });
    return;
  }
  setState({
    status: 'claim',
    username,
    ...(owner === undefined ? {} : { otherOwner: owner }),
    pending: await db.syncOutbox.count(),
  });
}

/** Keep the pre-accounts data on this device, as the signed-in user's. */
export async function keepLocalData(): Promise<void> {
  if (state.status !== 'claim' || state.otherOwner !== undefined) return;
  await setOwner(state.username);
  setState({ status: 'signedIn', username: state.username, offline: false });
}

/** Back out of a sign-in rather than erase someone else's data. */
export async function cancelClaim(): Promise<void> {
  if (state.status !== 'claim') return;
  const owner = state.otherOwner;
  await post('/api/auth/logout', {}).catch(() => undefined);
  setState({ status: 'signedOut', ...(owner === undefined ? {} : { lastUser: owner }) });
}

/**
 * Erase everything on this device and start the app again. The server copy is
 * untouched. Reloading is the simplest way to be sure nothing in memory —
 * live queries, the sync engine — still holds the old data.
 */
export async function eraseThisDevice(): Promise<void> {
  db.close();
  await db.delete();
  window.location.reload();
}

// ── Entry points ────────────────────────────────────────────────────────────

/** On app start: are we signed in? */
export async function checkSession(): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
  } catch {
    // Offline. Trust the account that owns the local data, if any.
    const owner = await localOwner();
    if (owner !== undefined) setState({ status: 'signedIn', username: owner, offline: true });
    else setState({ status: 'signedOut', reason: 'You are offline. Connect to sign in.' });
    return;
  }

  if (response.ok) {
    const { username } = (await response.json()) as { username: string };
    await arrive(username, false);
    return;
  }

  const owner = await localOwner();
  setState({
    status: 'signedOut',
    ...(owner === undefined ? {} : { lastUser: owner }),
    ...(response.status === 401
      ? {}
      : { reason: `The server could not check your sign-in (${response.status}).` }),
  });
}

export async function signIn(
  mode: 'login' | 'signup',
  username: string,
  password: string,
): Promise<void> {
  const proof = await loginProof(username, password);
  const result = (await post(`/api/auth/${mode}`, { username, proof })) as { username: string };
  await arrive(result.username, false);
}

/** The server said this device's session is gone (expired, signed out elsewhere, reset). */
export async function sessionEnded(): Promise<void> {
  if (state.status !== 'signedIn') return;
  setState({
    status: 'signedOut',
    lastUser: state.username,
    reason: 'You were signed out. Sign in again to keep syncing.',
  });
}

/** Sign out: end the session on the server, then erase this device's copy. */
export async function signOut(): Promise<void> {
  await post('/api/auth/logout', {});
  await eraseThisDevice();
}

export async function signOutOtherDevices(): Promise<void> {
  await post('/api/auth/logout-others', {});
}

export async function changePassword(current: string, next: string): Promise<void> {
  if (state.status !== 'signedIn') throw new Error('Sign in first.');
  // One after the other: each Argon2id run takes 64 MiB, and two at once is
  // a lot to ask of a phone.
  const currentProof = await loginProof(state.username, current);
  const newProof = await loginProof(state.username, next);
  await post('/api/auth/password', { currentProof, newProof });
}
