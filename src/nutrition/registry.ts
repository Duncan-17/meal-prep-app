/**
 * The canonical nutrient registry.
 *
 * Every nutrient the app can store has exactly one entry here, and every
 * adapter (USDA, Open Food Facts) maps its own field names onto these keys
 * WITH UNIT CONVERSION APPLIED AT THE ADAPTER. Call sites downstream can then
 * assume a value is already in `unit`. See PLAN.md §3b.
 *
 * `usdaNumber` is FoodData Central's nutrient number. These are stable and
 * well documented, but they are transcribed here rather than fetched — Phase 2
 * validates the whole table against live API responses, and any that turn out
 * wrong get corrected there rather than guessed at now.
 */

export type NutrientGroup = 'macro' | 'vitamin' | 'mineral' | 'lipid' | 'amino_acid' | 'other';

export type NutrientUnit = 'kcal' | 'g' | 'mg' | 'ug' | 'iu';

export interface NutrientDef {
  /** Canonical key used in every NutrientMap. */
  key: string;
  /** FoodData Central nutrient number. */
  usdaNumber: string;
  name: string;
  /** Canonical unit. Adapters convert into this; nothing downstream converts. */
  unit: NutrientUnit;
  group: NutrientGroup;
  /** Decimal places for display. */
  precision: number;
}

