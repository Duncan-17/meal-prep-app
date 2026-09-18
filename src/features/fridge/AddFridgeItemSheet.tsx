/**
 * Put something in the fridge that was never cooked.
 *
 * A gallon of milk, six avocados, a tub of yoghurt. These have no recipe and
 * no cook behind them, so they create a `FridgeEntry` with no `batchId` — and
 * deliberately do NOT appear on the calendar as a cook that never happened.
 *
 * Counted vs weighed is the same `portionStyle` split as a Component: six
 * avocados are stepped one at a time, a gallon of milk is drunk by percentage.
 */

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { Sheet } from '@/ui/Sheet';
import { ColorPicker } from '@/ui/ColorPicker';
import { FoodSearch } from '@/features/foods/FoodSearch';
import { addFridgeItem } from '@/db/fridge';
import { fetchFoodDetail } from '@/features/foods/api';
import { componentColors } from '@/db/components';
import { listFridge } from '@/db/fridge';
import { suggestUnusedSwatch } from '@/domain/color';
import { nutritionForGrams } from '@/domain/nutrients';
import { defaultPortion, resolveToGrams, unitOptionsFor } from '@/nutrition/units';
import { formatAmount } from '@/nutrition/registry';
import type { AdaptedFood, PortionStyle } from '@/domain/types';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AddFridgeItemSheet({ open, onClose }: Props) {
  const usedColors = useLiveQuery(async () => {
    const [components, fridge] = await Promise.all([componentColors(), listFridge()]);
    return [
      ...components,
      ...fridge.map((entry) => ({ name: entry.componentName, color: entry.componentColor })),
    ];
  }, []);

  const [food, setFood] = useState<AdaptedFood | null>(null);
  const [label, setLabel] = useState('');
  const [style, setStyle] = useState<PortionStyle>('discrete');
  const [count, setCount] = useState(1);
  const [unitSize, setUnitSize] = useState(100);
  const [unitOfSize, setUnitOfSize] = useState('g');
  const [color, setColor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const existing = usedColors ?? [];
  const chosenColor = color ?? suggestUnusedSwatch(existing.map((entry) => entry.color));

  function reset() {
    setFood(null);
    setLabel('');
    setStyle('discrete');
    setCount(1);
    setUnitSize(100);
    setUnitOfSize('g');
    setColor(null);
    setError(null);
  }

  function close() {
    reset();
    onClose();
  }

  /**
   * Search results carry NO portion data — USDA only returns `foodPortions` on
   * the detail endpoint. Picking straight from a search result is why this
   * used to default to 100 g for a burger that knows it weighs 291 g.
   */
  async function pick(picked: AdaptedFood) {
    setLoading(true);
    setError(null);
    try {
      const { food: detailed } = await fetchFoodDetail(picked);
      setFood(detailed);
      setLabel(detailed.name);
      const portion = defaultPortion(detailed);
      setUnitSize(portion.quantity);
      setUnitOfSize(portion.unit);
    } finally {
      setLoading(false);
    }
  }

  // Grams in ONE unit — one avocado, or one gram of milk if measured by weight.
  const perUnitGrams = food === null ? 0 : resolveToGrams(unitSize, unitOfSize, food).grams;

  const nutritionPerUnit =
    food === null ? {} : nutritionForGrams(food.nutritionPer100g, perUnitGrams);

  // Bulk is stored in grams, so the quantity IS the total weight.
  const quantity = style === 'bulk' ? count * perUnitGrams : count;
  const storedUnit = style === 'bulk' ? 'g' : 'each';
  const storedPerUnit =
    style === 'bulk' && perUnitGrams > 0
      ? nutritionForGrams(food?.nutritionPer100g ?? {}, 1)
      : nutritionPerUnit;
  const storedGramsPerUnit = style === 'bulk' ? 1 : perUnitGrams;

  const valid = food !== null && label.trim() !== '' && quantity > 0 && perUnitGrams > 0;

  async function save() {
    if (!valid) return;
    setError(null);
    try {
      await addFridgeItem({
        label,
        color: chosenColor,
        portionStyle: style,
        quantity,
        unit: storedUnit,
        nutritionPerUnit: storedPerUnit,
        gramsPerUnit: storedGramsPerUnit,
      });
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <Sheet open={open} title="Add to the fridge" onClose={close}>
      {food === null ? (
        <>
          <p className="screen__sub">
            Something you bought rather than cooked — milk, avocados, yoghurt.
          </p>
          <FoodSearch onSelect={(picked) => void pick(picked)} />
          {loading && <p className="foodsearch__status">Fetching serving sizes…</p>}
        </>
      ) : (
        <>
          <label className="field">
            <span className="field__label">Name</span>
            <input
              className="field__input"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>

          <div className="field">
            <span className="field__label">How is it used up?</span>
            <div className="segmented">
              <button
                type="button"
                className={`segmented__option${style === 'discrete' ? ' segmented__option--on' : ''}`}
                onClick={() => setStyle('discrete')}
              >
                Counted
              </button>
              <button
                type="button"
                className={`segmented__option${style === 'bulk' ? ' segmented__option--on' : ''}`}
                onClick={() => setStyle('bulk')}
              >
                Weighed
              </button>
            </div>
            <p className="yield__hint">
              {style === 'discrete'
                ? 'Six avocados — logged one at a time with a stepper.'
                : 'A gallon of milk — logged as a percentage of what is left.'}
            </p>
          </div>

          <label className="field">
            <span className="field__label">
              {style === 'discrete' ? 'One serving is' : 'One container is'}
            </span>
            <div className="yield">
              <input
                className="field__input yield__qty"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={unitSize}
                onChange={(event) => setUnitSize(Number(event.target.value))}
              />
              <select
                className="field__input yield__unit"
                value={unitOfSize}
                onChange={(event) => setUnitOfSize(event.target.value)}
              >
                {unitOptions(food).map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </div>
          </label>

          <label className="field">
            <span className="field__label">
              {style === 'discrete' ? 'How many servings' : 'How many containers'}
            </span>
            <input
              className="field__input yield__qty"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
            />
          </label>

          {perUnitGrams <= 0 ? (
            <p className="ingredient__note ingredient__note--warn">
              No gram weight known for “{unitOfSize}”. Pick a weight unit, or say how much one
              weighs.
            </p>
          ) : (
            <div className="preview">
              <span>
                {style === 'bulk'
                  ? `${Math.round(quantity)} g total`
                  : `${count} × ${Math.round(perUnitGrams)} g`}
              </span>
              {nutritionPerUnit.energy_kcal !== undefined && (
                <span>
                  {formatAmount('energy_kcal', nutritionPerUnit.energy_kcal)} kcal
                  {style === 'discrete' ? ' each' : ' per container'}
                </span>
              )}
            </div>
          )}

          <ColorPicker value={chosenColor} onChange={setColor} existing={existing} />

          {error !== null && (
            <div className="notice notice--error">
              <p className="notice__body">{error}</p>
            </div>
          )}

          <div className="builder__actions">
            <button type="button" className="btn" onClick={() => setFood(null)}>
              Back
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!valid}
              onClick={() => void save()}
            >
              Add to fridge
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
