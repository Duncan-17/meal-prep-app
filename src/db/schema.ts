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

import type {
  AppSettings,
  Batch,
  Component,
  FoodCacheEntry,
  FridgeEntry,
  Ingredient,
  MealLog,
  NutrientTarget,
  QuickAddFavorite,
  StockAdjustment,
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
  targets!: Table<NutrientTarget, string>;
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
  }
}

export const db = new MealPrepDatabase();

/** Every table name, in a stable order. Backup relies on this list. */
export const TABLE_NAMES = [
  'ingredients',
  'components',
  'batches',
  'fridgeEntries',
  'stockAdjustments',
  'mealLogs',
  'quickAddFavorites',
  'foodCache',
  'targets',
  'settings',
] as const;

export type TableName = (typeof TABLE_NAMES)[number];