export const NUTRIENTS: readonly NutrientDef[] = [
  // ── Macros ────────────────────────────────────────────────────────────────
  {
    key: 'energy_kcal',
    usdaNumber: '208',
    name: 'Calories',
    unit: 'kcal',
    group: 'macro',
    precision: 0,
  },
  { key: 'protein_g', usdaNumber: '203', name: 'Protein', unit: 'g', group: 'macro', precision: 1 },
  { key: 'fat_g', usdaNumber: '204', name: 'Total fat', unit: 'g', group: 'macro', precision: 1 },
  {
    key: 'carbs_g',
    usdaNumber: '205',
    name: 'Carbohydrate',
    unit: 'g',
    group: 'macro',
    precision: 1,
  },
  { key: 'fiber_g', usdaNumber: '291', name: 'Fiber', unit: 'g', group: 'macro', precision: 1 },
  {
    key: 'sugars_g',
    usdaNumber: '269',
    name: 'Total sugars',
    unit: 'g',
    group: 'macro',
    precision: 1,
  },
  {
    key: 'sugars_added_g',
    usdaNumber: '539',
    name: 'Added sugars',
    unit: 'g',
    group: 'macro',
    precision: 1,
  },
  { key: 'starch_g', usdaNumber: '209', name: 'Starch', unit: 'g', group: 'macro', precision: 1 },

  // ── Lipids ────────────────────────────────────────────────────────────────
  {
    key: 'saturated_fat_g',
    usdaNumber: '606',
    name: 'Saturated fat',
    unit: 'g',
    group: 'lipid',
    precision: 1,
  },
  {
    key: 'monounsaturated_fat_g',
    usdaNumber: '645',
    name: 'Monounsaturated fat',
    unit: 'g',
    group: 'lipid',
    precision: 1,
  },
  {
    key: 'polyunsaturated_fat_g',
    usdaNumber: '646',
    name: 'Polyunsaturated fat',
    unit: 'g',
    group: 'lipid',
    precision: 1,
  },
  {
    key: 'trans_fat_g',
    usdaNumber: '605',
    name: 'Trans fat',
    unit: 'g',
    group: 'lipid',
    precision: 2,
  },
  {
    key: 'cholesterol_mg',
    usdaNumber: '601',
    name: 'Cholesterol',
    unit: 'mg',
    group: 'lipid',
    precision: 0,
  },
  {
    key: 'omega3_ala_g',
    usdaNumber: '851',
    name: 'ALA (18:3 n-3)',
    unit: 'g',
    group: 'lipid',
    precision: 3,
  },
  {
    key: 'omega3_epa_g',
    usdaNumber: '629',
    name: 'EPA (20:5 n-3)',
    unit: 'g',
    group: 'lipid',
    precision: 3,
  },
  {
    key: 'omega3_dpa_g',
    usdaNumber: '631',
    name: 'DPA (22:5 n-3)',
    unit: 'g',
    group: 'lipid',
    precision: 3,
  },
  {
    key: 'omega3_dha_g',
    usdaNumber: '621',
    name: 'DHA (22:6 n-3)',
    unit: 'g',
    group: 'lipid',
    precision: 3,
  },
  {
    key: 'omega6_la_g',
    usdaNumber: '618',
    name: 'Linoleic acid (18:2)',
    unit: 'g',
    group: 'lipid',
    precision: 3,
  },

  // ── Minerals ──────────────────────────────────────────────────────────────
  {
    key: 'calcium_mg',
    usdaNumber: '301',
    name: 'Calcium',
    unit: 'mg',
    group: 'mineral',
    precision: 0,
  },
  { key: 'iron_mg', usdaNumber: '303', name: 'Iron', unit: 'mg', group: 'mineral', precision: 2 },
  {
    key: 'magnesium_mg',
    usdaNumber: '304',
    name: 'Magnesium',
    unit: 'mg',
    group: 'mineral',
    precision: 0,
  },
  {
    key: 'phosphorus_mg',
    usdaNumber: '305',
    name: 'Phosphorus',
    unit: 'mg',
    group: 'mineral',
    precision: 0,
  },
  {
    key: 'potassium_mg',
    usdaNumber: '306',
    name: 'Potassium',
    unit: 'mg',
    group: 'mineral',
    precision: 0,
  },
  {
    key: 'sodium_mg',
    usdaNumber: '307',
    name: 'Sodium',
    unit: 'mg',
    group: 'mineral',
    precision: 0,
  },
  { key: 'zinc_mg', usdaNumber: '309', name: 'Zinc', unit: 'mg', group: 'mineral', precision: 2 },
  {
    key: 'copper_mg',
    usdaNumber: '312',
    name: 'Copper',
    unit: 'mg',
    group: 'mineral',
    precision: 3,
  },
  {
    key: 'manganese_mg',
    usdaNumber: '315',
    name: 'Manganese',
    unit: 'mg',
    group: 'mineral',
    precision: 3,
  },
  {
    key: 'selenium_ug',
    usdaNumber: '317',
    name: 'Selenium',
    unit: 'ug',
    group: 'mineral',
    precision: 1,
  },
  {
    key: 'fluoride_ug',
    usdaNumber: '313',
    name: 'Fluoride',
    unit: 'ug',
    group: 'mineral',
    precision: 1,
  },
  {
    key: 'iodine_ug',
    usdaNumber: '314',
    name: 'Iodine',
    unit: 'ug',
    group: 'mineral',
    precision: 1,
  },

  // ── Vitamins ──────────────────────────────────────────────────────────────
  {
    key: 'vitamin_a_rae_ug',
    usdaNumber: '320',
    name: 'Vitamin A (RAE)',
    unit: 'ug',
    group: 'vitamin',
    precision: 0,
  },
  {
    key: 'vitamin_a_iu',
    usdaNumber: '318',
    name: 'Vitamin A (IU)',
    unit: 'iu',
    group: 'vitamin',
    precision: 0,
  },
  {
    key: 'retinol_ug',
    usdaNumber: '319',
    name: 'Retinol',
    unit: 'ug',
    group: 'vitamin',
    precision: 0,
  },
  {
    key: 'carotene_beta_ug',
    usdaNumber: '321',
    name: 'Beta-carotene',
    unit: 'ug',
    group: 'vitamin',
    precision: 0,
  },
  {
    key: 'carotene_alpha_ug',
    usdaNumber: '322',
    name: 'Alpha-carotene',
    unit: 'ug',
    group: 'vitamin',
    precision: 0,
  },
  {
    key: 'cryptoxanthin_beta_ug',
    usdaNumber: '334',
    name: 'Beta-cryptoxanthin',
    unit: 'ug',
    group: 'vitamin',
    precision: 0,
  },
  {
    key: 'lycopene_ug',
    usdaNumber: '337',
    name: 'Lycopene',
    unit: 'ug',
    group: 'vitamin',
    precision: 0,
  },
  {
    key: 'lutein_zeaxanthin_ug',
    usdaNumber: '338',
    name: 'Lutein + zeaxanthin',
    unit: 'ug',
    group: 'vitamin',
    precision: 0,
  },
  {
    key: 'vitamin_c_mg',
    usdaNumber: '401',
    name: 'Vitamin C',
    unit: 'mg',
    group: 'vitamin',
    precision: 1,
  },
  {
    key: 'thiamin_mg',
    usdaNumber: '404',
    name: 'Thiamin (B1)',
    unit: 'mg',
    group: 'vitamin',
    precision: 3,
  },
  {
    key: 'riboflavin_mg',
    usdaNumber: '405',
    name: 'Riboflavin (B2)',
    unit: 'mg',
    group: 'vitamin',
    precision: 3,
  },
  {
    key: 'niacin_mg',
    usdaNumber: '406',
    name: 'Niacin (B3)',
    unit: 'mg',
    group: 'vitamin',
    precision: 2,
  },
  {
    key: 'pantothenic_acid_mg',
    usdaNumber: '410',
    name: 'Pantothenic acid (B5)',
    unit: 'mg',
    group: 'vitamin',
    precision: 3,
  },
  {
    key: 'vitamin_b6_mg',
    usdaNumber: '415',
    name: 'Vitamin B6',
    unit: 'mg',
    group: 'vitamin',
    precision: 3,
  },
  {
    key: 'folate_total_ug',
    usdaNumber: '417',
    name: 'Folate, total',
    unit: 'ug',
    group: 'vitamin',
    precision: 0,
  },
  {
    key: 'folic_acid_ug',
    usdaNumber: '431',
    name: 'Folic acid',
    unit: 'ug',
    group: 'vitamin',
    precision: 0,
  },
  {
    key: 'folate_food_ug',
    usdaNumber: '432',
    name: 'Folate, food',
    unit: 'ug',
    group: 'vitamin',
    precision: 0,
  },
  {
    key: 'folate_dfe_ug',
    usdaNumber: '435',
    name: 'Folate (DFE)',
    unit: 'ug',
    group: 'vitamin',
    precision: 0,
  },
  {
    key: 'choline_mg',
    usdaNumber: '421',
    name: 'Choline',
    unit: 'mg',
    group: 'vitamin',
    precision: 1,
  },
  {
    key: 'betaine_mg',
    usdaNumber: '454',
    name: 'Betaine',
    unit: 'mg',
    group: 'vitamin',
    precision: 1,
  },
  {
    key: 'vitamin_b12_ug',
    usdaNumber: '418',
    name: 'Vitamin B12',
    unit: 'ug',
    group: 'vitamin',
    precision: 2,
  },
  {
    key: 'vitamin_d_ug',
    usdaNumber: '328',
    name: 'Vitamin D',
    unit: 'ug',
    group: 'vitamin',
    precision: 1,
  },
  {
    key: 'vitamin_d_iu',
    usdaNumber: '324',
    name: 'Vitamin D (IU)',
    unit: 'iu',
    group: 'vitamin',
    precision: 0,
  },
  {
    key: 'vitamin_e_mg',
    usdaNumber: '323',
    name: 'Vitamin E',
    unit: 'mg',
    group: 'vitamin',
    precision: 2,
  },
  {
    key: 'vitamin_k_ug',
    usdaNumber: '430',
    name: 'Vitamin K',
    unit: 'ug',
    group: 'vitamin',
    precision: 1,
  },

  // ── Amino acids ───────────────────────────────────────────────────────────
  {
    key: 'tryptophan_g',
    usdaNumber: '501',
    name: 'Tryptophan',
    unit: 'g',
    group: 'amino_acid',
    precision: 3,
  },
  {
    key: 'threonine_g',
    usdaNumber: '502',
    name: 'Threonine',
    unit: 'g',
    group: 'amino_acid',
    precision: 3,
  },
  {
    key: 'isoleucine_g',
    usdaNumber: '503',
    name: 'Isoleucine',
    unit: 'g',
    group: 'amino_acid',
    precision: 3,
  },
  {
    key: 'leucine_g',
    usdaNumber: '504',
    name: 'Leucine',
    unit: 'g',
    group: 'amino_acid',
    precision: 3,
  },
  {
    key: 'lysine_g',
    usdaNumber: '505',
    name: 'Lysine',
    unit: 'g',
    group: 'amino_acid',
    precision: 3,
  },
  {
    key: 'methionine_g',
    usdaNumber: '506',
    name: 'Methionine',
    unit: 'g',
    group: 'amino_acid',
    precision: 3,
  },
  {
    key: 'cystine_g',
    usdaNumber: '507',
    name: 'Cystine',
    unit: 'g',
    group: 'amino_acid',
    precision: 3,
  },
  {
    key: 'phenylalanine_g',
    usdaNumber: '508',
    name: 'Phenylalanine',
    unit: 'g',
    group: 'amino_acid',
    precision: 3,
  },
  {
    key: 'tyrosine_g',
    usdaNumber: '509',
    name: 'Tyrosine',
    unit: 'g',
    group: 'amino_acid',
    precision: 3,
  },
  {
    key: 'valine_g',
    usdaNumber: '510',
    name: 'Valine',
    unit: 'g',
    group: 'amino_acid',
    precision: 3,
  },
  {
    key: 'arginine_g',
    usdaNumber: '511',
    name: 'Arginine',
    unit: 'g',
    group: 'amino_acid',
    precision: 3,
  },
  {
    key: 'histidine_g',
    usdaNumber: '512',
    name: 'Histidine',
    unit: 'g',
    group: 'amino_acid',
    precision: 3,
  },
  {
    key: 'alanine_g',
    usdaNumber: '513',
    name: 'Alanine',
    unit: 'g',
    group: 'amino_acid',
    precision: 3,
  },
  {
    key: 'aspartic_acid_g',
    usdaNumber: '514',
    name: 'Aspartic acid',
    unit: 'g',
    group: 'amino_acid',
    precision: 3,
  },
  {
    key: 'glutamic_acid_g',
    usdaNumber: '515',
    name: 'Glutamic acid',
    unit: 'g',
    group: 'amino_acid',
    precision: 3,
  },
  {
    key: 'glycine_g',
    usdaNumber: '516',
    name: 'Glycine',
    unit: 'g',
    group: 'amino_acid',
    precision: 3,
  },
  {
    key: 'proline_g',
    usdaNumber: '517',
    name: 'Proline',
    unit: 'g',
    group: 'amino_acid',
    precision: 3,
  },
  {
    key: 'serine_g',
    usdaNumber: '518',
    name: 'Serine',
    unit: 'g',
    group: 'amino_acid',
    precision: 3,
  },

  // ── Other ─────────────────────────────────────────────────────────────────
  { key: 'water_g', usdaNumber: '255', name: 'Water', unit: 'g', group: 'other', precision: 1 },
  { key: 'ash_g', usdaNumber: '207', name: 'Ash', unit: 'g', group: 'other', precision: 1 },
  { key: 'alcohol_g', usdaNumber: '221', name: 'Alcohol', unit: 'g', group: 'other', precision: 1 },
  {
    key: 'caffeine_mg',
    usdaNumber: '262',
    name: 'Caffeine',
    unit: 'mg',
    group: 'other',
    precision: 0,
  },
  {
    key: 'theobromine_mg',
    usdaNumber: '263',
    name: 'Theobromine',
    unit: 'mg',
    group: 'other',
    precision: 0,
  },
];

