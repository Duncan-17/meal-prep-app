/**
 * Sync — the Dexie side. The rules are in `domain/sync.ts` (client) and
 * `worker/syncLogic.ts` (server); this file moves rows between them.
 *
 * One cycle:
 *
 *   1. **Rekey.** Any row still carrying an id from IndexedDB's own 1, 2, 3…
 *      counter is renumbered, references and all, so two devices' data can
 *      share one database. Happens once per device, and again only if an old
 *      backup is restored.
 *   2. **Detect.** Diff every synced table against the fingerprints of what
 *      was last synced; edits and deletions go into the outbox, stamped with
 *      when they were noticed. Runs offline too, so the stamp is close to
 *      when the edit was made even if the upload happens hours later.
 *   3. **Push** the outbox. The server keeps whichever version is newer.
 *   4. **Pull** everything the server has written since this device's cursor,
 *      unless this device holds a newer un-uploaded edit of the same row.
 *
 * Offline is not an error: every step but push and pull is local, and the
 * outbox simply waits. The app never blocks on any of this.
 */

import Dexie from 'dexie';

import { db as appDb, type MealPrepDatabase, type SyncOutboxRow } from '@/db/schema';
import {
  SYNC_TABLE_NAMES,
  SYNC_TABLES,
  createIdGenerator,
  detectChanges,
  isLegacyId,
  localKey,
  ownTimestamp,
  recordKey,
  rekeyLegacyIds,
  rowFingerprint,
  shouldApplyRemote,
  type SyncRecord,
} from '@/domain/sync';

// ── Transport ───────────────────────────────────────────────────────────────

export interface PullResult {
  records: SyncRecord[];
  cursor: number;
  more: boolean;
}

export interface SyncTransport {
  push(changes: readonly SyncRecord[]): Promise<void>;
  pull(since: number): Promise<PullResult>;
}

/** The server answered, but has no database bound — sync is not set up. */
export class SyncUnconfiguredError extends Error {
  constructor() {
    super('Sync is not configured on the server yet.');
    this.name = 'SyncUnconfiguredError';
  }
}

/** The server no longer accepts this device's session (PLAN.md §11). */
export class SyncSignedOutError extends Error {
  constructor() {
    super('Signed out.');
    this.name = 'SyncSignedOutError';
  }
}

/** The request never reached the server — no signal, or the server is down. */
export class SyncOfflineError extends Error {
  constructor() {
    super('No connection to the server.');
    this.name = 'SyncOfflineError';
  }
}

export const httpTransport: SyncTransport = {
  async push(changes) {
    await request('/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ changes }),
    });
  },
  async pull(since) {
    return (await request(`/api/sync?since=${since}`)) as PullResult;
  },
};

async function request(url: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    // Never answered from a cache: see NO_STORE in worker/index.ts.
    response = await fetch(url, { ...init, cache: 'no-store', credentials: 'same-origin' });
  } catch {
    throw new SyncOfflineError();
  }
  if (response.status === 401) throw new SyncSignedOutError();
  if (response.status === 503) throw new SyncUnconfiguredError();
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (body as { error?: unknown } | null)?.error;
    throw new Error(typeof message === 'string' ? message : `Sync failed (${response.status}).`);
  }
  return body;
}

/** What the database holds — for the "Sync details" panel. */
export interface ServerStats {
  records: number;
  deleted: number;
  latestRev: number;
}

export async function fetchServerStats(): Promise<ServerStats> {
  return (await request('/api/sync?stats=1')) as ServerStats;
}

// ── Engine ──────────────────────────────────────────────────────────────────

/** Changes per upload. The server takes up to 500; smaller keeps requests quick. */
const PUSH_CHUNK = 200;

export interface SyncEngine {
  /** Renumber legacy ids. Returns whether anything changed. */
  rekey(): Promise<boolean>;
  /** Scan for local changes into the outbox. Returns how many were found. */
  detect(tables?: readonly string[]): Promise<number>;
  push(): Promise<number>;
  /** Apply server changes. Returns how many rows were written locally. */
  pull(): Promise<number>;
  /** All four steps, never two at once. */
  syncOnce(): Promise<void>;
  pending(): Promise<number>;
}

