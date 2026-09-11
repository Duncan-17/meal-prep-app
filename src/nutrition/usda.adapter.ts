/**
 * FoodData Central → canonical nutrient keys.
 *
 * Unit conversion happens HERE and nowhere else (PLAN.md §3b). Downstream code
 * may assume any value in a `NutrientMap` is already in the registry's
 * canonical unit for that key.
 *
 * Two shapes have to be handled, because FDC is not consistent between
 * endpoints:
 *
 *   /foods/search →  { nutrientNumber: '203', unitName: 'G',  value: 19.7 }
 *   /food/{id}    →  { nutrient: { number: '203', unitName: 'g' }, amount: 19.7 }
 *
 * Anything unparseable is skipped rather than guessed at. A nutrient we cannot
 * convert with confidence must stay ABSENT, because absent means "no data" and
 * a wrong number is worse than a gap the coverage machinery can report.
 */

import { getNutrientByUsdaNumber, type NutrientUnit } from '@/nutrition/registry';
import { normalizeUnit } from '@/nutrition/units';
import type { AdaptedFood, NutrientMap } from '@/domain/types';

export type { AdaptedFood };

/** Grams per unit of mass, for converting between reported and canonical. */
const MASS_TO_GRAMS: Record<string, number> = {
  g: 1,
  mg: 1e-3,
  ug: 1e-6,
  mcg: 1e-6,
  µg: 1e-6,
  kg: 1000,
};

/**
 * Convert a reported amount into the registry's canonical unit.
 * Returns null when the conversion is not safe to make.
 */
export function convertToCanonical(
  value: number,
  reportedUnit: string,
  canonicalUnit: NutrientUnit,
): number | null {
  if (!Number.isFinite(value)) return null;

  const reported = reportedUnit.trim().toLowerCase();
  const canonical = canonicalUnit.toLowerCase();

  if (reported === canonical) return value;

  const from = MASS_TO_GRAMS[reported];
  const to = MASS_TO_GRAMS[canonical];
  if (from !== undefined && to !== undefined) {
    return (value * from) / to;
  }

  // IU cannot be converted to µg without a per-substance factor, and kJ/kcal
  // is a real conversion but a different nutrient key. Skip both rather than
  // inventing a number.
  return null;
}

/** Map one FDC food record — from either endpoint — into canonical form. */
export function adaptUsdaFood(raw: unknown): AdaptedFood | null {
  const food = asRecord(raw);
  if (food === null) return null;

  const fdcId = food.fdcId;
  const sourceId =
    typeof fdcId === 'number' ? String(fdcId) : typeof fdcId === 'string' ? fdcId : null;
  if (sourceId === null) return null;

  const name = asString(food.description);
  if (name === null) return null;

  const adapted: AdaptedFood = {
    source: 'usda',
    sourceId,
    name,
    dataType: asString(food.dataType) ?? 'Unknown',
    nutritionPer100g: adaptNutrients(food.foodNutrients),
  };

  const brand = asString(food.brandOwner) ?? asString(food.brandName);
  if (brand !== null && brand.length > 0) adapted.brand = brand;

  const portions = adaptPortions(food.foodPortions);
  if (portions !== null) adapted.portionGrams = portions;

  return adapted;
}

/** Map a `/foods/search` response into a list of adapted foods. */
export function adaptUsdaSearchResponse(raw: unknown): AdaptedFood[] {
  const body = asRecord(raw);
  const foods = body?.foods;
  if (!Array.isArray(foods)) return [];

  const results: AdaptedFood[] = [];
  for (const entry of foods) {
    const adapted = adaptUsdaFood(entry);
    if (adapted !== null) results.push(adapted);
  }
  return results;
}

function adaptNutrients(raw: unknown): NutrientMap {
  if (!Array.isArray(raw)) return {};

  const out: NutrientMap = {};

  for (const entry of raw) {
    const item = asRecord(entry);
    if (item === null) continue;

    // Shape B nests the descriptor; shape A flattens it.
    const nested = asRecord(item.nutrient);

    const number =
      asString(nested?.number) ??
      asString(item.nutrientNumber) ??
      numberAsString(nested?.number) ??
      numberAsString(item.nutrientNumber);
    if (number === null) continue;

    const def = getNutrientByUsdaNumber(number);
    if (def === undefined) continue; // not a nutrient we track

    const unit = asString(nested?.unitName) ?? asString(item.unitName);
    if (unit === null) continue;

    const amount = asNumber(item.amount) ?? asNumber(item.value);
    if (amount === null) continue;

    const converted = convertToCanonical(amount, unit, def.unit);
    if (converted === null) continue;

    // FDC can list a nutrient twice across derivations. First wins — the
    // datasets order best-quality first.
    if (!(def.key in out)) out[def.key] = converted;
  }

  return out;
}

/**
 * `foodPortions` → grams for ONE of each portion.
 *
 * Keys are normalised through `normalizeUnit`, so a USDA "tablespoon" lands on
 * the same `tbsp` key the ingredient editor uses and `resolveToGrams` finds it.
 */
function adaptPortions(raw: unknown): Record<string, number> | null {
  if (!Array.isArray(raw)) return null;

  const out: Record<string, number> = {};

  for (const entry of raw) {
    const portion = asRecord(entry);
    if (portion === null) continue;

    const gramWeight = asNumber(portion.gramWeight);
    if (gramWeight === null || gramWeight <= 0) continue;

    const amount = asNumber(portion.amount) ?? 1;
    if (amount <= 0) continue;

    const measure = asRecord(portion.measureUnit);
    const measureName = asString(measure?.name);
    const modifier = asString(portion.modifier);

    // FDC uses the literal string 'undetermined' when there is no measure unit.
    const label = measureName !== null && measureName !== 'undetermined' ? measureName : modifier;
    if (label === null || label.trim().length === 0) continue;

    const key = normalizeUnit(label);
    if (!(key in out)) out[key] = gramWeight / amount;
  }

  return Object.keys(out).length > 0 ? out : null;
}

// ── Narrow, no-`any` accessors ──────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  // FDC occasionally sends numerics as strings.
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function numberAsString(value: unknown): string | null {
  return typeof value === 'number' ? String(value) : null;
}
