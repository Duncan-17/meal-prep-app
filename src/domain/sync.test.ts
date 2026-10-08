import { describe, expect, it } from 'vitest';

import {
  LEGACY_ID_LIMIT,
  createIdGenerator,
  detectChanges,
  ownTimestamp,
  recordKey,
  rekeyLegacyIds,
  rowFingerprint,
  shouldApplyRemote,
  stableStringify,
} from '@/domain/sync';

describe('createIdGenerator', () => {
  it('makes ids above the legacy range that sort by creation time', () => {
    const next = createIdGenerator(
      () => 1_760_000_000_000,
      () => 0.5,
    );
    const id = next();
    expect(id).toBeGreaterThan(LEGACY_ID_LIMIT);
    expect(id).toBe(1_760_000_000_000_500);
    expect(Number.isSafeInteger(id)).toBe(true);
  });

  it('stays above the legacy range even with a clock stuck near 1970', () => {
    const next = createIdGenerator(
      () => 5,
      () => 0,
    );
    expect(next()).toBeGreaterThanOrEqual(LEGACY_ID_LIMIT);
  });

  it('never repeats or goes backwards within a device, even in the same millisecond', () => {
    const next = createIdGenerator(
      () => 1_760_000_000_000,
      () => 0.999,
    );
    const ids = Array.from({ length: 5 }, next);
    expect(new Set(ids).size).toBe(5);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  });
});

describe('rekeyLegacyIds', () => {
  let n = 0;
  const newId = () => LEGACY_ID_LIMIT + ++n * 10;

  const data = {
    ingredients: [
      { id: 1, name: 'Chicken' },
      { id: 2, name: 'Rice' },
    ],
    components: [
      {
        id: 1,
        name: 'Chicken and rice',
        ingredients: [
          { ingredientId: 1, quantity: 500 },
          { ingredientId: 2, quantity: 300 },
        ],
      },
    ],
    batches: [{ id: 1, componentId: 1 }],
    fridgeEntries: [
      { id: 1, batchId: 1, componentId: 1 },
      { id: 2, componentName: 'Milk' },
    ],
    stockAdjustments: [{ id: 1, fridgeEntryId: 2 }],
    mealLogs: [
      {
        id: 1,
        items: [
          { kind: 'fridge', fridgeEntryId: 1 },
          { kind: 'quick', label: 'Eggs' },
        ],
      },
    ],
    targets: [{ key: 'protein_g', amount: 150 }],
  };

  it('renumbers every legacy id and follows all six references', () => {
    n = 0;
    const { data: out, changed } = rekeyLegacyIds(data, newId);
    expect(changed).toBe(true);

    const id = (tbl: string, i = 0) => (out[tbl]?.[i] as { id: number }).id;
    for (const tbl of ['ingredients', 'components', 'batches', 'fridgeEntries', 'mealLogs']) {
      expect(id(tbl)).toBeGreaterThan(LEGACY_ID_LIMIT);
    }

    const component = out.components?.[0] as { ingredients: { ingredientId: number }[] };
    expect(component.ingredients.map((entry) => entry.ingredientId)).toEqual([
      id('ingredients', 0),
      id('ingredients', 1),
    ]);
    expect((out.batches?.[0] as { componentId: number }).componentId).toBe(id('components'));
    const entry = out.fridgeEntries?.[0] as { batchId: number; componentId: number };
    expect(entry.batchId).toBe(id('batches'));
    expect(entry.componentId).toBe(id('components'));
    expect((out.stockAdjustments?.[0] as { fridgeEntryId: number }).fridgeEntryId).toBe(
      id('fridgeEntries', 1),
    );
    const meal = out.mealLogs?.[0] as { items: { fridgeEntryId?: number }[] };
    expect(meal.items[0]?.fridgeEntryId).toBe(id('fridgeEntries', 0));
    expect('fridgeEntryId' in (meal.items[1] ?? {})).toBe(false);
  });

  it("follows a scratchpad's recipe references too", () => {
    n = 0;
    const { data: out } = rekeyLegacyIds(
      {
        components: [{ id: 1, name: 'Pasta' }],
        scratchpads: [{ id: 1, items: [{ kind: 'recipe', componentId: 1 }, { kind: 'food' }] }],
      },
      newId,
    );
    const pasta = (out.components?.[0] as { id: number }).id;
    const pad = out.scratchpads?.[0] as { id: number; items: { componentId?: number }[] };
    expect(pad.id).toBeGreaterThan(LEGACY_ID_LIMIT);
    expect(pad.items[0]?.componentId).toBe(pasta);
    expect('componentId' in (pad.items[1] ?? {})).toBe(false);
  });

  it('keeps legacy rows in their original order', () => {
    n = 0;
    const { data: out } = rekeyLegacyIds({ mealLogs: [{ id: 3 }, { id: 1 }, { id: 2 }] }, newId);
    const ids = (out.mealLogs as { id: number }[]).map((row) => row.id);
    // Row with old id 1 gets the smallest new id, and so on.
    expect(ids[1]! < ids[2]! && ids[2]! < ids[0]!).toBe(true);
  });

  it('leaves string-keyed tables and new-style ids alone', () => {
    const big = LEGACY_ID_LIMIT + 123;
    const { data: out, changed } = rekeyLegacyIds(
      { mealLogs: [{ id: big }], targets: [{ key: 'protein_g' }] },
      newId,
    );
    expect(changed).toBe(false);
    expect(out.mealLogs).toEqual([{ id: big }]);
  });

  it('leaves a reference to a row that no longer exists pointing where it pointed', () => {
    n = 0;
    const { data: out } = rekeyLegacyIds({ batches: [{ id: 1, componentId: 99 }] }, newId);
    expect((out.batches?.[0] as { componentId: number }).componentId).toBe(99);
  });
});