export function createSyncEngine(
  db: MealPrepDatabase,
  transport: SyncTransport,
  now: () => number = Date.now,
): SyncEngine {
  const syncTables = () => SYNC_TABLE_NAMES.map((name) => db.table(name));
  const bookkeeping = () => [db.syncShadow, db.syncOutbox, db.syncMeta];
  const newId = createIdGenerator(now);
  let running: Promise<void> = Promise.resolve();

  async function meta() {
    return (
      (await db.syncMeta.get('sync')) ?? { id: 'sync' as const, cursor: 0, firstPassDone: false }
    );
  }

  async function rekey(): Promise<boolean> {
    return db.transaction('rw', syncTables(), async () => {
      const autoTables = SYNC_TABLE_NAMES.filter((name) => SYNC_TABLES[name]?.autoId === true);

      // Cheap check first: the lowest key of each table. Keys sort numerically,
      // so if the first is not legacy, none are.
      let anyLegacy = false;
      for (const name of autoTables) {
        const first = await db.table(name).orderBy(':id').first();
        const key = first === undefined ? undefined : (first as Record<string, unknown>).id;
        if (isLegacyId(key)) anyLegacy = true;
      }
      if (!anyLegacy) return false;

      const data: Record<string, unknown[]> = {};
      for (const name of SYNC_TABLE_NAMES) data[name] = await db.table(name).toArray();
      const result = rekeyLegacyIds(data, newId);
      if (!result.changed) return false;

      // Only auto-id tables hold ids or references to them.
      for (const name of autoTables) {
        await db.table(name).clear();
        await db.table(name).bulkPut(result.data[name] ?? []);
      }
      return true;
    });
  }

  async function detect(tables: readonly string[] = SYNC_TABLE_NAMES): Promise<number> {
    const names = tables.filter((name) => name in SYNC_TABLES);
    if (names.length === 0) return 0;

    return db.transaction(
      'rw',
      [...names.map((name) => db.table(name)), ...bookkeeping()],
      async () => {
        const state = await meta();
        const at = now();
        // First scan on this device: stamp rows with their OWN time, so its
        // untouched defaults lose to real edits already in the database.
        const stamp = state.firstPassDone ? () => at : ownTimestamp;

        const shadow = new Map(
          (await db.syncShadow.toArray()).map((row) => [row.key, row.print] as const),
        );

        let found = 0;
        for (const name of names) {
          const rows = await db.table(name).toArray();
          const { changes, fingerprints } = detectChanges(name, rows, shadow, stamp, at);
          if (changes.length === 0) continue;
          found += changes.length;

          await db.syncOutbox.bulkPut(
            changes.map((change) => ({ ...change, key: recordKey(change.tbl, change.id) })),
          );
          const kept = [...fingerprints].filter(
            (entry): entry is [string, string] => entry[1] !== null,
          );
          const dropped = [...fingerprints].filter(([, print]) => print === null).map(([k]) => k);
          await db.syncShadow.bulkPut(kept.map(([key, print]) => ({ key, print })));
          await db.syncShadow.bulkDelete(dropped);
        }

        if (!state.firstPassDone && names.length === SYNC_TABLE_NAMES.length) {
          await db.syncMeta.put({ ...state, firstPassDone: true });
        }
        return found;
      },
    );
  }

  async function push(): Promise<number> {
    const outbox = await db.syncOutbox.toArray();
    let sent = 0;
    for (let start = 0; start < outbox.length; start += PUSH_CHUNK) {
      const chunk = outbox.slice(start, start + PUSH_CHUNK);
      await transport.push(chunk.map(toRecord));
      // Clear only entries untouched since they were read — an edit made
      // while the request was in flight must stay queued.
      await db.transaction('rw', db.syncOutbox, async () => {
        for (const entry of chunk) {
          const current = await db.syncOutbox.get(entry.key);
          if (current !== undefined && current.updatedAt === entry.updatedAt) {
            await db.syncOutbox.delete(entry.key);
          }
        }
      });
      sent += chunk.length;
    }
    return sent;
  }

  async function pull(): Promise<number> {
    let applied = 0;
    let more = true;
    while (more) {
      const state = await meta();
      const page = await transport.pull(state.cursor);
      more = page.more && page.records.length > 0;

      await db.transaction('rw', [...syncTables(), ...bookkeeping()], async () => {
        for (const record of page.records) {
          if (!(record.tbl in SYNC_TABLES)) continue; // a table this build does not know
          const key = recordKey(record.tbl, record.id);
          const pending = await db.syncOutbox.get(key);
          if (!shouldApplyRemote(record, pending?.updatedAt)) continue;

          const table = db.table(record.tbl);
          if (record.deleted) {
            await table.delete(localKey(record.tbl, record.id));
            await db.syncShadow.delete(key);
          } else {
            await table.put(record.data);
            // The shadow learns the row as written, so the next scan does not
            // mistake a download for a local edit and send it straight back.
            await db.syncShadow.put({ key, print: rowFingerprint(record.data) });
          }
          if (pending !== undefined) await db.syncOutbox.delete(key);
          applied += 1;
        }
        await db.syncMeta.put({ ...(await meta()), cursor: page.cursor, lastSyncedAt: now() });
      });
    }
    return applied;
  }

  function syncOnce(): Promise<void> {
    const cycle = running.then(async () => {
      await rekey();
      await detect();
      await push();
      await pull();
    });
    // The chain survives a failed cycle; the caller still sees the failure.
    running = cycle.catch(() => undefined);
    return cycle;
  }

  return {
    rekey,
    detect,
    push,
    pull,
    syncOnce,
    pending: () => db.syncOutbox.count(),
  };
}

