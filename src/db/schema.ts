/**
 * The Dexie schema — the single source of persistent state.
 *
 * Every screen reads through `useLiveQuery`, so a write anywhere re-renders
 * whatever observes it. There is no global store and none is wanted
 * (PLAN.md §2).
 *
 * Indexes are declared for the queries the app actually makes; adding one
 * later needs a new `version()` block, never an edit to version 1.
 */

import Dexie, { type Table } from 'dexie';

import { defaultTargetFor } from '@/nutrition/targets';
import { SYNC_TABLES, createIdGenerator, type SyncRecord } from '@/domain/sync';

import type {
  AppSettings,
  Batch,
  Component,
  FoodCacheEntry,
  FridgeEntry,
  Ingredient,
  MealLog,
  NutrientTarget,
  Plan,
  QuickAddFavorite,
  Scratchpad,
  SearchCacheEntry,
  StockAdjustment,
  WeightEntry,
} from '@/domain/types';

/** Last-synced fingerprint of one row — see `detectChanges`. */
export interface SyncShadowRow {
  /** `${table}:${id}` */
  key: string;
  print: string;
}

/** A change made on this device and not yet uploaded. */
export interface SyncOutboxRow extends SyncRecord {
  key: string;
}

export interface SyncMetaRow {
  id: 'sync';
  /** Highest server rev applied here. */
  cursor: number;
  /** Whether this device has done its first change scan — see `ownTimestamp`. */
  firstPassDone: boolean;
  lastSyncedAt?: number;
  /**
   * The account this device's data belongs to (PLAN.md §11). Absent on data
   * from before accounts existed. Not indexed, so no schema version bump.
   */
  owner?: string;
}

/**
 * Ids for new rows in the auto-id tables. Shared by every instance in this
 * page, so ids stay strictly increasing however many are created per ms.
 */
const newRecordId = createIdGenerator();

export class MealPrepDatabase extends Dexie {
  ingredients!: Table<Ingredient, number>;
  components!: Table<Component, number>;
  batches!: Table<Batch, number>;
  fridgeEntries!: Table<FridgeEntry, number>;
  stockAdjustments!: Table<StockAdjustment, number>;
  mealLogs!: Table<MealLog, number>;
  quickAddFavorites!: Table<QuickAddFavorite, number>;
  foodCache!: Table<FoodCacheEntry, string>;
  searchCache!: Table<SearchCacheEntry, string>;
  targets!: Table<NutrientTarget, string>;
  weightEntries!: Table<WeightEntry, string>;
  plan!: Table<Plan, string>;
  settings!: Table<AppSettings, string>;
  syncShadow!: Table<SyncShadowRow, string>;
  syncOutbox!: Table<SyncOutboxRow, string>;
  syncMeta!: Table<SyncMetaRow, string>;
  scratchpads!: Table<Scratchpad, number>;

