/**
 * The server's half of sync — the rules, independent of where rows are kept.
 *
 * Every row of every synced table is one record keyed by (user, table, id), holding
 * the row as JSON, when it was last changed, whether it is a tombstone, and a
 * `rev`: a number that only goes up, assigned on every accepted write. A
 * device remembers the highest rev it has seen and asks for everything after
 * it, which is the whole pull protocol.
 *
 * The rule for a write: it replaces what is stored only if it is STRICTLY
 * newer. Later edit wins (PLAN.md §10 "Storage"); on a tie, what was there
 * first stays — which is what lets a fresh phone's untouched default goals,
 * stamped 0, lose to goals already uploaded from the laptop.
 *
 * **Every operation takes the user id** (since 2026-11-04, PLAN.md §11), and the
 * user is part of the KEY, not just a filter: a push naming another user's
 * (table, id) creates a row in the pusher's own space instead of overwriting
 * theirs. The rev counter stays global — it only has to go up — and a pull
 * returns only the caller's rows above their cursor.
 *
 * **Untrusted input (2026-11-04, PLAN.md §11 step 2).** A push is checked
 * whole before anything is written: known table, an id of plain characters,
 * a timestamp that is not in the future (a record stamped year 9999 would win
 * every later edit forever), and each record's size. `push` then refuses a
 * batch that would take the user past their storage quota. Limits are set far
 * above real use — measured 2026-11-04, the largest live record was 3.7 kB
 * and the whole account 59 records.
 *
 * No Cloudflare types in here: `index.ts` supplies a D1-backed store, and the
 * tests supply an in-memory one, so both run exactly these rules.
 */

export interface StoredRecord {
  tbl: string;
  id: string;
  /** The row as JSON text; null for a tombstone. */
  data: string | null;
  updatedAt: number;
  deleted: boolean;
  rev: number;
}

export interface IncomingRecord {
  tbl: string;
  id: string;
  data: unknown;
  updatedAt: number;
  deleted: boolean;
}

/** A summary for the "Sync details" panel — what the database holds. */
export interface SyncStats {
  records: number;
  deleted: number;
  /** Highest rev written. A device whose cursor is past this is confused. */
  latestRev: number;
  /** Total size of the stored JSON — what the quota is measured against. */
  bytes: number;
}

export interface SyncStore {
  stats(userId: string): Promise<SyncStats>;
  /** Write each record if strictly newer than what THIS USER has stored; return how many were written. */
  upsertNewer(userId: string, records: readonly IncomingRecord[]): Promise<number>;
  /** This user's records with rev > `since`, oldest first, at most `limit`. */
  changesSince(userId: string, since: number, limit: number): Promise<StoredRecord[]>;
}

export const PULL_PAGE_SIZE = 500;
export const MAX_PUSH = 500;
/** One record's JSON. Seventy times the largest real one. */
export const MAX_RECORD_BYTES = 256 * 1024;
/** A whole push body; the Worker refuses anything larger before parsing it. */
export const MAX_PUSH_BYTES = 4 * 1024 * 1024;
/** How far ahead of the server's clock a timestamp may be (clock skew). */
export const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;
/** Per-user quota. Deletions always pass, so a full account can still shrink. */
export const MAX_RECORDS_PER_USER = 20_000;
export const MAX_BYTES_PER_USER = 50 * 1024 * 1024;
/** Numeric ids, nutrient keys (`vitamin_b12_ug`), dates, `settings`. */
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

/** Table names a client may write. Mirrors `SYNC_TABLES` in src/domain/sync.ts. */
const ALLOWED_TABLES = new Set([
  'ingredients',
  'components',
  'batches',
  'fridgeEntries',
  'stockAdjustments',
  'mealLogs',
  'quickAddFavorites',
  'targets',
  'settings',
  'weightEntries',
  'plan',
  'scratchpads',
]);

export class SyncRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 = 400,
  ) {
    super(message);
  }
}

