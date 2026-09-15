/**
 * Logging a portion out of the fridge.
 *
 * Discrete gets a stepper, bulk gets a percent-of-remaining picker. The two
 * controls sit on identical arithmetic — `portionStyle` chooses the control,
 * never the maths (PLAN.md §3a).
 */

import { useEffect, useState } from 'react';

import { Sheet } from '@/ui/Sheet';
import { Stepper } from '@/ui/Stepper';
import { PercentPicker } from '@/ui/PercentPicker';
import { logMeal, type LogItemDraft } from '@/db/logs';
import {
  gramsForQuantity,
  nutritionForQuantity,
  quantityFromPercentOfRemaining,
} from '@/domain/portions';
import { formatAmount } from '@/nutrition/registry';
import type { DayKey } from '@/domain/dates';
import type { FridgeEntry, MealSlot } from '@/domain/types';

interface Props {
  entry: FridgeEntry | null;
  date: DayKey;
  slot: MealSlot | undefined;
  onClose: () => void;
}

export function LogFromFridgeSheet({ entry, date, slot, onClose }: Props) {
  const [count, setCount] = useState(1);
  const [percent, setPercent] = useState(25);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCount(1);
    setPercent(25);
    setError(null);
  }, [entry?.id]);

  if (entry === null) {
    return <Sheet open={false} title="Log" onClose={onClose} children={null} />;
  }

  const bulk = entry.portionStyle === 'bulk';
  const quantity = bulk ? quantityFromPercentOfRemaining(entry.remaining, percent) : count;
  const grams = gramsForQuantity(entry.gramsPerUnit, quantity);
  const nutrients = nutritionForQuantity(entry.nutritionPerUnit, quantity);
  const valid = quantity > 0 && quantity <= entry.remaining + 1e-9;

  async function confirm() {
    if (entry === null || !valid) return;
    setSaving(true);
    setError(null);

    const item: LogItemDraft = {
      kind: 'fridge',
      fridgeEntryId: entry.id!,
      label: entry.componentName,
      quantity,
      unit: entry.unit,
      grams,
      nutrients,
      coverage: entry.coverage,
    };

    try {
      await logMeal(date, [item], slot);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open title={entry.componentName} onClose={onClose}>
      <p className="screen__sub">
        {round(entry.remaining)} {entry.unit} left
      </p>

      {bulk ? (
        <PercentPicker
          percent={percent}
          onChange={setPercent}
          remaining={entry.remaining}
          unit={entry.unit}
        />
      ) : (
        <div className="field">
          <span className="field__label">How many {entry.unit}s</span>
          <Stepper
            value={count}
            onChange={setCount}
            min={0}
            max={entry.remaining}
            step={0.5}
            label={`${entry.componentName} portions`}
          />
        </div>
      )}

      <div className="preview">
        <span>{Math.round(grams)} g</span>
        {nutrients.energy_kcal !== undefined && (
          <span>{formatAmount('energy_kcal', nutrients.energy_kcal)} kcal</span>
        )}
        {nutrients.protein_g !== undefined && (
          <span>{formatAmount('protein_g', nutrients.protein_g)} g protein</span>
        )}
        <span className="preview__after">
          leaves {round(entry.remaining - quantity)} {entry.unit}
        </span>
      </div>

      {!valid && quantity > entry.remaining && (
        <p className="ingredient__note ingredient__note--warn">
          There is only {round(entry.remaining)} {entry.unit} left.
        </p>
      )}

      {error !== null && (
        <div className="notice notice--error">
          <p className="notice__body">{error}</p>
        </div>
      )}

      <div className="builder__actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!valid || saving}
          onClick={() => void confirm()}
        >
          {saving ? 'Logging…' : 'Log it'}
        </button>
      </div>
    </Sheet>
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
