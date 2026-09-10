/**
 * Development seed data.
 *
 * Real-ish USDA numbers for the three components PLAN.md uses as its worked
 * example — Chicken Thighs, Rice and Guacamole. Two discrete, one bulk, so
 * both portion styles are exercised.
 *
 * Rice deliberately carries no B12 value while chicken does. That is not an
 * omission: it is the sparse-data case the coverage machinery exists for, and
 * seeing `coverage 0.7` on a real screen is worth more than a passing test.
 *
 * Never imported by production code — call it from the console during
 * development, or wire it behind `import.meta.env.DEV`.
 */

import { componentNutrition } from '@/domain/components';
import type { Component, Ingredient } from '@/domain/types';
import { db } from '@/db/schema';
import { ensureDefaults } from '@/db/init';

type SeedIngredient = Omit<Ingredient, 'id' | 'createdAt' | 'updatedAt'>;

const now = () => Date.now();

const INGREDIENTS: Record<string, SeedIngredient> = {
  chickenThigh: {
    name: 'Chicken thigh, boneless skinless, raw',
    source: 'manual',
    nutritionPer100g: {
      energy_kcal: 119,
      protein_g: 19.7,
      fat_g: 4.1,
      saturated_fat_g: 1.1,
      cholesterol_mg: 94,
      sodium_mg: 86,
      potassium_mg: 229,
      phosphorus_mg: 180,
      magnesium_mg: 22,
      iron_mg: 0.9,
      zinc_mg: 1.3,
      selenium_ug: 22,
      niacin_mg: 5.4,
      vitamin_b6_mg: 0.36,
      vitamin_b12_ug: 0.6,
    },
  },
  whiteRice: {
    name: 'White rice, long grain, raw',
    source: 'manual',
    nutritionPer100g: {
      energy_kcal: 365,
      protein_g: 7.1,
      fat_g: 0.66,
      carbs_g: 80,
      fiber_g: 1.3,
      // No vitamin_b12_ug — rice has no B12 value, which is not zero B12.
      iron_mg: 0.8,
      magnesium_mg: 25,
      phosphorus_mg: 115,
      potassium_mg: 115,
      zinc_mg: 1.1,
      thiamin_mg: 0.07,
      niacin_mg: 1.6,
    },
    densityGPerMl: 0.85,
  },
  oliveOil: {
    name: 'Olive oil, extra virgin',
    source: 'manual',
    nutritionPer100g: {
      energy_kcal: 884,
      fat_g: 100,
      saturated_fat_g: 13.8,
      monounsaturated_fat_g: 73,
      polyunsaturated_fat_g: 10.5,
      vitamin_e_mg: 14.35,
      vitamin_k_ug: 60.2,
    },
    densityGPerMl: 0.918,
    portionGrams: { tbsp: 13.5, tsp: 4.5 },
  },
  avocado: {
    name: 'Avocado, raw',
    source: 'manual',
    nutritionPer100g: {
      energy_kcal: 160,
      protein_g: 2,
      fat_g: 14.7,
      saturated_fat_g: 2.1,
      monounsaturated_fat_g: 9.8,
      carbs_g: 8.5,
      fiber_g: 6.7,
      potassium_mg: 485,
      magnesium_mg: 29,
      vitamin_c_mg: 10,
      vitamin_e_mg: 2.07,
      vitamin_k_ug: 21,
      folate_dfe_ug: 81,
    },
    portionGrams: { each: 150 },
  },
  limeJuice: {
    name: 'Lime juice, raw',
    source: 'manual',
    nutritionPer100g: {
      energy_kcal: 25,
      carbs_g: 8.4,
      vitamin_c_mg: 30,
      potassium_mg: 117,
    },
    densityGPerMl: 1.02,
  },
  salt: {
    name: 'Salt, table',
    source: 'manual',
    nutritionPer100g: { sodium_mg: 38758 },
    portionGrams: { tsp: 6 },
  },
};

interface SeedComponent {
  name: string;
  color: string;
  category: string;
  portionStyle: Component['portionStyle'];
  /** Servings for discrete. For bulk this is ignored — grams are used. */
  baseQuantity: number;
  baseUnit: string;
  /** ingredient key → grams in the base batch. */
  recipe: Record<string, number>;
}

const COMPONENTS: SeedComponent[] = [
  {
    name: 'Chicken Thighs',
    color: '#c2564a',
    category: 'Protein',
    portionStyle: 'discrete',
    baseQuantity: 6,
    baseUnit: 'serving',
    recipe: { chickenThigh: 1400, oliveOil: 30, salt: 12 },
  },
  {
    name: 'Rice',
    color: '#d8c9a3',
    category: 'Carb',
    portionStyle: 'discrete',
    baseQuantity: 6,
    baseUnit: 'serving',
    recipe: { whiteRice: 500, salt: 6 },
  },
  {
    name: 'Guacamole',
    color: '#6f9a52',
    category: 'Side',
    portionStyle: 'bulk',
    baseQuantity: 0, // replaced with total grams below
    baseUnit: 'g',
    recipe: { avocado: 600, limeJuice: 40, salt: 6 },
  },
];

/**
 * Wipe the working tables and insert the sample data.
 *
 * Leaves `targets` and `settings` alone unless they are missing, so a seed
 * never discards edited targets.
 */
export async function seedDevData(): Promise<void> {
  await ensureDefaults();

  // Array form: the variadic overload only takes five tables.
  await db.transaction(
    'rw',
    [db.ingredients, db.components, db.batches, db.fridgeEntries, db.stockAdjustments, db.mealLogs],
    async () => {
      await Promise.all([
        db.ingredients.clear(),
        db.components.clear(),
        db.batches.clear(),
        db.fridgeEntries.clear(),
        db.stockAdjustments.clear(),
        db.mealLogs.clear(),
      ]);

      const ids = new Map<string, number>();
      for (const [key, ingredient] of Object.entries(INGREDIENTS)) {
        const timestamp = now();
        const id = await db.ingredients.add({
          ...ingredient,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        ids.set(key, id);
      }

      for (const spec of COMPONENTS) {
        const entries = Object.entries(spec.recipe);

        const total = componentNutrition(
          entries.map(([key, grams]) => ({
            nutritionPer100g: INGREDIENTS[key]?.nutritionPer100g ?? {},
            grams,
          })),
        );

        // Bulk components are measured in grams, so the base quantity IS the
        // cooked weight. Discrete ones keep their serving count.
        const baseQuantity = spec.portionStyle === 'bulk' ? total.totalGrams : spec.baseQuantity;

        const timestamp = now();
        await db.components.add({
          name: spec.name,
          color: spec.color,
          category: spec.category,
          portionStyle: spec.portionStyle,
          baseQuantity,
          baseUnit: spec.baseUnit,
          ingredients: entries.map(([key, grams], index) => ({
            ingredientId: ids.get(key) ?? 0,
            quantity: grams,
            unit: 'g',
            order: index,
          })),
          nutritionPerBase: total.nutrients,
          coveragePerBase: total.coverage,
          totalGrams: total.totalGrams,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
    },
  );
}

/** Drop everything, including targets and settings. */
export async function resetDatabase(): Promise<void> {
  await db.delete();
  await db.open();
  await ensureDefaults();
}
