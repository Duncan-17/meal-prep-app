/**
 * Making a page of FoodData Central results choosable.
 *
 * Two problems, both measured against the live API on 2026-10-06:
 *
 * 1. **FDC's ranking is poor for short queries.** "egg" led with a Snickers
 *    egg, and "rice" put no plain rice anywhere in the first 25 — seven
 *    Branded products all named just "RICE" came first. FDC scores short
 *    descriptions highly and knows nothing about which result a person means.
 *    `rankFoods` re-orders a larger page: plain foods whose name IS the query
 *    first, packaged products after.
 *
 * 2. **Results are indistinguishable.** USDA packs the difference into the tail
 *    of a comma list — "Egg, whole, cooked, fried" — and "raw" on a grain
 *    means DRY, which nobody guesses. `describeFood` splits the name into a
 *    headline and its details, and pulls out how the food was prepared.
 *
 * Pure: no React, no I/O. The rules are heuristics, so they are tested
 * against the real descriptions that prompted them.
 */

import type { AdaptedFood } from '@/domain/types';

/** No one needs more than this many choices; a better query beats a longer list. */
export const RESULT_CAP = 15;

// ── Ranking ─────────────────────────────────────────────────────────────────

/**
 * Generic data first. Foundation edges out SR Legacy only so that, when both
 * describe the same food, the newer lab measurement survives `dedupe`.
 */
const DATA_TYPE_SCORE: Record<string, number> = {
  Foundation: 13,
  'SR Legacy': 12,
  'Survey (FNDDS)': 8,
  Branded: 0,
};

/**
 * Best match first, duplicates dropped, at most `limit`.
 *
 * Stable: ties keep FDC's own order, which still carries real signal.
 */
export function rankFoods(
  foods: readonly AdaptedFood[],
  query: string,
  limit: number = RESULT_CAP,
): AdaptedFood[] {
  const wanted = words(query);
  if (wanted.length === 0) return dedupe(foods).slice(0, limit);

  const scored = foods.map((food, index) => ({ food, index, score: scoreFood(food, wanted) }));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return dedupe(scored.map((entry) => entry.food)).slice(0, limit);
}

function scoreFood(food: AdaptedFood, wanted: readonly string[]): number {
  const head = words(food.name.split(',')[0] ?? '');
  const all = new Set(words(food.name));

  let score = DATA_TYPE_SCORE[food.dataType ?? ''] ?? 4;

  // The name IS the query: "Egg, whole, raw" or "Eggs, Grade A…" for "egg".
  if (sameWords(head, wanted)) score += 40;
  // The name starts with it: "Rice noodles", "Egg omelet".
  else if (head[0] === wanted[0]) score += 20;

  const found = wanted.filter((word) => all.has(word)).length;
  score += 15 * (found / wanted.length);

  // Among equals, the simpler description is usually the one meant.
  score -= food.name.split(',').length;

  return score;
}

/**
 * Drop repeats of the same food. Foundation and SR Legacy both list "Egg,
 * whole, dried"; ranking put the Foundation copy first, so first wins.
 * Branded products are kept apart by brand — two brands of "RICE" are two
 * products.
 */
