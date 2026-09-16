/**
 * Core data shapes. Plain data only — no Dexie, no React (see CLAUDE.md).
 *
 * `src/db/schema.ts` imports these; nothing here imports from `db/`, which is
 * what keeps the domain layer testable without a browser.
 */

// ── Nutrition primitives ────────────────────────────────────────────────────

/**
 * Canonical nutrient key → amount in that nutrient's canonical unit.
 *
 * Sparse by design: a key that is ABSENT means "no data", which is not the
 * same as a key present with value 0. Rice has no B12 value; it does not have
 * zero B12. Never use truthiness to test for data — an explicit 0 (0 g trans
 * fat) is a real measurement. Test with `key in map`.
 */
export type NutrientMap = Record<string, number>;

/**
 * Canonical nutrient key → 0..1, the fraction of contributing grams that
 * actually carried data for that nutrient. See PLAN.md §3c.
 *
 * A day reading `2.1 µg B12 · coverage 0.68` is honest; the same number with
 * missing data silently treated as zero is not.
 */
export type Coverage = Record<string, number>;

/** A nutrient total together with the evidence behind it. */
export interface NutrientAggregate {
  nutrients: NutrientMap;
  coverage: Coverage;
  /** Total weight of everything that contributed, data or not. */
  totalGrams: number;
}

/** One weighted contribution to an aggregate. */
export interface NutrientContribution {
  /** Already scaled to the amount actually eaten/used. */
  nutrients: NutrientMap;
  /** Weight of this contribution, used for coverage weighting. */
  grams: number;
  /**
   * Optional prior coverage, for aggregating things that are themselves
   * aggregates (a Component built from ingredients, a day built from meals).
   * Absent means "every key present in `nutrients` is fully covered".
   */
  coverage?: Coverage;
}

/**
 * Drives the UI control and the calendar mark ONLY — never the arithmetic.
 * Both styles use `per-unit = nutritionPerBase / baseQuantity`. See PLAN.md §3a.
 */
export type PortionStyle = 'discrete' | 'bulk';

/** How confident `resolveToGrams` is, which feeds coverage. */
export type GramConfidence =
  | 'exact' // mass unit — no guessing involved
  | 'portion' // a USDA foodPortions gram weight for this exact portion
  | 'user' // the user told us once and we cached it
  | 'density' // ingredient density, or the builtin table — approximate
  | 'assumed' // fell back to a generic density
  | 'unknown'; // could not resolve at all

export interface GramResult {
  grams: number;
  confidence: GramConfidence;
}

// ── Entities ────────────────────────────────────────────────────────────────

export type FoodSource = 'usda' | 'off' | 'manual';

export interface Ingredient {
  id?: number;
  name: string;
  source: FoodSource;
  /** FDC id, or OFF barcode. Absent for manual entries. */
  sourceId?: string;
  /** Canonical basis for every ingredient, whatever the source reported. */
  nutritionPer100g: NutrientMap;
  /** g per ml, when known — lets volume units resolve exactly. */
  densityGPerMl?: number;
  /** Portion label ("1 tbsp") → grams. Seeded from USDA, extended by the user. */
  portionGrams?: Record<string, number>;
  createdAt: number;
  updatedAt: number;
}

export interface ComponentIngredient {
  ingredientId: number;
  quantity: number;
  unit: string;
  /** Display order; maintained by the dnd-kit reorder in Phase 3. */
  order: number;
}

export interface Component {
  id?: number;
  name: string;
  /** Free hex, checked for perceptual distinctness on save (PLAN.md §1.1). */
  color: string;
  category?: string;
  portionStyle: PortionStyle;
  /** 6 servings, or 3000 g. */
  baseQuantity: number;
  baseUnit: string;
  ingredients: ComponentIngredient[];
  /** For the WHOLE base batch, not per unit. */
  nutritionPerBase: NutrientMap;
  coveragePerBase: Coverage;
  /** Total cooked weight of the base batch. */
  totalGrams: number;
  createdAt: number;
  updatedAt: number;
}

export type BatchStatus = 'planned' | 'cooked' | 'skipped';

/**
 * A scheduled cook. Snapshots its Component so editing the recipe later never
 * rewrites history (PLAN.md §3d).
 */
export interface Batch {
  id?: number;
  componentId: number;
  /** Local calendar day, 'YYYY-MM-DD' — never a timestamp. */
  scheduledFor: string;
  /** Multiplier on the base batch: 2 = cook double. */
  scale: number;
  status: BatchStatus;
  cookedAt?: number;
  componentName: string;
  componentColor: string;
  portionStyle: PortionStyle;
  baseQuantity: number;
  baseUnit: string;
  nutritionPerBase: NutrientMap;
  coveragePerBase: Coverage;
  totalGrams: number;
  createdAt: number;
}