const BY_KEY = new Map(NUTRIENTS.map((n) => [n.key, n]));
const BY_USDA = new Map(NUTRIENTS.map((n) => [n.usdaNumber, n]));

export function getNutrient(key: string): NutrientDef | undefined {
  return BY_KEY.get(key);
}

export function getNutrientByUsdaNumber(usdaNumber: string): NutrientDef | undefined {
  return BY_USDA.get(usdaNumber);
}

export function isKnownNutrient(key: string): boolean {
  return BY_KEY.has(key);
}

/** Display name, falling back to the raw key so unknown data is still visible. */
export function nutrientName(key: string): string {
  return BY_KEY.get(key)?.name ?? key;
}

/** Registry order within a group, for stable grouped display in Day Detail. */
export function nutrientsInGroup(group: NutrientGroup): NutrientDef[] {
  return NUTRIENTS.filter((n) => n.group === group);
}

export const NUTRIENT_GROUP_ORDER: readonly NutrientGroup[] = [
  'macro',
  'lipid',
  'vitamin',
  'mineral',
  'amino_acid',
  'other',
];

export const NUTRIENT_GROUP_LABELS: Record<NutrientGroup, string> = {
  macro: 'Macronutrients',
  lipid: 'Fats',
  vitamin: 'Vitamins',
  mineral: 'Minerals',
  amino_acid: 'Amino acids',
  other: 'Other',
};

/** Specific-mode default bars. User-reorderable in Settings (SETUP.md item 10). */
export const DEFAULT_PINNED_NUTRIENTS: readonly string[] = [
  'energy_kcal',
  'protein_g',
  'carbs_g',
  'fat_g',
  'fiber_g',
  'vitamin_d_ug',
  'vitamin_b12_ug',
  'iron_mg',
  'calcium_mg',
  'magnesium_mg',
];

/** Round for display using the registry's precision. */
export function formatAmount(key: string, value: number): string {
  const def = BY_KEY.get(key);
  return value.toFixed(def?.precision ?? 1);
}
