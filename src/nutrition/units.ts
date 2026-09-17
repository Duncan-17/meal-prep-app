/**
 * Unit handling and the grams resolution ladder.
 *
 * Everything nutritional is ultimately per-gram, so every quantity the user
 * types has to become grams. Some of those conversions are exact and some are
 * educated guesses, and the difference matters — so `resolveToGrams` returns a
 * confidence alongside the number rather than pretending they are equivalent.
 * See PLAN.md §4.
 */

import type { GramConfidence, GramResult, Ingredient } from '@/domain/types';

// ── Unit tables ─────────────────────────────────────────────────────────────

const MASS_TO_GRAMS: Record<string, number> = {
  g: 1,
  kg: 1000,
  mg: 0.001,
  oz: 28.349523125,
  lb: 453.59237,
};

/** US customary volumes, which is what USDA portion data uses. */
const VOLUME_TO_ML: Record<string, number> = {
  ml: 1,
  l: 1000,
  tsp: 4.92892159375,
  tbsp: 14.78676478125,
  fl_oz: 29.5735295625,
  cup: 236.5882365,
  pint: 473.176473,
  quart: 946.352946,
  gallon: 3785.411784,
};

/** Units that count things rather than measure them. Need a gram weight. */
const COUNT_UNITS = new Set(['each', 'serving', 'piece', 'slice', 'unit', 'portion']);

const UNIT_ALIASES: Record<string, string> = {
  gram: 'g',
  grams: 'g',
  gr: 'g',
  kilogram: 'kg',
  kilograms: 'kg',
  kilo: 'kg',
  milligram: 'mg',
  milligrams: 'mg',
  ounce: 'oz',
  ounces: 'oz',
  pound: 'lb',
  pounds: 'lb',
  lbs: 'lb',
  milliliter: 'ml',
  millilitre: 'ml',
  milliliters: 'ml',
  millilitres: 'ml',
  liter: 'l',
  litre: 'l',
  liters: 'l',
  litres: 'l',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  tsps: 'tsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  tbsps: 'tbsp',
  tbs: 'tbsp',
  'fluid ounce': 'fl_oz',
  'fluid ounces': 'fl_oz',
  floz: 'fl_oz',
  'fl oz': 'fl_oz',
  cups: 'cup',
  pints: 'pint',
  pt: 'pint',
  quarts: 'quart',
  qt: 'quart',
  gal: 'gallon',
  gallons: 'gallon',
  servings: 'serving',
  pieces: 'piece',
  slices: 'slice',
  units: 'unit',
  portions: 'portion',
  ea: 'each',
  // USDA writes "1 item" for whole foods like a burger or a muffin. It means
  // the same as "each", and folding it in makes those resolve without asking.
  item: 'each',
  items: 'each',
};

/**
 * Rough densities in g/ml for the handful of things people measure by volume.
 * Matched on a substring of the ingredient name, longest first so "olive oil"
 * beats "oil". Approximate by nature — anything resolved this way is flagged
 * `density`, never `exact`.
 */
const BUILTIN_DENSITIES: ReadonlyArray<readonly [string, number]> = [
  ['olive oil', 0.918],
  ['vegetable oil', 0.92],
  ['coconut oil', 0.924],
  ['oil', 0.92],
  ['honey', 1.42],
  ['maple syrup', 1.32],
  ['milk', 1.03],
  ['cream', 1.01],
  ['yogurt', 1.03],
  ['water', 1.0],
  ['stock', 1.0],
  ['broth', 1.0],
  ['vinegar', 1.01],
  ['soy sauce', 1.2],
  ['flour', 0.53],
  ['sugar', 0.85],
  ['rice', 0.85],
  ['oats', 0.41],
  ['salt', 1.22],
];

/** Water. Used only when nothing better is known, and flagged `assumed`. */
const FALLBACK_DENSITY = 1.0;

// ── Unit classification ─────────────────────────────────────────────────────

export function normalizeUnit(unit: string): string {
  const cleaned = unit.trim().toLowerCase().replace(/\.$/, '');
  return UNIT_ALIASES[cleaned] ?? cleaned;
}

export function isMassUnit(unit: string): boolean {
  return normalizeUnit(unit) in MASS_TO_GRAMS;
}

export function isVolumeUnit(unit: string): boolean {
  return normalizeUnit(unit) in VOLUME_TO_ML;
}

export function isCountUnit(unit: string): boolean {
  return COUNT_UNITS.has(normalizeUnit(unit));
}

/** Convert between two mass units, or between two volume units. */
export function convert(quantity: number, from: string, to: string): number {
  const a = normalizeUnit(from);
  const b = normalizeUnit(to);
  if (a === b) return quantity;

  const massFrom = MASS_TO_GRAMS[a];
  const massTo = MASS_TO_GRAMS[b];
  if (massFrom !== undefined && massTo !== undefined) {
    return (quantity * massFrom) / massTo;
  }

  const volFrom = VOLUME_TO_ML[a];
  const volTo = VOLUME_TO_ML[b];
  if (volFrom !== undefined && volTo !== undefined) {
    return (quantity * volFrom) / volTo;
  }

  throw new Error(`convert: cannot convert ${from} to ${to} without a density`);
}

export function toMilliliters(quantity: number, unit: string): number | undefined {
  const factor = VOLUME_TO_ML[normalizeUnit(unit)];
  return factor === undefined ? undefined : quantity * factor;
}

