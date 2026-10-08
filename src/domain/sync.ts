/**
 * Sync between this device and the Cloudflare database — the pure half.
 *
 * Decided by the user 2026-10-07 (PLAN.md §10 "Storage"): every device keeps a
 * full local copy and works offline exactly as before; changes are swapped
 * with a D1 database whenever there is a connection; the later EDIT wins when
 * two devices change the same thing; and the existing data on each device is
 * MERGED into the database, not replaced.
 *
 * Everything here is plain functions over plain data so the parts that can be
 * silently wrong — id rewriting, change detection, conflict resolution — are
 * testable without a browser or a network. `db/sync.ts` is the Dexie side.
 */

// ── What syncs ──────────────────────────────────────────────────────────────

export interface SyncTableSpec {
  /** The row field holding its primary key. */
  key: string;
  /** Numeric auto-assigned ids, which must be made unique across devices. */
  autoId: boolean;
}

/**
 * The user's data — every table a backup carries. The caches are left out
 * for the same reason backups leave them out: they are re-fetchable copies of
 * USDA's data, not the user's.
 */
export const SYNC_TABLES: Readonly<Record<string, SyncTableSpec>> = {
  ingredients: { key: 'id', autoId: true },
  components: { key: 'id', autoId: true },
  batches: { key: 'id', autoId: true },
  fridgeEntries: { key: 'id', autoId: true },
  stockAdjustments: { key: 'id', autoId: true },
  mealLogs: { key: 'id', autoId: true },
  quickAddFavorites: { key: 'id', autoId: true },
  targets: { key: 'key', autoId: false },
  settings: { key: 'id', autoId: false },
  weightEntries: { key: 'date', autoId: false },
  plan: { key: 'id', autoId: false },
};

export const SYNC_TABLE_NAMES = Object.keys(SYNC_TABLES);

/** One row's state as it travels: `data: null` with `deleted` is a tombstone. */
export interface SyncRecord {
  tbl: string;
  id: string;
  data: unknown;
  /** When the change was made, ms. The later edit wins. */
  updatedAt: number;
  deleted: boolean;
}

export function recordKey(tbl: string, id: string): string {
  return `${tbl}:${id}`;
}

/** The primary key of a row, as the string the server stores. */
export function rowId(tbl: string, row: unknown): string | null {
  const spec = SYNC_TABLES[tbl];
  if (spec === undefined || typeof row !== 'object' || row === null) return null;
  const value = (row as Record<string, unknown>)[spec.key];
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  return null;
}

/** Back from the server's string to the key Dexie stores — a number for auto ids. */
export function localKey(tbl: string, id: string): string | number {
  return SYNC_TABLES[tbl]?.autoId === true ? Number(id) : id;
}

// ── Ids that cannot collide ─────────────────────────────────────────────────

/**
 * Ids below this were handed out by IndexedDB's own counter — 1, 2, 3… on
 * EVERY device. Two devices both have a meal log 5, and merging them as-is
 * would make one overwrite the other. Anything under this is rewritten before
 * it is ever uploaded.
 */
export const LEGACY_ID_LIMIT = 2 ** 32;

export function isLegacyId(id: unknown): id is number {
  return typeof id === 'number' && id < LEGACY_ID_LIMIT;
}

/**
 * New ids: the creation time in ms × 1000, plus a random 0–999.
 *
 * Time first, so ids still sort in creation order — nothing depends on that
 * today, but the old counter gave it for free and it is cheap to keep.
 * Unique across devices unless two create something in the same millisecond
 * AND draw the same random number: one in a thousand per shared millisecond,
 * for a single person, which is as close to never as matters. Within a
 * device, strictly increasing. ~1.8e15 today, inside 2^53 for millennia.
 */
export function createIdGenerator(
  now: () => number = Date.now,
  random: () => number = Math.random,
): () => number {
  let last = 0;
  return () => {
    let id = now() * 1000 + Math.floor(random() * 1000);
    // A device whose clock reads 1970 would otherwise mint ids in the legacy
    // range — and have its own new rows renumbered on every sync.
    if (id < LEGACY_ID_LIMIT) id += LEGACY_ID_LIMIT;
    if (id <= last) id = last + 1;
    last = id;
    return id;
  };
}

/** Fields that hold another row's id — every one must follow a rewrite. */
const REFERENCES: Readonly<Record<string, ReadonlyArray<[field: string, target: string]>>> = {
  batches: [['componentId', 'components']],
  fridgeEntries: [
    ['batchId', 'batches'],
    ['componentId', 'components'],
  ],
  stockAdjustments: [['fridgeEntryId', 'fridgeEntries']],
};

/**
 * Give every legacy id a collision-proof one, rewriting every reference to it.
 *
 * Six fields point at other rows: the four in REFERENCES, plus the two that
 * live inside arrays — a recipe's `ingredients[].ingredientId` and a meal's
 * `items[].fridgeEntryId`. Miss one and a meal points at a fridge entry that
 * no longer exists under that id.
 *
 * A reference to an id that is not in the data (a deleted recipe a batch still
 * names) is left alone: there is nothing to point it at, and inventing a
 * target would be worse than an honest dangling id.
 *
 * Legacy rows are renumbered in their original order, so relative order
 * survives. Returns the input untouched when there is nothing to rewrite.
 */
