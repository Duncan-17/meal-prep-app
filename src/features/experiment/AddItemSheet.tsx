/**
 * Add anything to a scratchpad: a USDA food, one of your own, or a recipe
 * (user's decision — "anything"). Foods come in at one of their own portion
 * and the amount is set in the list afterwards; recipes as one whole batch.
 */

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { Sheet } from '@/ui/Sheet';
import { FoodSearch } from '@/features/foods/FoodSearch';
import { fetchFoodDetail } from '@/features/foods/api';
import { listComponents } from '@/db/components';
import { newItemUid } from '@/db/scratchpads';
import { suggestUnusedSwatch, swatchForName } from '@/domain/color';
import { newFoodItem, newRecipeItem } from '@/nutrition/scratchpad';
import { formatAmount } from '@/nutrition/registry';
import type { AdaptedFood, ScratchpadItem } from '@/domain/types';

type Tab = 'foods' | 'recipes';

interface Props {
  open: boolean;
  onClose: () => void;
  onAdd: (item: ScratchpadItem) => void;
  /** Colours already in the scratchpad, so a new food does not repeat one. */
  usedColors: readonly string[];
}

export function AddItemSheet({ open, onClose, onAdd, usedColors }: Props) {
  const [tab, setTab] = useState<Tab>('foods');
  const [loading, setLoading] = useState(false);
  const recipes = useLiveQuery(() => listComponents(), []);

  async function addFood(picked: AdaptedFood) {
    setLoading(true);
    try {
      // Detail carries the serving sizes search lacks — see features/foods/api.
      const { food } = await fetchFoodDetail(picked);
      const named = swatchForName(food.name);
      const color = usedColors.includes(named) ? suggestUnusedSwatch(usedColors) : named;
      onAdd(newFoodItem(food, newItemUid(), color));
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet open={open} title="Add to scratchpad" onClose={onClose}>
      <div className="segmented segmented--full segmented--tight" role="tablist">
        {(['foods', 'recipes'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={tab === option}
            className={`segmented__option${tab === option ? ' segmented__option--on' : ''}`}
            onClick={() => setTab(option)}
          >
            {option === 'foods' ? 'Foods' : 'Recipes'}
          </button>
        ))}
      </div>

      {tab === 'foods' ? (
        <>
          <FoodSearch onSelect={(food) => void addFood(food)} />
          {loading && <p className="foodsearch__status">Fetching serving sizes…</p>}
        </>
      ) : recipes === undefined ? (
        <p className="foodsearch__status">Loading…</p>
      ) : recipes.length === 0 ? (
        <p className="foodsearch__status">No recipes yet — build one in the Recipes tab.</p>
      ) : (
        <ul className="foodsearch__results">
          {recipes.map((recipe) => {
            const kcal = recipe.nutritionPerBase.energy_kcal;
            return (
              <li key={recipe.id}>
                <button
                  type="button"
                  className="foodcard"
                  onClick={() => {
                    if (recipe.id === undefined) return;
                    onAdd(newRecipeItem({ ...recipe, id: recipe.id }, newItemUid()));
                    onClose();
                  }}
                >
                  <span className="foodcard__name">
                    <span
                      className="card__dot"
                      style={{ background: recipe.color, display: 'inline-block', marginRight: 8 }}
                      aria-hidden="true"
                    />
                    {recipe.name}
                  </span>
                  <span className="foodcard__nums">
                    One batch · {recipe.baseQuantity} {recipe.baseUnit}
                    {kcal === undefined ? '' : ` · ${formatAmount('energy_kcal', kcal)} kcal`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
