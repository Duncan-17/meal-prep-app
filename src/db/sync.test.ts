/**
 * Two devices, one database. Each "device" is its own IndexedDB; the server
 * is the real `syncLogic` rules over an in-memory store; the clock is fake,
 * so "later edit wins" can be tested deterministically.
 */

import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it } from 'vitest';

import { MealPrepDatabase } from '@/db/schema';
import { SyncOfflineError, createSyncEngine, type SyncTransport } from '@/db/sync';
import { LEGACY_ID_LIMIT } from '@/domain/sync';
import { MemorySyncStore, parsePush, pull } from '../../worker/syncLogic';

let opened: MealPrepDatabase[] = [];
let counter = 0;

afterEach(async () => {
  for (const db of opened) {
    db.close();
    await db.delete();
  }
  opened = [];
});

/** Every device in these tests is signed in to the same account. */
const USER = 'test-user';

function serverWithLink() {
  const store = new MemorySyncStore();
  const link = { online: true };
  const transport: SyncTransport = {
    async push(changes) {
      if (!link.online) throw new SyncOfflineError();
      // Round-trip through JSON exactly as the wire would.
      await store.upsertNewer(USER, parsePush(JSON.parse(JSON.stringify({ changes }))));
    },
    async pull(since) {
      if (!link.online) throw new SyncOfflineError();
      return JSON.parse(JSON.stringify(await pull(store, USER, since)));
    },
  };
  return { store, link, transport };
}

function device(transport: SyncTransport, start = 1_000) {
  const db = new MealPrepDatabase(`sync-test-${++counter}`);
  opened.push(db);
  const clock = { now: start };
  const engine = createSyncEngine(db, transport, () => clock.now);
  return { db, engine, clock };
}

/** What a device looked like before sync existed: ids 1, 2, 3… */
async function seedLegacy(db: MealPrepDatabase, label: string) {
  await db.ingredients.bulkAdd([
    {
      id: 1,
      name: `${label} chicken`,
      source: 'manual',
      nutritionPer100g: {},
      createdAt: 1,
      updatedAt: 1,
    },
  ]);
  await db.components.add({
    id: 1,
    name: `${label} recipe`,
    color: '#c0392b',
    portionStyle: 'discrete',
    baseQuantity: 4,
    baseUnit: 'serving',
    ingredients: [{ ingredientId: 1, quantity: 500, unit: 'g', order: 0 }],
    nutritionPerBase: {},
    coveragePerBase: {},
    totalGrams: 500,
    createdAt: 2,
    updatedAt: 2,
  });
  await db.fridgeEntries.add({
    id: 1,
    componentId: 1,
    componentName: `${label} recipe`,
    componentColor: '#c0392b',
    portionStyle: 'discrete',
    unit: 'serving',
    initialQuantity: 4,
    remaining: 3,
    nutritionPerUnit: { energy_kcal: 300 },
    coverage: {},
    gramsPerUnit: 125,
    cookedAt: 3,
    createdAt: 3,
  });
  await db.mealLogs.add({
    id: 1,
    date: '2026-10-07',
    loggedAt: 4,
    items: [
      {
        kind: 'fridge',
        fridgeEntryId: 1,
        label: `${label} recipe`,
        quantity: 1,
        unit: 'serving',
        grams: 125,
        nutrients: { energy_kcal: 300 },
        coverage: {},
      },
    ],
    nutrients: { energy_kcal: 300 },
    coverage: {},
    totalGrams: 125,
  });
}

describe('merging two devices that both started at id 1', () => {
  it('keeps both sets of data, with every reference still pointing at the right row', async () => {
    const { transport } = serverWithLink();
    const laptop = device(transport);
    const phone = device(transport);
    await seedLegacy(laptop.db, 'Laptop');
    await seedLegacy(phone.db, 'Phone');

    await laptop.engine.syncOnce();
    await phone.engine.syncOnce();
    await laptop.engine.syncOnce();

    for (const { db } of [laptop, phone]) {
      const logs = await db.mealLogs.toArray();
      expect(logs).toHaveLength(2);
      for (const log of logs) {
        expect(log.id).toBeGreaterThan(LEGACY_ID_LIMIT);
        const entryId = log.items[0]?.fridgeEntryId;
        const entry = entryId === undefined ? undefined : await db.fridgeEntries.get(entryId);
        // The meal still points at its own device's fridge entry…
        expect(entry?.componentName).toBe(log.items[0]?.label);
        // …which still points at its own recipe…
        const recipe = await db.components.get(entry!.componentId!);
        expect(recipe?.name).toBe(entry?.componentName);
        // …which still points at its own ingredient.
        const ingredient = await db.ingredients.get(recipe!.ingredients[0]!.ingredientId);
        expect(ingredient?.name.split(' ')[0]).toBe(recipe?.name.split(' ')[0]);
      }
    }
  });

  it("lets a fresh device's untouched default goals lose to goals already uploaded", async () => {
    const { transport } = serverWithLink();
    const laptop = device(transport);
    await laptop.db.targets.put({
      key: 'protein_g',
      amount: 180,
      direction: 'min',
      isDefault: false,
    });
    await laptop.engine.syncOnce();
    // The user edits it on the laptop later, so it carries a real timestamp.
    laptop.clock.now = 5_000;
    await laptop.db.targets.put({
      key: 'protein_g',
      amount: 190,
      direction: 'min',
      isDefault: false,
    });
    await laptop.engine.syncOnce();

    const phone = device(transport, 9_000);
    await phone.db.targets.put({
      key: 'protein_g',
      amount: 150,
      direction: 'min',
      isDefault: true,
    });
    await phone.engine.syncOnce();

    expect((await phone.db.targets.get('protein_g'))?.amount).toBe(190);
  });
});

