/**
 * "Cooking completed" — confirm what actually went in, and what came out.
 *
 * Two things routinely differ from the plan and both change every per-serving
 * number downstream:
 *
 * - **The amounts.** You meant to use 500 g of rice and used 600 g.
 * - **The yield.** You planned six portions and got five.
 *
 * So both are editable here, and the nutrition is recomputed from what you
 * actually say rather than from the schedule. The Batch keeps its original
 * snapshot — that is what you *planned*, and the calendar should keep showing
 * it — while the fridge entry carries the truth you will eat from.
 *
 * If the recipe has since been deleted or has no ingredient list, this falls
 * back to confirming the yield alone rather than refusing to work.
 */

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { Sheet } from '@/ui/Sheet';
import { markCooked, plannedYield } from '@/db/fridge';
import { batchNutrition } from '@/db/batches';
import { getComponent } from '@/db/components';
import { getIngredients } from '@/db/ingredients';
import { componentNutrition } from '@/domain/components';
import { resolveToGrams, unitOptionsFor } from '@/nutrition/units';
import { formatAmount } from '@/nutrition/registry';
import type { Batch, Ingredient } from '@/domain/types';

interface Props {
  batch: Batch | null;
  onClose: () => void;
  onCooked?: () => void;
}

interface Line {
  uid: string;
  ingredient: Ingredient;
  quantity: number;
  unit: string;
}

export function MarkCookedSheet({ batch, onClose, onCooked }: Props) {
  const planned = batch === null ? 0 : plannedYield(batch.baseQuantity, batch.scale);
  const [yieldText, setYieldText] = useState(String(planned));
  const [lines, setLines] = useState<Line[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The recipe's ingredient list, as scheduled. Absent if it was since deleted.
  const recipe = useLiveQuery(
    () => (batch?.componentId === undefined ? undefined : getComponent(batch.componentId)),
    [batch?.componentId],
  );
  const ingredients = useLiveQuery(
    () =>
      recipe === undefined
        ? undefined
        : getIngredients(recipe.ingredients.map((entry) => entry.ingredientId)),
    [recipe],
  );

  useEffect(() => {
    setYieldText(String(planned));
    setError(null);
  }, [planned, batch?.id]);

  // Seed the editable lines once, scaled by the batch — cooking a double batch
  // means double the ingredients before any adjustment.
  useEffect(() => {
    if (recipe === undefined || ingredients === undefined || batch === null) return;
    setLines(
      recipe.ingredients
        .map((entry, index) => {
          const ingredient = ingredients.get(entry.ingredientId);
          if (ingredient === undefined) return null;
          return {
            uid: `${entry.ingredientId}-${index}`,
            ingredient,
            quantity: entry.quantity * batch.scale,
            unit: entry.unit,
          };
        })
        .filter((line): line is Line => line !== null),
    );
  }, [recipe, ingredients, batch]);

  const actual = Number(yieldText);
  const validYield = Number.isFinite(actual) && actual > 0;

  const recomputed =
    lines === null || lines.length === 0
      ? null
      : componentNutrition(
          lines.map((line) => ({
            nutritionPer100g: line.ingredient.nutritionPer100g,
            grams: resolveToGrams(line.quantity, line.unit, line.ingredient).grams,
          })),
        );

  const totalNutrition = recomputed?.nutrients ?? (batch === null ? {} : batchNutrition(batch));
  const kcal = totalNutrition.energy_kcal;

  function updateLine(uid: string, patch: Partial<Line>) {
    setLines((prior) =>
      prior === null
        ? prior
        : prior.map((line) => (line.uid === uid ? { ...line, ...patch } : line)),
    );
  }

  async function confirm() {
    if (batch?.id === undefined || !validYield) return;
    setSaving(true);
    setError(null);
    try {
      await markCooked(batch.id, actual, recomputed ?? undefined);
      onCooked?.();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  const unit = batch === null ? '' : batch.portionStyle === 'bulk' ? 'g' : batch.baseUnit;

  return (
    <Sheet
      open={batch !== null}
      title={batch === null ? 'Cooking completed' : `Cooked ${batch.componentName}`}
      onClose={onClose}
    >
      {batch !== null && (
        <>
          {lines !== null && lines.length > 0 && (
            <section className="section">
              <h3 className="plangroup__title">What actually went in</h3>

              <ul className="amounts">
                {lines.map((line) => {
                  const grams = resolveToGrams(line.quantity, line.unit, line.ingredient).grams;
                  return (
                    <li key={line.uid} className="amount">
                      <span className="amount__name">{line.ingredient.name}</span>
                      <div className="amount__controls">
                        <input
                          className="field__input amount__qty"
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min="0"
                          value={line.quantity}
                          onChange={(event) =>
                            updateLine(line.uid, { quantity: Number(event.target.value) })
                          }
                          aria-label={`Amount of ${line.ingredient.name}`}
                        />
                        <select
                          className="field__input amount__unit"
                          value={line.unit}
                          onChange={(event) => updateLine(line.uid, { unit: event.target.value })}
                          aria-label={`Unit for ${line.ingredient.name}`}
                        >
                          {unitOptionsFor(line.ingredient).map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </div>
                      <span className="amount__grams">{Math.round(grams)} g</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <label className="field">
            <span className="field__label">How much did it make?</span>
            <div className="yield">
              <input
                className="field__input yield__qty"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={yieldText}
                onChange={(event) => setYieldText(event.target.value)}
              />
              <span className="yield__hint">{unit}</span>
            </div>
          </label>

          <p className="yield__hint">
            Planned {planned} {unit}.
          </p>

          {validYield && kcal !== undefined && (
            <div className="preview">
              <span>{formatAmount('energy_kcal', kcal)} kcal total</span>
              <span>
                {batch.portionStyle === 'bulk'
                  ? `${formatAmount('energy_kcal', (kcal / actual) * 100)} kcal per 100 g`
                  : `${formatAmount('energy_kcal', kcal / actual)} kcal per ${batch.baseUnit}`}
              </span>
              {recomputed !== null && <span className="preview__after">from your amounts</span>}
            </div>
          )}

          {!validYield && yieldText !== '' && (
            <p className="ingredient__note ingredient__note--warn">
              Yield must be greater than zero.
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
              disabled={!validYield || saving}
              onClick={() => void confirm()}
            >
              {saving ? 'Saving…' : 'Confirm the cook'}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
