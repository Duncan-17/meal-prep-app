/**
 * Manual entry — the fallback for anything USDA does not have.
 *
 * Deliberately asks for per-100 g values only, matching the canonical basis
 * every adapter produces, so a hand-entered food behaves identically to a
 * looked-up one everywhere downstream.
 *
 * Blank fields stay ABSENT from the NutrientMap rather than becoming 0. That
 * is the whole coverage contract: "I don't know the iron content" must not
 * read as "this has no iron".
 */

import { useState } from 'react';

import type { AdaptedFood, NutrientMap } from '@/domain/types';

interface Props {
  initialName?: string;
  onSubmit: (food: AdaptedFood) => void;
  onCancel: () => void;
}

const FIELDS = [
  { key: 'energy_kcal', label: 'Calories', unit: 'kcal' },
  { key: 'protein_g', label: 'Protein', unit: 'g' },
  { key: 'carbs_g', label: 'Carbs', unit: 'g' },
  { key: 'fat_g', label: 'Fat', unit: 'g' },
  { key: 'fiber_g', label: 'Fiber', unit: 'g' },
] as const;

export function ManualFoodEntry({ initialName = '', onSubmit, onCancel }: Props) {
  const [name, setName] = useState(initialName);
  const [values, setValues] = useState<Record<string, string>>({});

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    const nutritionPer100g: NutrientMap = {};
    for (const field of FIELDS) {
      const raw = values[field.key];
      if (raw === undefined || raw.trim() === '') continue; // absent, not zero
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) continue;
      nutritionPer100g[field.key] = parsed;
    }

    onSubmit({
      source: 'manual',
      // Stable enough for a local-only record, and never collides with an FDC id.
      sourceId: `manual-${Date.now()}`,
      name: trimmedName,
      nutritionPer100g,
    });
  }

  return (
    <form className="manualentry" onSubmit={handleSubmit}>
      <p className="manualentry__title">Manual entry</p>

      <label className="field">
        <span className="field__label">Name</span>
        <input
          className="field__input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Nonna's tomato sauce"
          autoFocus
        />
      </label>

      <p className="manualentry__hint">
        Per 100 g. Leave anything you don’t know <strong>blank</strong> — blank means “no data”,
        which is tracked honestly. A zero would claim you measured it.
      </p>

      <div className="manualentry__grid">
        {FIELDS.map((field) => (
          <label className="field" key={field.key}>
            <span className="field__label">
              {field.label} <span className="field__unit">{field.unit}</span>
            </span>
            <input
              className="field__input"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={values[field.key] ?? ''}
              onChange={(event) =>
                setValues((prior) => ({ ...prior, [field.key]: event.target.value }))
              }
            />
          </label>
        ))}
      </div>

      <div className="manualentry__actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
          Use this food
        </button>
      </div>
    </form>
  );
}