// ── The resolution ladder ───────────────────────────────────────────────────

/**
 * Resolve a quantity to grams, trying in order (PLAN.md §4):
 *
 *   1. mass unit                        → exact
 *   2. a gram weight the ingredient carries for this unit
 *      (USDA foodPortions, or the user answering once)
 *   3. volume × the ingredient's own density                → density
 *   4. volume × a builtin density matched on the name       → density
 *   5. volume × water                                       → assumed
 *
 * Anything else returns `unknown` with 0 grams, which the UI turns into a
 * one-time prompt for the gram weight — cached on the ingredient so it is only
 * ever asked once.
 */
export function resolveToGrams(
  quantity: number,
  unit: string,
  ingredient?: Pick<Ingredient, 'name' | 'densityGPerMl' | 'portionGrams'>,
): GramResult {
  const normalized = normalizeUnit(unit);

  // 1. Mass — no guessing involved.
  const massFactor = MASS_TO_GRAMS[normalized];
  if (massFactor !== undefined) {
    return { grams: quantity * massFactor, confidence: 'exact' };
  }

  // 2. A gram weight recorded against this exact unit.
  const portionGrams = ingredient?.portionGrams;
  if (portionGrams) {
    const perUnit = portionGrams[normalized] ?? portionGrams[unit.trim().toLowerCase()];
    if (perUnit !== undefined) {
      return { grams: quantity * perUnit, confidence: 'portion' };
    }
  }

  const milliliters = toMilliliters(quantity, normalized);
  if (milliliters !== undefined) {
    // 3. The ingredient's own density.
    const own = ingredient?.densityGPerMl;
    if (own !== undefined && own > 0) {
      return { grams: milliliters * own, confidence: 'density' };
    }

    // 4. Builtin table, matched on the ingredient name.
    const guessed = ingredient ? densityForName(ingredient.name) : undefined;
    if (guessed !== undefined) {
      return { grams: milliliters * guessed, confidence: 'density' };
    }

    // 5. Water, and say so.
    return { grams: milliliters * FALLBACK_DENSITY, confidence: 'assumed' };
  }

  // A count unit with no recorded weight, or a unit we have never seen.
  return { grams: 0, confidence: 'unknown' };
}

/** Longest match wins, so "olive oil" is not resolved as generic "oil". */
export function densityForName(name: string): number | undefined {
  const haystack = name.toLowerCase();
  let best: number | undefined;
  let bestLength = 0;
  for (const [needle, density] of BUILTIN_DENSITIES) {
    if (needle.length > bestLength && haystack.includes(needle)) {
      best = density;
      bestLength = needle.length;
    }
  }
  return best;
}

/** Does this need a one-time "how much does it weigh?" prompt? */
export function needsGramPrompt(result: GramResult): boolean {
  return result.confidence === 'unknown';
}

/** Ranked worst-first, for surfacing the least trustworthy conversion. */
const CONFIDENCE_RANK: Record<GramConfidence, number> = {
  unknown: 0,
  assumed: 1,
  density: 2,
  user: 3,
  portion: 4,
  exact: 5,
};

export function weakestConfidence(results: readonly GramResult[]): GramConfidence {
  let weakest: GramConfidence = 'exact';
  for (const result of results) {
    if (CONFIDENCE_RANK[result.confidence] < CONFIDENCE_RANK[weakest]) {
      weakest = result.confidence;
    }
  }
  return weakest;
}

/**
 * The most natural way to measure one of this food.
 *
 * A burger knows it weighs 291 g "per item"; defaulting that to 100 g makes
 * the user do arithmetic the data already did. Whole-unit portions win over
 * volumes, because "1 burger" is what someone actually buys and eats.
 */
export function defaultPortion(food: Pick<Ingredient, 'portionGrams'>): {
  quantity: number;
  unit: string;
} {
  const portions = food.portionGrams;
  if (portions !== undefined) {
    // Prefer a countable whole unit over a cup or a tablespoon.
    for (const unit of WHOLE_UNIT_PREFERENCE) {
      if (portions[unit] !== undefined) return { quantity: 1, unit };
    }
    const first = Object.keys(portions)[0];
    if (first !== undefined) return { quantity: 1, unit: first };
  }
  // Nothing known — 100 g is the basis every nutrition figure is quoted in.
  return { quantity: 100, unit: 'g' };
}

const WHOLE_UNIT_PREFERENCE = ['each', 'serving', 'piece', 'slice', 'unit', 'portion'];

/**
 * Units to offer for a food, its own portions first.
 *
 * The food's own measurements are the ones with real gram weights behind them;
 * the generic list below is a fallback that may need a density guess.
 */
export function unitOptionsFor(food: Pick<Ingredient, 'portionGrams'>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const unit of [...Object.keys(food.portionGrams ?? {}), ...COMMON_UNITS]) {
    if (seen.has(unit)) continue;
    seen.add(unit);
    out.push(unit);
  }
  return out;
}

/** Units offered in the ingredient editor, in a sensible order. */
export const COMMON_UNITS: readonly string[] = [
  'g',
  'kg',
  'oz',
  'lb',
  'ml',
  'l',
  'tsp',
  'tbsp',
  'cup',
  'fl_oz',
  'each',
  'serving',
];
