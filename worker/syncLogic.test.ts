import { describe, expect, it } from 'vitest';

import {
  MAX_PUSH,
  MemorySyncStore,
  PULL_PAGE_SIZE,
  SyncRequestError,
  parsePush,
  pull,
} from './syncLogic';

const change = (overrides: Record<string, unknown> = {}) => ({
  tbl: 'mealLogs',
  id: '1760000000000123',
  data: { id: 1760000000000123 },
  updatedAt: 10,
  deleted: false,
  ...overrides,
});

describe('parsePush', () => {
  it('accepts a well-formed push and strips data from tombstones', () => {
    const parsed = parsePush({
      changes: [change(), change({ deleted: true, data: { stray: 1 } })],
    });
    expect(parsed).toHaveLength(2);
    expect(parsed[1]?.data).toBeNull();
  });

  it.each([
    ['no changes array', {}],
    ['an unknown table', { changes: [change({ tbl: 'foodCache' })] }],
    ['a missing id', { changes: [change({ id: '' })] }],
    ['a missing timestamp', { changes: [change({ updatedAt: 'soon' })] }],
    ['a live row with no data', { changes: [change({ data: null })] }],
    ['too many changes', { changes: Array.from({ length: MAX_PUSH + 1 }, () => change()) }],
  ])('rejects %s, applying nothing', (_label, body) => {
    expect(() => parsePush(body)).toThrow(SyncRequestError);
  });
});

const A = 'user-a';
const B = 'user-b';

describe('the store rules', () => {
  it('replaces a row only with a strictly newer write', async () => {
    const store = new MemorySyncStore();
    expect(await store.upsertNewer(A, [change({ updatedAt: 10, data: { v: 1 } })])).toBe(1);
    expect(await store.upsertNewer(A, [change({ updatedAt: 10, data: { v: 2 } })])).toBe(0);
    expect(await store.upsertNewer(A, [change({ updatedAt: 5, data: { v: 3 } })])).toBe(0);
    expect(await store.upsertNewer(A, [change({ updatedAt: 11, data: { v: 4 } })])).toBe(1);
    const [row] = await store.changesSince(A, 0, 10);
    expect(JSON.parse(row!.data!)).toEqual({ v: 4 });
  });

  it('gives every accepted write a higher rev, so a cursor catches everything after it', async () => {
    const store = new MemorySyncStore();
    await store.upsertNewer(A, [change({ id: 'a' }), change({ id: 'b' })]);
    const first = await pull(store, A, 0);
    expect(first.records.map((r) => r.id)).toEqual(['a', 'b']);

    await store.upsertNewer(A, [change({ id: 'a', updatedAt: 20 })]);
    const next = await pull(store, A, first.cursor);
    expect(next.records.map((r) => r.id)).toEqual(['a']);
    expect((await pull(store, A, next.cursor)).records).toEqual([]);
  });

  it('pages a large pull', async () => {
    const store = new MemorySyncStore();
    await store.upsertNewer(
      A,
      Array.from({ length: PULL_PAGE_SIZE + 3 }, (_, i) => change({ id: String(i) })),
    );
    const first = await pull(store, A, 0);
    expect(first.more).toBe(true);
    const second = await pull(store, A, first.cursor);
    expect(second.records).toHaveLength(3);
    expect(second.more).toBe(false);
  });

  it('reports what it holds, for the Sync details panel', async () => {
    const store = new MemorySyncStore();
    await store.upsertNewer(A, [
      change({ id: 'a' }),
      change({ id: 'b', deleted: true, data: null }),
    ]);
    expect(await store.stats(A)).toEqual({ records: 2, deleted: 1, latestRev: 2 });
  });
});

/*
 * PLAN.md §11: one account must never see or change another's data. These are
 * the attacks an IDOR bug would let through — each asserts it does not.
 */
describe('isolation between users', () => {
  it("never returns another user's rows, from any cursor", async () => {
    const store = new MemorySyncStore();
    await store.upsertNewer(A, [change({ id: 'secret', data: { kcal: 640 } })]);
    expect((await pull(store, B, 0)).records).toEqual([]);
    expect(await store.stats(B)).toEqual({ records: 0, deleted: 0, latestRev: 0 });
  });

  it("cannot overwrite another user's row by reusing its (table, id), even with a newer timestamp", async () => {
    const store = new MemorySyncStore();
    await store.upsertNewer(A, [change({ id: 'x', updatedAt: 10, data: { owner: 'A' } })]);
    await store.upsertNewer(B, [change({ id: 'x', updatedAt: 99, data: { owner: 'B' } })]);

    const [aRow] = (await pull(store, A, 0)).records;
    expect(aRow?.data).toEqual({ owner: 'A' });
    const [bRow] = (await pull(store, B, 0)).records;
    expect(bRow?.data).toEqual({ owner: 'B' });
  });

  it("cannot delete another user's row with a tombstone", async () => {
    const store = new MemorySyncStore();
    await store.upsertNewer(A, [change({ id: 'x', updatedAt: 10 })]);
    await store.upsertNewer(B, [change({ id: 'x', updatedAt: 99, deleted: true, data: null })]);
    expect((await pull(store, A, 0)).records[0]?.deleted).toBe(false);
  });

  it("does not let another user's writes leak through the cursor", async () => {
    const store = new MemorySyncStore();
    await store.upsertNewer(A, [change({ id: 'a1' })]);
    const cursor = (await pull(store, A, 0)).cursor;
    await store.upsertNewer(B, [change({ id: 'b1' }), change({ id: 'b2' })]);
    expect((await pull(store, A, cursor)).records).toEqual([]);
  });
});
