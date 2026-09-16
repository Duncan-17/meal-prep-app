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
  SearchCacheEntry,
  StockAdjustment,
  WeightEntry,
} from '@/domain/types';

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

  constructor() {
    super('meal-prep');

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
  }
}

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