describe('stableStringify and fingerprints', () => {
  it('ignores key order and undefined fields', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 2 }, b: 1, z: undefined }),
    );
    expect(rowFingerprint({ b: 1, a: 2 })).toBe(rowFingerprint({ a: 2, b: 1 }));
  });

  it('notices a real change', () => {
    expect(rowFingerprint({ a: 1 })).not.toBe(rowFingerprint({ a: 2 }));
  });
});

describe('ownTimestamp', () => {
  it('prefers updatedAt, then loggedAt, cookedAt, createdAt — and 0 with none', () => {
    expect(ownTimestamp({ createdAt: 1, updatedAt: 5 })).toBe(5);
    expect(ownTimestamp({ loggedAt: 7, createdAt: 1 })).toBe(7);
    expect(ownTimestamp({ key: 'protein_g', amount: 150 })).toBe(0);
  });
});

describe('detectChanges', () => {
  const at = 1000;

  it('reports new and edited rows, and skips unchanged ones', () => {
    const unchanged = { id: 1, name: 'A' };
    const shadow = new Map([[recordKey('mealLogs', '1'), rowFingerprint(unchanged)]]);
    const { changes } = detectChanges(
      'mealLogs',
      [unchanged, { id: 2, name: 'B' }],
      shadow,
      () => at,
      at,
    );
    expect(changes.map((change) => change.id)).toEqual(['2']);
    expect(changes[0]).toMatchObject({ tbl: 'mealLogs', deleted: false, updatedAt: at });
  });

  it('turns a vanished row into a tombstone', () => {
    const shadow = new Map([[recordKey('mealLogs', '9'), 'x']]);
    const { changes, fingerprints } = detectChanges('mealLogs', [], shadow, () => at, at);
    expect(changes).toEqual([
      { tbl: 'mealLogs', id: '9', data: null, updatedAt: at, deleted: true },
    ]);
    expect(fingerprints.get('mealLogs:9')).toBeNull();
  });

  it("does not mistake another table's rows for deletions", () => {
    const shadow = new Map([[recordKey('targets', 'protein_g'), 'x']]);
    expect(detectChanges('mealLogs', [], shadow, () => at, at).changes).toEqual([]);
  });

  it('keys string-keyed tables by their own key field', () => {
    const { changes } = detectChanges(
      'weightEntries',
      [{ date: '2026-10-07', kg: 80 }],
      new Map(),
      () => at,
      at,
    );
    expect(changes[0]?.id).toBe('2026-10-07');
  });
});

describe('shouldApplyRemote', () => {
  const remote = { tbl: 'mealLogs', id: '1', data: {}, updatedAt: 100, deleted: false };

  it('applies when nothing local is pending', () => {
    expect(shouldApplyRemote(remote, undefined)).toBe(true);
  });

  it('keeps a later local edit, and yields to a later remote one', () => {
    expect(shouldApplyRemote(remote, 200)).toBe(false);
    expect(shouldApplyRemote(remote, 50)).toBe(true);
  });
});