  /** The name is a parameter only so tests can use throwaway databases. */
  constructor(name = 'meal-prep') {
    super(name);

    this.version(1).stores({
      ingredients: '++id, name, source, [source+sourceId]',

      components: '++id, name, category',

      // [status+scheduledFor] serves both the week view and the past-due nudge.
      batches: '++id, componentId, scheduledFor, status, [status+scheduledFor]',

      // `remaining` is indexed so the Fridge can list only what is left.
      fridgeEntries: '++id, batchId, componentId, remaining, cookedAt',

      stockAdjustments: '++id, fridgeEntryId, reason, createdAt',

      // `date` is the local 'YYYY-MM-DD' day, which is what every view groups by.
      mealLogs: '++id, date, loggedAt',

      quickAddFavorites: '++id, label, useCount, lastUsedAt',

      // Keyed by `${source}:${sourceId}` so a repeat lookup is a direct get.
      foodCache: 'key, source, fetchedAt',

      // Primary key is the canonical nutrient key — one target per nutrient.
      targets: 'key',

      // Single row, id 'settings'.
      settings: 'id',
    });

    // v2 (Phase 2): remembers which foods a search returned, so repeating a
    // search is instant and works offline. The edge cache only helps requests
    // that actually leave the device.
    this.version(2).stores({
      searchCache: 'query, fetchedAt',
    });

    // v3 (Plan): body weight and the editable plan itself.
    this.version(3)
      .stores({
        // One row per day — the date IS the key, so logging twice corrects
        // rather than duplicating.
        weightEntries: 'date, loggedAt',
        plan: 'id',
      })
      .upgrade(async (transaction) => {
        // Targets predating this version have no `direction`. Defaulting every
        // one to 'min' would turn sodium into a goal to reach, so the seeds
        // decide, and anything unknown stays a minimum.
        await transaction
          .table('targets')
          .toCollection()
          .modify((target: { key?: string; direction?: string }) => {
            if (target.direction !== undefined) return;
            target.direction =
              target.key === undefined ? 'min' : (defaultTargetFor(target.key)?.direction ?? 'min');
          });
      });

    // v4 (2026-10-06): omega-3 and omega-6 totals, asked for by name. No new
    // index — this only gives an existing database the two default goals and
    // pins them, so Trends and the weekly bars show them without a trip to
    // Settings. A fresh install gets both from the defaults instead.
    this.version(4)
      .stores({})
      .upgrade(async (transaction) => {
        for (const key of OMEGA_TOTAL_KEYS) {
          const targets = transaction.table('targets');
          const seed = defaultTargetFor(key);
          if (seed !== undefined && (await targets.get(key)) === undefined) {
            await targets.put(seed);
          }
        }
        await transaction
          .table('settings')
          .toCollection()
          .modify((settings: { pinnedNutrients?: string[] }) => {
            const pinned = settings.pinnedNutrients ?? [];
            // Empty means "use the defaults", which already include both.
            if (pinned.length === 0) return;
            settings.pinnedNutrients = [
              ...pinned,
              ...OMEGA_TOTAL_KEYS.filter((key) => !pinned.includes(key)),
            ];
          });
      });

    // v5 (2026-10-07): sync bookkeeping. Local-only and never backed up —
    // they describe THIS device's relationship with the database, which
    // means nothing on another device. See db/sync.ts.
    this.version(5).stores({
      syncShadow: 'key',
      syncOutbox: 'key',
      syncMeta: 'id',
    });

    // v6 (2026-10-08): the Experiment tab's scratchpads. Synced and backed up
    // like any other user data — the user asked for everything saved.
    this.version(6).stores({
      scratchpads: '++id, updatedAt',
    });

    // Every new row in an auto-id table gets an id no other device will also
    // hand out. IndexedDB's own counter starts at 1 on every device, which is
    // harmless alone and a collision the moment two devices share a database.
    // Assigned here, centrally, so not one of the many `add` calls across the
    // app had to change — and none can forget. An explicit id is left alone.
    for (const [name, spec] of Object.entries(SYNC_TABLES)) {
      if (!spec.autoId) continue;
      this.table(name).hook('creating', (_primKey, row: Record<string, unknown>) => {
        if (row[spec.key] === undefined) row[spec.key] = newRecordId();
      });
    }
  }
}

const OMEGA_TOTAL_KEYS = ['omega3_total_g', 'omega6_total_g'] as const;

export const db = new MealPrepDatabase();

/** Every table name, in a stable order. Import validates against this list. */
export const TABLE_NAMES = [
  'ingredients',
  'components',
  'batches',
  'fridgeEntries',
  'stockAdjustments',
  'mealLogs',
  'quickAddFavorites',
  'foodCache',
  'searchCache',
  'targets',
  'settings',
  'weightEntries',
  'plan',
  'scratchpads',
] as const;

/**
 * What a backup actually writes.
 *
 * The caches are excluded deliberately: they are re-fetchable, `foodCache.raw`
 * holds whole API payloads, and a backup should be the user's data — not a
 * copy of USDA's. Import still ACCEPTS them, so an older backup that included
 * them restores cleanly.
 */
export const BACKUP_TABLE_NAMES = TABLE_NAMES.filter(
  (name) => name !== 'foodCache' && name !== 'searchCache',
);

export type TableName = (typeof TABLE_NAMES)[number];
