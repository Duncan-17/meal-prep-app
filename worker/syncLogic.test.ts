import { describe, expect, it } from 'vitest';

import {
  MAX_BYTES_PER_USER,
  MAX_CLOCK_SKEW_MS,
  MAX_PUSH,
  MAX_RECORDS_PER_USER,
  MAX_RECORD_BYTES,
  MemorySyncStore,
  PULL_PAGE_SIZE,
  SyncRequestError,
  parsePush,
  pull,
  push,
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

  // Hardening, 2026-11-04. Each of these is something only a hand-made
  // request could send — the app never does.
  const NOW = 1_800_000_000_000;
  it.each([
    ['an id with markup in it', change({ id: '<img src=x onerror=alert(1)>' })],
    ['an id with a path in it', change({ id: '../../etc/passwd' })],
    ['an overlong id', change({ id: '1'.repeat(65) })],
    ['a negative timestamp', change({ updatedAt: -1 })],
    // Stamped far ahead, a record would beat every real edit forever.
    ['a timestamp in the far future', change({ updatedAt: NOW + MAX_CLOCK_SKEW_MS + 1 })],
  ])('rejects %s', (_label, bad) => {
    expect(() => parsePush({ changes: [change(), bad] }, NOW)).toThrow(SyncRequestError);
  });

  it('accepts every real id shape: numeric, nutrient keys, dates, fixed names', () => {
    const ids = ['1793844488559417', 'vitamin_b12_ug', '2026-11-04', 'settings', 'plan'];
    expect(parsePush({ changes: ids.map((id) => change({ id })) }, NOW)).toHaveLength(5);
  });

  it('allows a little clock skew', () => {
    expect(() =>
      parsePush({ changes: [change({ updatedAt: NOW + MAX_CLOCK_SKEW_MS })] }, NOW),
    ).not.toThrow();
  });

  it('refuses an oversized record with 413, but a tombstone needs no data', () => {
    const huge = { blob: 'x'.repeat(MAX_RECORD_BYTES) };
    const error = (() => {
      try {
        parsePush({ changes: [change({ data: huge })] }, NOW);
      } catch (caught) {
        return caught as SyncRequestError;
      }
      return null;
    })();
    expect(error?.status).toBe(413);
    expect(parsePush({ changes: [change({ data: huge, deleted: true })] }, NOW)).toHaveLength(1);
  });
});

describe('the per-user quota', () => {
  const rows = (count: number, from = 0) =>
    Array.from({ length: count }, (_, i) => ({
      tbl: 'mealLogs',
      id: String(from + i),
      data: { n: i },
      updatedAt: 10,
      deleted: false,
    }));

  it(`refuses a push that would pass ${MAX_RECORDS_PER_USER} records, writing none of it`, async () => {
    const store = new MemorySyncStore();
    for (let start = 0; start < MAX_RECORDS_PER_USER; start += MAX_PUSH) {
      await push(store, 'a', rows(MAX_PUSH, start));
    }
    await expect(push(store, 'a', rows(1, MAX_RECORDS_PER_USER))).rejects.toMatchObject({
      status: 413,
    });
    expect((await store.stats('a')).records).toBe(MAX_RECORDS_PER_USER);
    // Another user's quota is their own.
    await expect(push(store, 'b', rows(1))).resolves.toBe(1);
  });

  it('still lets a full account delete things', async () => {
    const store = new MemorySyncStore();
    for (let start = 0; start < MAX_RECORDS_PER_USER; start += MAX_PUSH) {
      await push(store, 'a', rows(MAX_PUSH, start));
    }
    const tombstone = { tbl: 'mealLogs', id: '0', data: null, updatedAt: 20, deleted: true };
    await expect(push(store, 'a', [tombstone])).resolves.toBe(1);
  });

  it(`refuses a push that would pass ${MAX_BYTES_PER_USER / 1024 / 1024} MB`, async () => {
    const store = new MemorySyncStore();
    const big = (id: string) => ({
      tbl: 'mealLogs',
      id,
      data: { blob: 'x'.repeat(MAX_RECORD_BYTES - 20) },
      updatedAt: 10,
      deleted: false,
    });
    const perPush = 10;
    const fits = Math.floor(MAX_BYTES_PER_USER / MAX_RECORD_BYTES);
    for (let start = 0; start + perPush <= fits; start += perPush) {
      await push(
        store,
        'a',
        Array.from({ length: perPush }, (_, i) => big(String(start + i))),
      );
    }
    await expect(
      push(
        store,
        'a',
        Array.from({ length: perPush }, (_, i) => big(`over${i}`)),
      ),
    ).rejects.toMatchObject({ status: 413 });
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
    expect(await store.stats(A)).toEqual({
      records: 2,
      deleted: 1,
      latestRev: 2,
      bytes: JSON.stringify(change().data).length,
    });
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
    expect(await store.stats(B)).toEqual({ records: 0, deleted: 0, latestRev: 0, bytes: 0 });
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