export function rekeyLegacyIds(
  data: Readonly<Record<string, readonly unknown[]>>,
  newId: () => number,
): { data: Record<string, unknown[]>; changed: boolean } {
  const maps = new Map<string, Map<number, number>>();
  let changed = false;

  for (const [tbl, spec] of Object.entries(SYNC_TABLES)) {
    if (!spec.autoId) continue;
    const ids = (data[tbl] ?? [])
      .map((row) => (row as Record<string, unknown>)[spec.key])
      .filter(isLegacyId)
      .sort((a, b) => a - b);
    const map = new Map<number, number>();
    for (const id of ids) map.set(id, newId());
    if (map.size > 0) changed = true;
    maps.set(tbl, map);
  }

  if (!changed) return { data: { ...data } as Record<string, unknown[]>, changed: false };

  const follow = (target: string, value: unknown): unknown =>
    typeof value === 'number' ? (maps.get(target)?.get(value) ?? value) : value;

  const out: Record<string, unknown[]> = {};
  for (const [tbl, rows] of Object.entries(data)) {
    const spec = SYNC_TABLES[tbl];
    out[tbl] = rows.map((original) => {
      const row = { ...(original as Record<string, unknown>) };

      if (spec?.autoId === true) row[spec.key] = follow(tbl, row[spec.key]);

      for (const [field, target] of REFERENCES[tbl] ?? []) {
        if (field in row) row[field] = follow(target, row[field]);
      }

      if (tbl === 'components' && Array.isArray(row.ingredients)) {
        row.ingredients = row.ingredients.map((entry: Record<string, unknown>) => ({
          ...entry,
          ingredientId: follow('ingredients', entry.ingredientId),
        }));
      }

      if (tbl === 'mealLogs' && Array.isArray(row.items)) {
        row.items = row.items.map((item: Record<string, unknown>) =>
          'fridgeEntryId' in item
            ? { ...item, fridgeEntryId: follow('fridgeEntries', item.fridgeEntryId) }
            : item,
        );
      }

      return row;
    });
  }

  return { data: out, changed: true };
}

// ── Noticing what changed ───────────────────────────────────────────────────

/** JSON with object keys sorted, so equal data always hashes equal. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/**
 * A 53-bit fingerprint (cyrb53). Only compared for equality with the last
 * fingerprint of the same row, so a collision would mean one edit is missed —
 * at one in ~10^15 per edit, not a practical concern.
 */
export function fingerprint(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function rowFingerprint(row: unknown): string {
  return fingerprint(stableStringify(row));
}

/**
 * The time a row says it was last changed, for the very first upload.
 *
 * On a device's first sync every row is "new", but stamping them all with
 * now would let a fresh phone's untouched default goals overwrite goals the
 * user actually edited on the laptop. So the first pass uses the row's own
 * timestamp, and a row with none — default targets, settings — gets 0 and
 * loses to anything the database already holds.
 */
export function ownTimestamp(row: unknown): number {
  if (typeof row !== 'object' || row === null) return 0;
  const r = row as Record<string, unknown>;
  for (const field of ['updatedAt', 'loggedAt', 'cookedAt', 'createdAt']) {
    const value = r[field];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

/**
 * Compare a table's rows with what was last synced, and list the differences.
 *
 * `shadow` maps record key → fingerprint of the row as last uploaded or
 * downloaded. A row whose fingerprint moved is an edit; a shadow entry with no
 * row is a deletion, sent as a tombstone so other devices delete it too.
 *
 * Diffing rather than hooking every write path is deliberate: there are dozens
 * of write paths, several inside multi-table transactions, and a missed hook
 * is a change that silently never syncs. A diff cannot miss one.
 */
export function detectChanges(
  tbl: string,
  rows: readonly unknown[],
  shadow: ReadonlyMap<string, string>,
  stamp: (row: unknown) => number,
  now: number,
): { changes: SyncRecord[]; fingerprints: Map<string, string | null> } {
  const changes: SyncRecord[] = [];
  const fingerprints = new Map<string, string | null>();
  const seen = new Set<string>();

  for (const row of rows) {
    const id = rowId(tbl, row);
    if (id === null) continue;
    const key = recordKey(tbl, id);
    seen.add(key);
    const print = rowFingerprint(row);
    if (shadow.get(key) === print) continue;
    changes.push({ tbl, id, data: row, updatedAt: stamp(row), deleted: false });
    fingerprints.set(key, print);
  }

  const prefix = `${tbl}:`;
  for (const key of shadow.keys()) {
    if (!key.startsWith(prefix) || seen.has(key)) continue;
    changes.push({ tbl, id: key.slice(prefix.length), data: null, updatedAt: now, deleted: true });
    fingerprints.set(key, null);
  }

  return { changes, fingerprints };
}

/**
 * Should a record pulled from the database replace this device's copy?
 *
 * Yes, unless this device has an un-uploaded change to the same row made
 * LATER — then the local edit stands and goes up on the next push. Ties go to
 * the database, matching the server's own rule (a write must be strictly newer
 * to replace what it holds).
 */
export function shouldApplyRemote(remote: SyncRecord, pendingLocalAt: number | undefined): boolean {
  return pendingLocalAt === undefined || remote.updatedAt >= pendingLocalAt;
}
