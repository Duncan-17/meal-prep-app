/**
 * The server's half of sync — the rules, independent of where rows are kept.
 *
 * Every row of every synced table is one record keyed by (table, id), holding
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
}

export interface SyncStore {
  stats(): Promise<SyncStats>;
  /** Write each record if strictly newer than what is stored; return how many were written. */
  upsertNewer(records: readonly IncomingRecord[]): Promise<number>;
  /** Records with rev > `since`, oldest first, at most `limit`. */
  changesSince(since: number, limit: number): Promise<StoredRecord[]>;
}

export const PULL_PAGE_SIZE = 500;
export const MAX_PUSH = 500;

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
]);

export class SyncRequestError extends Error {}

/** Check an untrusted push body. Rejects the whole push rather than half-applying it. */
export function parsePush(body: unknown): IncomingRecord[] {
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
    if (typeof id !== 'string' || id.length === 0 || id.length > 200) {
      throw new SyncRequestError(`Change ${index}: missing id.`);
    }
    if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) {
      throw new SyncRequestError(`Change ${index}: missing updatedAt.`);
    }
    if (deleted !== true && (change.data === null || typeof change.data !== 'object')) {
      throw new SyncRequestError(`Change ${index}: a non-deleted change needs data.`);
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

export interface PullPage {
  records: Array<Omit<StoredRecord, 'data' | 'rev'> & { data: unknown }>;
  /** Highest rev in this page — pass it back as `since` for the next. */
  cursor: number;
  /** True when the page was full and there may be more. */
  more: boolean;
}

export async function pull(store: SyncStore, since: number): Promise<PullPage> {
  const rows = await store.changesSince(since, PULL_PAGE_SIZE);
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
  readonly rows = new Map<string, StoredRecord>();
  private rev = 0;

  async upsertNewer(records: readonly IncomingRecord[]): Promise<number> {
    let written = 0;
    for (const record of records) {
      const key = `${record.tbl}\u0000${record.id}`;
      const existing = this.rows.get(key);
      if (existing !== undefined && !(record.updatedAt > existing.updatedAt)) continue;
      this.rev += 1;
      this.rows.set(key, {
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

  async stats(): Promise<SyncStats> {
    const rows = [...this.rows.values()];
    return {
      records: rows.length,
      deleted: rows.filter((row) => row.deleted).length,
      latestRev: this.rev,
    };
  }

  async changesSince(since: number, limit: number): Promise<StoredRecord[]> {
    return [...this.rows.values()]
      .filter((row) => row.rev > since)
      .sort((a, b) => a.rev - b.rev)
      .slice(0, limit);
  }
}
