/**
 * Type in a food USDA has never heard of.
 *
 * Entered **per serving**, because that is how the packet reads — "per bottle:
 * 150 kcal, 10 g protein". Asking for per-100 g would mean doing arithmetic
 * off the label, which is exactly the busywork the app exists to remove.
 * Stored per 100 g, which is what everything downstream expects.
 *
 * The headline nutrients are always visible; the rest of the panel is behind a
 * toggle, because nobody types eighteen amino acids off a yoghurt bottle but
 * the data model can hold them if you want to.
 */

import { useState } from 'react';

import { saveCustomFood, type CustomFoodDraft } from '@/db/ingredients';
import {
  NUTRIENTS,
  NUTRIENT_GROUP_LABELS,
  NUTRIENT_GROUP_ORDER,
  getNutrient,
  nutrientName,
} from '@/nutrition/registry';
import type { Ingredient, NutrientMap } from '@/domain/types';

/** What a nutrition label actually prints, in label order. */
const HEADLINE = [
  'energy_kcal',
  'protein_g',
  'carbs_g',
  'fat_g',
  'saturated_fat_g',
  'sugars_g',
  'fiber_g',
  'sodium_mg',
];

interface Props {
  /** Pass an existing food to edit it. */
  existing?: Ingredient;
  onSaved: (id: number) => void;
  onCancel: () => void;
}

export function CustomFoodForm({ existing, onSaved, onCancel }: Props) {
  const editingServingGrams = existing?.portionGrams?.serving;

  const [name, setName] = useState(existing?.name ?? '');
  const [servingGrams, setServingGrams] = useState(String(editingServingGrams ?? 100));
  const [servingLabel, setServingLabel] = useState('serving');
  const [values, setValues] = useState<Record<string, string>>(() =>
    seedValues(existing, editingServingGrams ?? 100),
  );
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const grams = Number(servingGrams);
  const validGrams = Number.isFinite(grams) && grams > 0;
  const canSave = name.trim() !== '' && validGrams;

  function set(key: string, raw: string) {
    setValues((prior) => ({ ...prior, [key]: raw }));
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);

    // Per serving → per 100 g. A blank field stays ABSENT, never zero: "I did
    // not type the iron" is not "this has no iron" (PLAN.md §3c).
    const nutritionPer100g: NutrientMap = {};
    for (const [key, raw] of Object.entries(values)) {
      if (raw.trim() === '') continue;
      const perServing = Number(raw);
      if (!Number.isFinite(perServing)) continue;
      nutritionPer100g[key] = (perServing / grams) * 100;
    }

    const draft: CustomFoodDraft = {
      ...(existing?.id === undefined ? {} : { id: existing.id }),
      name,
      servingGrams: grams,
      servingLabel,
      nutritionPer100g,
    };

    try {
      onSaved(await saveCustomFood(draft));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="customfood">
      <label className="field">
        <span className="field__label">What is it?</span>
        <input
          className="field__input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Yeo Valley kefir drink"
          autoFocus
        />
      </label>

      <div className="field">
        <span className="field__label">One serving is</span>
        <div className="yield">
          <input
            className="field__input yield__qty"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={servingGrams}
            onChange={(event) => setServingGrams(event.target.value)}
            aria-label="Serving weight in grams"
          />
          <span className="yield__hint">g</span>
          <input
            className="field__input amount__unit"
            value={servingLabel}
            onChange={(event) => setServingLabel(event.target.value)}
            placeholder="bottle"
            aria-label="What you call one of them"
          />
        </div>
        <p className="yield__hint">
          The weight of one bottle, bar or pot. Everything below is what the label says for{' '}
          <strong>one of those</strong>.
        </p>
      </div>

      {!validGrams && servingGrams !== '' && (
        <p className="ingredient__note ingredient__note--warn">
          A serving has to weigh more than zero — the per-100 g conversion divides by it.
        </p>
      )}

      <section className="section">
        <h3 className="plangroup__title">Per serving</h3>
        <div className="customfood__grid">
          {HEADLINE.map((key) => (
            <NutrientField key={key} nutrientKey={key} value={values[key] ?? ''} onChange={set} />
          ))}
        </div>

        <button type="button" className="linkbtn" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Just the basics' : 'Add vitamins, minerals and the rest'}
        </button>
      </section>

      {showAll &&
        NUTRIENT_GROUP_ORDER.map((group) => {
          const rest = NUTRIENTS.filter(
            (definition) => definition.group === group && !HEADLINE.includes(definition.key),
          );
          if (rest.length === 0) return null;
          return (
            <section className="section" key={group}>
              <h3 className="plangroup__title">{NUTRIENT_GROUP_LABELS[group]}</h3>
              <div className="customfood__grid">
                {rest.map((definition) => (
                  <NutrientField
                    key={definition.key}
                    nutrientKey={definition.key}
                    value={values[definition.key] ?? ''}
                    onChange={set}
                  />
                ))}
              </div>
            </section>
          );
        })}

      <p className="screen__sub">
        Leave anything you don’t know <strong>blank</strong>. Blank means “no data”, which is
        tracked honestly — a zero would claim you read it off the label.
      </p>

      {error !== null && (
        <div className="notice notice--error">
          <p className="notice__body">{error}</p>
        </div>
      )}

      <div className="builder__actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!canSave || saving}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : existing === undefined ? 'Save food' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

function NutrientField({
  nutrientKey,
  value,
  onChange,
}: {
  nutrientKey: string;
  value: string;
  onChange: (key: string, raw: string) => void;
}) {
  const unit = getNutrient(nutrientKey)?.unit ?? '';
  return (
    <label className="field">
      <span className="field__label">
        {nutrientName(nutrientKey)} <span className="field__unit">{unit}</span>
      </span>
      <input
        className="field__input"
        type="number"
        inputMode="decimal"
        step="any"
        min="0"
        value={value}
        onChange={(event) => onChange(nutrientKey, event.target.value)}
      />
    </label>
  );
}

/** Editing shows per-serving numbers, so convert the stored per-100 g back. */
function seedValues(
  existing: Ingredient | undefined,
  servingGrams: number,
): Record<string, string> {
  if (existing === undefined || !(servingGrams > 0)) return {};
  const out: Record<string, string> = {};
  for (const [key, per100g] of Object.entries(existing.nutritionPer100g)) {
    const perServing = (per100g * servingGrams) / 100;
    out[key] = String(Math.round(perServing * 1000) / 1000);
  }
  return out;
}