function dedupe(foods: readonly AdaptedFood[]): AdaptedFood[] {
  const seen = new Set<string>();
  const out: AdaptedFood[] = [];
  for (const food of foods) {
    const branded = food.dataType === 'Branded';
    const key = `${branded ? 'b' : 'g'}|${food.name.toLowerCase()}|${branded ? (food.brand ?? '').toLowerCase() : ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(food);
  }
  return out;
}

/** Lowercased words, crude plurals folded: "Eggs" and "egg" match. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) =>
      word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word,
    );
}

function sameWords(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((word) => set.has(word));
}

// ── Describing ──────────────────────────────────────────────────────────────

export interface FoodDescription {
  /** "Egg" — the first part of the name, title-cased if it was shouted. */
  title: string;
  /** "whole" — the rest, minus anything already said by `prep`. */
  detail: string | null;
  /** "Cooked · fried", "Dry · uncooked" — how the food is as described. */
  prep: string | null;
  /** True when `prep` is inferred from the numbers rather than read. */
  prepInferred: boolean;
  /** Whose it is, for packaged food — "Snickers". */
  brand: string | null;
  /**
   * What kind of thing it is — "Candy", "Baked Products". On a packaged
   * result this is often the only clue: FDC's "EGG" by Snickers is a candy.
   */
  category: string | null;
  /** Plain-language provenance: "USDA lab data", "Packaged product". */
  source: string;
}

const SOURCE_LABELS: Record<string, string> = {
  Foundation: 'USDA lab data',
  'SR Legacy': 'USDA reference',
  'Survey (FNDDS)': 'USDA, as eaten',
  Branded: 'Packaged product',
};

/** Ways a food is cooked. Each is shown by name — "fried" is the difference. */
const COOKING_METHODS = new Set([
  'boiled',
  'hard-boiled',
  'soft-boiled',
  'poached',
  'fried',
  'pan-fried',
  'deep-fried',
  'stir-fried',
  'scrambled',
  'omelet',
  'baked',
  'roasted',
  'grilled',
  'broiled',
  'steamed',
  'braised',
  'stewed',
  'simmered',
  'microwaved',
  'sauteed',
  'toasted',
]);

/**
 * Foods USDA calls "raw" when it means DRY. Raw rice is the bag in the
 * cupboard — about 360 kcal per 100 g, nearly three times cooked rice.
 * Logging one as the other is the single biggest error a search can cause.
 */
const DRY_STAPLES = new Set([
  'rice',
  'pasta',
  'noodle',
  'spaghetti',
  'macaroni',
  'oat',
  'quinoa',
  'barley',
  'couscous',
  'bulgur',
  'lentil',
  'millet',
  'farro',
  'buckwheat',
]);

/** Packaged things that are ready to eat even though they are made of rice. */
const READY_TO_EAT = /cracker|cake|chip|snack|crisp|pudding|cereal|bar\b|milk|bread|flour/i;

/** Describe one search result so it can be told apart from its neighbours. */
export function describeFood(food: AdaptedFood): FoodDescription {
  const segments = food.name
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const lower = segments.map((part) => part.toLowerCase());
  const tokens = new Set(lower.flatMap((part) => part.split(/\s+/)));
  const staple = isDryStaple(food);

  const states: string[] = [];
  const consumed = new Set<number>();

  const method = lower.findIndex((part) => COOKING_METHODS.has(part));
  const cookedAt = lower.indexOf('cooked');
  if (method >= 0) {
    states.push(`Cooked · ${lower[method]}`);
    consumed.add(method);
    if (cookedAt >= 0) consumed.add(cookedAt);
  } else if (cookedAt >= 0 || tokens.has('cooked')) {
    states.push('Cooked');
    if (cookedAt >= 0) consumed.add(cookedAt);
  }

  /** Record the first of `words` that is a whole segment of the name. */
  const markState = (label: string, ...candidates: string[]) => {
    const at = candidates.map((word) => lower.indexOf(word)).find((index) => index >= 0);
    if (at === undefined) return;
    states.push(label);
    consumed.add(at);
  };

  if (states.length === 0) {
    if (staple) markState('Dry · uncooked', 'raw', 'dry', 'uncooked');
    else markState('Raw', 'raw', 'uncooked');
  }
  markState('Dried', 'dried');
  markState('Unprepared', 'unprepared');
  markState('Prepared', 'prepared');
  markState('Canned', 'canned');
  markState('Frozen', 'frozen');

  let prep = states.length > 0 ? states.join(' · ') : null;
  let prepInferred = false;

  // A packaged staple named only "RICE" says nothing; its energy density does.
  // Dry rice and pasta sit around 350–370 kcal/100 g, cooked around 110–160.
  if (prep === null && staple && food.dataType === 'Branded') {
    const kcal = food.nutritionPer100g.energy_kcal;
    if (kcal !== undefined && kcal >= 300) prep = 'Likely dry · uncooked';
    else if (kcal !== undefined && kcal > 0 && kcal <= 200) prep = 'Likely cooked';
    prepInferred = prep !== null;
  }

  const rest = segments
    .slice(1)
    .filter((_, index) => !consumed.has(index + 1))
    // USDA shorthand for "not further specified" — the generic version.
    .map((part) => (part === 'NFS' ? 'type not specified' : part));

  return {
    title: tidy(segments[0] ?? food.name),
    detail: rest.length > 0 ? rest.join(', ') : null,
    prep,
    prepInferred,
    brand: food.dataType === 'Branded' && food.brand !== undefined ? tidy(food.brand) : null,
    category: food.category ?? null,
    source: SOURCE_LABELS[food.dataType ?? ''] ?? food.dataType ?? 'Unknown source',
  };
}

function isDryStaple(food: AdaptedFood): boolean {
  if (READY_TO_EAT.test(food.name)) return false;
  if (/mature seeds/i.test(food.name)) return true;
  const head = words(food.name.split(',')[0] ?? '');
  return head.some((word) => DRY_STAPLES.has(word));
}

/** "RICE" becomes "Rice", "WEIS" becomes "Weis". Shouting is a Branded habit. */
function tidy(text: string): string {
  if (text !== text.toUpperCase() || !/[A-Z]/.test(text)) return text;
  return text.toLowerCase().replace(/\b[a-z]/g, (char) => char.toUpperCase());
}