/** Cooked stock. Snapshots nutrition per unit at cook time. */
export interface FridgeEntry {
  id?: number;
  batchId: number;
  componentId: number;
  componentName: string;
  componentColor: string;
  portionStyle: PortionStyle;
  unit: string;
  /** Actual yield confirmed at "Mark cooked", which may differ from planned. */
  initialQuantity: number;
  /** Mutated only inside a Dexie transaction (PLAN.md §3e). */
  remaining: number;
  nutritionPerUnit: NutrientMap;
  coverage: Coverage;
  gramsPerUnit: number;
  cookedAt: number;
  createdAt: number;
}

export type AdjustmentReason = 'discard' | 'correction' | 'spoiled';

/** Audit trail for stock that moved without being eaten. Never nutrition. */
export interface StockAdjustment {
  id?: number;
  fridgeEntryId: number;
  /** Signed, in the entry's unit. Negative for a discard. */
  delta: number;
  reason: AdjustmentReason;
  note?: string;
  createdAt: number;
}

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface MealLogItem {
  kind: 'fridge' | 'quick';
  /** Set when kind === 'fridge'; the entry the stock came out of. */
  fridgeEntryId?: number;
  label: string;
  quantity: number;
  unit: string;
  grams: number;
  /** Snapshot, already scaled to `quantity`. */
  nutrients: NutrientMap;
  coverage: Coverage;
}

export interface MealLog {
  id?: number;
  /** Local calendar day, 'YYYY-MM-DD'. */
  date: string;
  loggedAt: number;
  slot?: MealSlot;
  items: MealLogItem[];
  /** Aggregate of `items`, snapshotted so Day Detail is a pure read. */
  nutrients: NutrientMap;
  coverage: Coverage;
  totalGrams: number;
}

export interface QuickAddFavorite {
  id?: number;
  label: string;
  quantity: number;
  unit: string;
  grams: number;
  nutrients: NutrientMap;
  coverage: Coverage;
  useCount: number;
  lastUsedAt?: number;
  createdAt: number;
}

/**
 * A food from any source, already mapped into canonical nutrient keys.
 *
 * The common shape every adapter produces, so search results, the cache and the
 * ingredient editor all speak one language regardless of where a food came
 * from.
 */
export interface AdaptedFood {
  source: FoodSource;
  /** FDC id, or OFF barcode. */
  sourceId: string;
  name: string;
  /** FDC dataset ('Foundation', 'Branded'…) — shown as a provenance badge. */
  dataType?: string;
  brand?: string;
  /** Canonical basis for every source, whatever units it reported. */
  nutritionPer100g: NutrientMap;
  /** Portion label → grams for ONE of it, feeding `resolveToGrams`. */
  portionGrams?: Record<string, number>;
  /**
   * True when this came from FDC's detail endpoint, which reports full
   * precision. Search results round to ~3 significant figures, so a food
   * without this flag is slightly approximate — see `usda.live.test.ts`.
   */
  precise?: boolean;
}

/** Cached lookup result, so a repeat search costs nothing. */
export interface FoodCacheEntry extends AdaptedFood {
  /** `${source}:${sourceId}` */
  key: string;
  fetchedAt: number;
  /** Raw payload, kept so a registry fix can re-map without a refetch. */
  raw?: unknown;
}

/**
 * A search query → the food keys it returned.
 *
 * Separate from `foodCache` because that is keyed per food. This is what makes
 * repeating a search instant offline; the edge cache only helps a request that
 * actually leaves the device.
 */
export interface SearchCacheEntry {
  /** Lowercased, trimmed query text. */
  query: string;
  /** `${source}:${sourceId}` keys into `foodCache`, in result order. */
  keys: string[];
  fetchedAt: number;
}

// `NutrientTarget`, `Plan`, `WeightGoal` and `WeightEntry` live in
// `@/domain/plan` — they carry goal direction and weekly logic that belongs
// beside the functions reading them. Re-exported so `@/domain/types` stays the
// single import for entity shapes.
export type {
  GoalDirection,
  NutrientTarget,
  Plan,
  WeightEntry,
  WeightGoal,
  WeightUnit,
} from '@/domain/plan';

export interface AppSettings {
  id: 'settings';
  /** Nutrient keys shown as bars in Specific mode, in display order. */
  pinnedNutrients: string[];
  /** Open Food Facts User-Agent contact. Blocks Phase 2 until set. */
  offContact?: string;
  lastBackupAt?: number;
}