/** Check an untrusted push body. Rejects the whole push rather than half-applying it. */
export function parsePush(body: unknown, now: number = Date.now()): IncomingRecord[] {
  const changes = (body as { changes?: unknown } | null)?.changes;
  if (!Array.isArray(changes)) throw new SyncRequestError('Expected { changes: [...] }.');
  if (changes.length > MAX_PUSH) {
    throw new SyncRequestError(`At most ${MAX_PUSH} changes per push, got ${changes.length}.`);
  }

  return changes.map((raw: unknown, index) => {
    const change = (raw ?? {}) as Record<string, unknown>;
    const { tbl, id, updatedAt, deleted } = change;
    if (typeof tbl !== 'string' || !ALLOWED_TABLES.has(tbl)) {
      throw new SyncRequestError(`Change ${index}: unknown table ${String(tbl)}.`);
    }
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      throw new SyncRequestError(`Change ${index}: missing or malformed id.`);
    }
    if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt < 0) {
      throw new SyncRequestError(`Change ${index}: missing updatedAt.`);
    }
    if (updatedAt > now + MAX_CLOCK_SKEW_MS) {
      throw new SyncRequestError(
        `Change ${index}: updatedAt is in the future. Check this device's clock.`,
      );
    }
    if (deleted !== true && (change.data === null || typeof change.data !== 'object')) {
      throw new SyncRequestError(`Change ${index}: a non-deleted change needs data.`);
    }
    if (deleted !== true && JSON.stringify(change.data).length > MAX_RECORD_BYTES) {
      throw new SyncRequestError(
        `Change ${index}: record larger than ${MAX_RECORD_BYTES / 1024} kB.`,
        413,
      );
    }
    return {
      tbl,
      id,
      updatedAt,
      deleted: deleted === true,
      data: deleted === true ? null : change.data,
    };
  });
}

/**
 * Write a checked push, unless it would take the user past their quota. The
 * check is an upper bound — every non-deleted change is counted as new, even
 * one that replaces a row — which errs towards refusing only at a size no
 * real account approaches.
 */
export async function push(
  store: SyncStore,
  userId: string,
  changes: readonly IncomingRecord[],
): Promise<number> {
  const live = changes.filter((change) => !change.deleted);
  if (live.length > 0) {
    const usage = await store.stats(userId);
    const incomingBytes = live.reduce((sum, change) => sum + JSON.stringify(change.data).length, 0);
    if (usage.records + live.length > MAX_RECORDS_PER_USER) {
      throw new SyncRequestError(
        `Storage full: at most ${MAX_RECORDS_PER_USER} records per account.`,
        413,
      );
    }
    if (usage.bytes + incomingBytes > MAX_BYTES_PER_USER) {
      throw new SyncRequestError(
        `Storage full: at most ${MAX_BYTES_PER_USER / 1024 / 1024} MB per account.`,
        413,
      );
    }
  }
  return store.upsertNewer(userId, changes);
}

export interface PullPage {
  records: Array<Omit<StoredRecord, 'data' | 'rev'> & { data: unknown }>;
  /** Highest rev in this page — pass it back as `since` for the next. */
  cursor: number;
  /** True when the page was full and there may be more. */
  more: boolean;
}

export async function pull(store: SyncStore, userId: string, since: number): Promise<PullPage> {
  const rows = await store.changesSince(userId, since, PULL_PAGE_SIZE);
  return {
    records: rows.map((row) => ({
      tbl: row.tbl,
      id: row.id,
      updatedAt: row.updatedAt,
      deleted: row.deleted,
      data: row.data === null ? null : (JSON.parse(row.data) as unknown),
    })),
    cursor: rows.length === 0 ? since : (rows[rows.length - 1]?.rev ?? since),
    more: rows.length === PULL_PAGE_SIZE,
  };
}

/** The same rules held in memory — used by tests on both sides of the wire. */
export class MemorySyncStore implements SyncStore {
  readonly rows = new Map<string, StoredRecord & { userId: string }>();
  private rev = 0;

  async upsertNewer(userId: string, records: readonly IncomingRecord[]): Promise<number> {
    let written = 0;
    for (const record of records) {
      const key = `${userId}\u0000${record.tbl}\u0000${record.id}`;
      const existing = this.rows.get(key);
      if (existing !== undefined && !(record.updatedAt > existing.updatedAt)) continue;
      this.rev += 1;
      this.rows.set(key, {
        userId,
        tbl: record.tbl,
        id: record.id,
        data: record.deleted ? null : JSON.stringify(record.data),
        updatedAt: record.updatedAt,
        deleted: record.deleted,
        rev: this.rev,
      });
      written += 1;
    }
    return written;
  }

  async stats(userId: string): Promise<SyncStats> {
    const rows = [...this.rows.values()].filter((row) => row.userId === userId);
    return {
      records: rows.length,
      deleted: rows.filter((row) => row.deleted).length,
      latestRev: Math.max(0, ...rows.map((row) => row.rev)),
      bytes: rows.reduce((sum, row) => sum + (row.data?.length ?? 0), 0),
    };
  }

  async changesSince(userId: string, since: number, limit: number): Promise<StoredRecord[]> {
    return [...this.rows.values()]
      .filter((row) => row.userId === userId && row.rev > since)
      .sort((a, b) => a.rev - b.rev)
      .slice(0, limit)
      .map(({ userId: _owner, ...row }) => row);
  }
}