describe('after the first sync', () => {
  async function pair() {
    const { transport, link, store } = serverWithLink();
    const laptop = device(transport);
    const phone = device(transport);
    await laptop.engine.syncOnce();
    await phone.engine.syncOnce();
    return { laptop, phone, link, store };
  }

  it('carries a new row across', async () => {
    const { laptop, phone } = await pair();
    const id = await laptop.db.weightEntries.put({ date: '2026-10-08', kg: 80, loggedAt: 1 });
    await laptop.engine.syncOnce();
    await phone.engine.syncOnce();
    expect((await phone.db.weightEntries.get(id))?.kg).toBe(80);
  });

  it('carries a deletion across', async () => {
    const { laptop, phone } = await pair();
    await laptop.db.weightEntries.put({ date: '2026-10-08', kg: 80, loggedAt: 1 });
    await laptop.engine.syncOnce();
    await phone.engine.syncOnce();

    phone.clock.now = 2_000;
    await phone.db.weightEntries.delete('2026-10-08');
    await phone.engine.syncOnce();
    await laptop.engine.syncOnce();
    expect(await laptop.db.weightEntries.get('2026-10-08')).toBeUndefined();
  });

  it('lets the later edit win when both devices changed the same row', async () => {
    const { laptop, phone } = await pair();
    await laptop.db.weightEntries.put({ date: '2026-10-08', kg: 80, loggedAt: 1 });
    await laptop.engine.syncOnce();
    await phone.engine.syncOnce();

    // Both edit while out of touch: the phone's edit is noticed later.
    laptop.clock.now = 2_000;
    await laptop.db.weightEntries.put({ date: '2026-10-08', kg: 81, loggedAt: 1 });
    await laptop.engine.detect();
    phone.clock.now = 3_000;
    await phone.db.weightEntries.put({ date: '2026-10-08', kg: 82, loggedAt: 1 });
    await phone.engine.detect();

    // Whichever order they come back online in, 82 (the later edit) wins.
    await phone.engine.syncOnce();
    await laptop.engine.syncOnce();
    await phone.engine.syncOnce();
    expect((await laptop.db.weightEntries.get('2026-10-08'))?.kg).toBe(82);
    expect((await phone.db.weightEntries.get('2026-10-08'))?.kg).toBe(82);
  });

  it('does not send a download straight back as if it were a local edit', async () => {
    const { laptop, phone } = await pair();
    await laptop.db.weightEntries.put({ date: '2026-10-08', kg: 80, loggedAt: 1 });
    await laptop.engine.syncOnce();
    await phone.engine.syncOnce();
    expect(await phone.engine.detect()).toBe(0);
    expect(await phone.engine.pending()).toBe(0);
  });

  it('keeps edits queued while offline, and sends them on reconnecting', async () => {
    const { laptop, phone, link } = await pair();
    link.online = false;
    await laptop.db.weightEntries.put({ date: '2026-10-08', kg: 80, loggedAt: 1 });
    await expect(laptop.engine.syncOnce()).rejects.toBeInstanceOf(SyncOfflineError);
    expect(await laptop.engine.pending()).toBe(1);

    link.online = true;
    await laptop.engine.syncOnce();
    expect(await laptop.engine.pending()).toBe(0);
    await phone.engine.syncOnce();
    expect((await phone.db.weightEntries.get('2026-10-08'))?.kg).toBe(80);
  });

  it('gives a row created after sync started a collision-proof id', async () => {
    const { laptop } = await pair();
    const id = await laptop.db.quickAddFavorites.add({
      label: 'Eggs',
      quantity: 2,
      unit: 'each',
      grams: 100,
      nutrients: {},
      coverage: {},
      useCount: 0,
      createdAt: 1,
    });
    expect(id).toBeGreaterThan(LEGACY_ID_LIMIT);
  });

  it('renumbers old-style ids that reappear later, as restoring an old backup does', async () => {
    const { laptop, phone } = await pair();
    await laptop.db.mealLogs.add({
      id: 3,
      date: '2026-10-08',
      loggedAt: 5,
      items: [],
      nutrients: { energy_kcal: 100 },
      coverage: {},
      totalGrams: 50,
    });
    await laptop.engine.syncOnce();
    await phone.engine.syncOnce();

    expect(await laptop.db.mealLogs.get(3)).toBeUndefined();
    const [moved] = await phone.db.mealLogs.toArray();
    expect(moved?.id).toBeGreaterThan(LEGACY_ID_LIMIT);
    expect(moved?.nutrients.energy_kcal).toBe(100);
  });
});