function toRecord(entry: SyncOutboxRow): SyncRecord {
  return {
    tbl: entry.tbl,
    id: entry.id,
    data: entry.data,
    updatedAt: entry.updatedAt,
    deleted: entry.deleted,
  };
}

// ── Running it in the app ───────────────────────────────────────────────────

export type SyncState = 'idle' | 'syncing' | 'offline' | 'unconfigured' | 'signedOut' | 'error';

export interface SyncStatus {
  state: SyncState;
  /** Changes made here and not yet uploaded. */
  pending: number;
  lastSyncedAt?: number;
  error?: string;
}

let status: SyncStatus = { state: 'idle', pending: 0 };
const listeners = new Set<() => void>();

function setStatus(next: Partial<SyncStatus>) {
  status = { ...status, ...next };
  for (const listener of listeners) listener();
}

/** For `useSyncExternalStore`. */
export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSyncStatus(): SyncStatus {
  return status;
}

/** How often to pull while the app is open and visible. */
const PULL_EVERY_MS = 30_000;
/** Before sync is set up, check rarely — there is nothing to gain from asking often. */
const UNCONFIGURED_EVERY_MS = 5 * 60_000;
/** Pause after an edit before scanning, so a burst of edits is one scan. */
const EDIT_DEBOUNCE_MS = 1_200;

let engine: SyncEngine | null = null;

/**
 * Forget how far this device has downloaded, and fetch everything again.
 *
 * Safe: a download never overwrites a newer un-uploaded local edit, and
 * re-applying a row this device already has changes nothing. The repair for
 * a device that says "synced" yet is missing what the database holds.
 */
export async function redownloadEverything(): Promise<void> {
  await appDb.transaction('rw', appDb.syncMeta, async () => {
    const meta = await appDb.syncMeta.get('sync');
    // Spread, so `owner` and anything added later survive.
    await appDb.syncMeta.put({
      ...(meta ?? { id: 'sync' as const, firstPassDone: false }),
      cursor: 0,
    });
  });
  await syncNow();
}

const signedOutListeners = new Set<() => void>();

/** Called when the server rejects this device's session. */
export function onSyncSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener);
  return () => signedOutListeners.delete(listener);
}

/** After signing back in: pick up where sync left off. */
export function resumeSync(): void {
  if (status.state !== 'signedOut') return;
  setStatus({ state: 'idle' });
  void syncNow();
}

/** Run a full cycle now — the "Sync now" button, and every trigger below. */
export async function syncNow(): Promise<void> {
  // Nothing to do until someone signs in again; edits wait in the outbox.
  if (engine === null || status.state === 'signedOut') return;
  setStatus({ state: 'syncing' });
  try {
    await engine.syncOnce();
    const meta = await appDb.syncMeta.get('sync');
    setStatus({
      state: 'idle',
      pending: await engine.pending(),
      ...(meta?.lastSyncedAt === undefined ? {} : { lastSyncedAt: meta.lastSyncedAt }),
    });
  } catch (error) {
    const pending = await engine.pending().catch(() => status.pending);
    if (error instanceof SyncOfflineError) setStatus({ state: 'offline', pending });
    else if (error instanceof SyncUnconfiguredError) setStatus({ state: 'unconfigured', pending });
    else if (error instanceof SyncSignedOutError) {
      setStatus({ state: 'signedOut', pending });
      for (const listener of signedOutListeners) listener();
    } else setStatus({ state: 'error', pending, error: String(error) });
  }
}

/**
 * Start syncing for the life of the page. Call once, after defaults exist.
 *
 * Triggers: on start; on regaining a connection or focus; every 30 s while
 * visible; and shortly after any edit — which only scans locally, and goes to
 * the network only if the scan found something to upload. That last part is
 * what stops sync's own downloads from triggering endless further cycles.
 */
export function startSync(): void {
  if (engine !== null) return;
  engine = createSyncEngine(appDb, httpTransport);
  const active = engine;

  void syncNow();

  let timer: ReturnType<typeof setTimeout> | null = null;
  const dirty = new Set<string>();
  const prefix = `idb://${appDb.name}/`;

  Dexie.on('storagemutated', (parts) => {
    for (const part of Object.keys(parts)) {
      if (!part.startsWith(prefix)) continue;
      const table = part.slice(prefix.length).split('/')[0] ?? '';
      if (table in SYNC_TABLES) dirty.add(table);
    }
    if (dirty.size === 0) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      const tables = [...dirty];
      dirty.clear();
      void active
        .detect(tables)
        .then(async (found) => {
          if (found > 0) await syncNow();
          else setStatus({ pending: await active.pending() });
        })
        .catch(() => undefined);
    }, EDIT_DEBOUNCE_MS);
  });

  window.addEventListener('online', () => void syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });

  const tick = () => {
    const wait = status.state === 'unconfigured' ? UNCONFIGURED_EVERY_MS : PULL_EVERY_MS;
    setTimeout(() => {
      if (document.visibilityState === 'visible') void syncNow().finally(tick);
      else tick();
    }, wait);
  };
  tick();
}
