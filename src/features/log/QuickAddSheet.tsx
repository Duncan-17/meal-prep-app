/**
 * Quick Add — anything that did not come out of your own fridge.
 *
 * Search USDA, or enter it by hand. Nothing here touches fridge stock: a
 * sandwich you bought was never in the fridge, so there is nothing to deduct.
 *
 * Barcode scanning is deliberately absent. It resolves against Open Food
 * Facts, which is disabled until a contact address is nominated (SETUP.md
 * item 8), and Safari has no `BarcodeDetector` so iOS needs a ZXing fallback
 * (PLAN.md §6). Manual entry covers the same ground meanwhile.
 */

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { Sheet } from '@/ui/Sheet';
import { FoodSearch } from '@/features/foods/FoodSearch';
import { logMeal, type LogItemDraft } from '@/db/logs';
import { listFavorites, recordFavoriteUse, saveFavorite, deleteFavorite } from '@/db/favorites';
import { nutritionForGrams } from '@/domain/nutrients';
import { defaultPortion, resolveToGrams, unitOptionsFor } from '@/nutrition/units';
import { formatAmount } from '@/nutrition/registry';
import type { DayKey } from '@/domain/dates';
import type { AdaptedFood, MealSlot, QuickAddFavorite } from '@/domain/types';

interface Props {
  open: boolean;
  date: DayKey;
  slot: MealSlot | undefined;
  onClose: () => void;
}

export function QuickAddSheet({ open, date, slot, onClose }: Props) {
  const favorites = useLiveQuery(() => listFavorites(), []);
  const [chosen, setChosen] = useState<AdaptedFood | null>(null);
  const [quantity, setQuantity] = useState(100);
  const [unit, setUnit] = useState('g');
  const [alsoFavorite, setAlsoFavorite] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setChosen(null);
    setQuantity(100);
    setUnit('g');
    setAlsoFavorite(false);
    setError(null);
  }

  function close() {
    reset();
    onClose();
  }

  const resolved = chosen === null ? null : resolveToGrams(quantity, unit, chosen);
  const grams = resolved?.grams ?? 0;
  const nutrients = chosen === null ? {} : nutritionForGrams(chosen.nutritionPer100g, grams);

  function pickFood(picked: AdaptedFood) {
    const portion = defaultPortion(picked);
    setChosen(picked);
    setQuantity(portion.quantity);
    setUnit(portion.unit);
  }

  async function logChosen() {
    if (chosen === null || grams <= 0) return;
    setError(null);

    const item: LogItemDraft = {
      kind: 'quick',
      label: chosen.name,
      quantity,
      unit,
      grams,
      nutrients,
    };

    try {
      await logMeal(date, [item], slot);
      if (alsoFavorite) {
        await saveFavorite({ label: chosen.name, quantity, unit, grams, nutrients });
      }
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function logFavorite(favorite: QuickAddFavorite) {
    setError(null);
    try {
      await logMeal(
        date,
        [
          {
            kind: 'quick',
            label: favorite.label,
            quantity: favorite.quantity,
            unit: favorite.unit,
            grams: favorite.grams,
            nutrients: favorite.nutrients,
            coverage: favorite.coverage,
          },
        ],
        slot,
      );
      if (favorite.id !== undefined) await recordFavoriteUse(favorite.id);
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <Sheet open={open} title="Quick Add" onClose={close}>
      {chosen === null ? (
        <>
          {favorites !== undefined && favorites.length > 0 && (
            <section className="section">
              <h3 className="section__title">Favourites</h3>
              <div className="favorites">
                {favorites.map((favorite) => (
                  <div key={favorite.id} className="favorite">
                    <button
                      type="button"
                      className="favorite__use"
                      onClick={() => void logFavorite(favorite)}
                    >
                      <span className="favorite__label">{favorite.label}</span>
                      <span className="favorite__meta">
                        {favorite.quantity} {favorite.unit}
                        {favorite.nutrients.energy_kcal === undefined
                          ? ''
                          : ` · ${formatAmount('energy_kcal', favorite.nutrients.energy_kcal)} kcal`}
                      </span>
                    </button>
                    {favorite.id !== undefined && (
                      <button
                        type="button"
                        className="ingredient__remove"
                        onClick={() => void deleteFavorite(favorite.id!)}
                        aria-label={`Remove ${favorite.label} from favourites`}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <FoodSearch onSelect={pickFood} />
        </>
      ) : (
        <>
          <p className="screen__sub">{chosen.name}</p>

          <div className="yield">
            <input
              className="field__input yield__qty"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={quantity}
              onChange={(event) => setQuantity(Number(event.target.value))}
              aria-label="Quantity"
            />
            <select
              className="field__input yield__unit"
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              aria-label="Unit"
            >
              {unitOptions(chosen).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          {resolved?.confidence === 'unknown' ? (
            <p className="ingredient__note ingredient__note--warn">
              No gram weight known for “{unit}”. Pick a weight unit instead.
            </p>
          ) : (
            <div className="preview">
              <span>{Math.round(grams)} g</span>
              {nutrients.energy_kcal !== undefined && (
                <span>{formatAmount('energy_kcal', nutrients.energy_kcal)} kcal</span>
              )}
              {nutrients.protein_g !== undefined && (
                <span>{formatAmount('protein_g', nutrients.protein_g)} g protein</span>
              )}
              {resolved !== null &&
                resolved.confidence !== 'exact' &&
                resolved.confidence !== 'portion' && (
                  <span className="preview__after">weight estimated</span>
                )}
            </div>
          )}

          <label className="checkbox">
            <input
              type="checkbox"
              checked={alsoFavorite}
              onChange={(event) => setAlsoFavorite(event.target.checked)}
            />
            <span>Save as a favourite</span>
          </label>

          {error !== null && (
            <div className="notice notice--error">
              <p className="notice__body">{error}</p>
            </div>
          )}

          <div className="builder__actions">
            <button type="button" className="btn" onClick={() => setChosen(null)}>
              Back
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={grams <= 0}
              onClick={() => void logChosen()}
            >
              Log it
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

function unitOptions(food: AdaptedFood): string[] {
  return unitOptionsFor(food);
}
