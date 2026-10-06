/**
 * Your own foods — the ones USDA has never heard of.
 *
 * Two actions per food: **Eat** logs one to today's Diary, and **+ Fridge**
 * stocks however many you bought — eight of the yoghurt drink become stock you
 * can log from. Either is the reason to define a food once rather than
 * re-typing it. The same foods also appear under "My foods" in every food
 * picker, so they can go into a recipe too.
 */

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { Sheet } from '@/ui/Sheet';
import { Stepper } from '@/ui/Stepper';
import { CustomFoodForm } from '@/features/foods/CustomFoodForm';
import { QuickAddSheet } from '@/features/log/QuickAddSheet';
import {
  customFoodAsAdapted,
  customFoodUsage,
  deleteCustomFood,
  listCustomFoods,
} from '@/db/ingredients';
import { todayKey } from '@/domain/dates';
import { addFridgeItem } from '@/db/fridge';
import { suggestUnusedSwatch } from '@/domain/color';
import { componentColors } from '@/db/components';
import { nutritionForGrams } from '@/domain/nutrients';
import { formatAmount } from '@/nutrition/registry';
import type { Ingredient } from '@/domain/types';

export function FoodLibrary() {
  const foods = useLiveQuery(() => listCustomFoods(), []);
  const [editing, setEditing] = useState<Ingredient | null>(null);
  const [creating, setCreating] = useState(false);
  const [stocking, setStocking] = useState<Ingredient | null>(null);
  const [eating, setEating] = useState<Ingredient | null>(null);

  return (
    <>
      <div className="screen__head">
        <p className="screen__sub">
          Foods you type in yourself, for anything the database does not have.
        </p>
        <button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
          + New food
        </button>
      </div>

      {foods === undefined ? (
        <p className="screen__sub">Loading…</p>
      ) : foods.length === 0 ? (
        <div className="placeholder">
          <p style={{ margin: '0 0 10px', fontWeight: 600 }}>No foods of your own yet</p>
          <p className="screen__sub" style={{ margin: 0 }}>
            For the specific yoghurt drink, protein bar or supermarket own-brand thing that USDA has
            never heard of. Type the label in once, then add however many you bought straight to the
            fridge.
          </p>
        </div>
      ) : (
        <ul className="cards">
          {foods.map((food) => (
            <li key={food.id}>
              <div className="card">
                <span className="card__body">
                  <span className="card__name">{food.name}</span>
                  <span className="card__meta">{describe(food)}</span>
                </span>
                <button
                  type="button"
                  className="btn btn--primary stock__adjust"
                  onClick={() => setEating(food)}
                >
                  Eat
                </button>
                <button
                  type="button"
                  className="btn stock__adjust"
                  onClick={() => setStocking(food)}
                >
                  + Fridge
                </button>
                <button
                  type="button"
                  className="btn stock__adjust"
                  onClick={() => setEditing(food)}
                >
                  Edit
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={creating || editing !== null}
        title={editing === null ? 'New food' : editing.name}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      >
        {(creating || editing !== null) && (
          <>
            <CustomFoodForm
              {...(editing === null ? {} : { existing: editing })}
              onSaved={() => {
                setCreating(false);
                setEditing(null);
              }}
              onCancel={() => {
                setCreating(false);
                setEditing(null);
              }}
            />
            {editing !== null && <DeleteFood food={editing} onDeleted={() => setEditing(null)} />}
          </>
        )}
      </Sheet>

      <StockSheet food={stocking} onClose={() => setStocking(null)} />

      {/* Eaten today, straight from here — no trip to the Diary to find it. */}
      {eating !== null && (
        <QuickAddSheet
          key={eating.id}
          open
          date={todayKey()}
          slot={undefined}
          initialFood={customFoodAsAdapted(eating)}
          onClose={() => setEating(null)}
        />
      )}
    </>
  );
}

/** "250 g per bottle · 150 kcal each" */
function describe(food: Ingredient): string {
  const grams = food.portionGrams?.serving;
  const parts: string[] = [];
  if (grams !== undefined) parts.push(`${Math.round(grams)} g per serving`);

  const kcal =
    grams === undefined
      ? food.nutritionPer100g.energy_kcal
      : nutritionForGrams(food.nutritionPer100g, grams).energy_kcal;
  if (kcal !== undefined) {
    parts.push(
      `${formatAmount('energy_kcal', kcal)} kcal ${grams === undefined ? '/100 g' : 'each'}`,
    );
  }

  const measured = Object.keys(food.nutritionPer100g).length;
  parts.push(`${measured} nutrient${measured === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** "I bought eight of them" → fridge stock. */
function StockSheet({ food, onClose }: { food: Ingredient | null; onClose: () => void }) {
  const used = useLiveQuery(() => componentColors(), []);
  const [count, setCount] = useState(1);
  const [error, setError] = useState<string | null>(null);

  if (food === null) {
    return <Sheet open={false} title="Add to fridge" onClose={onClose} children={null} />;
  }

  const grams = food.portionGrams?.serving ?? 100;
  const perServing = nutritionForGrams(food.nutritionPer100g, grams);
  const colour = suggestUnusedSwatch((used ?? []).map((entry) => entry.color));

  async function add() {
    setError(null);
    try {
      await addFridgeItem({
        label: food!.name,
        color: colour,
        // Counted, not weighed — you bought eight bottles, not 2 kg of bottle.
        portionStyle: 'discrete',
        quantity: count,
        unit: 'each',
        nutritionPerUnit: perServing,
        gramsPerUnit: grams,
      });
      setCount(1);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <Sheet open title={food.name} onClose={onClose}>
      <p className="screen__sub">How many did you buy?</p>

      <Stepper value={count} onChange={setCount} min={1} step={1} label={`${food.name} count`} />

      <div className="preview">
        <span>{Math.round(grams * count)} g total</span>
        {perServing.energy_kcal !== undefined && (
          <span>{formatAmount('energy_kcal', perServing.energy_kcal * count)} kcal</span>
        )}
        <span className="preview__after">
          {formatAmount('energy_kcal', perServing.energy_kcal ?? 0)} kcal each
        </span>
      </div>

      {error !== null && (
        <div className="notice notice--error">
          <p className="notice__body">{error}</p>
        </div>
      )}

      <div className="builder__actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn--primary" onClick={() => void add()}>
          Add {count} to the fridge
        </button>
      </div>
    </Sheet>
  );
}

function DeleteFood({ food, onDeleted }: { food: Ingredient; onDeleted: () => void }) {
  const usage = useLiveQuery(
    () => (food.id === undefined ? undefined : customFoodUsage(food.id)),
    [food.id],
  );
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inUse = (usage ?? 0) > 0;

  async function remove() {
    if (food.id === undefined) return;
    try {
      await deleteCustomFood(food.id);
      onDeleted();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setConfirming(false);
    }
  }

  return (
    <>
      <hr className="rule" />
      {inUse ? (
        <p className="screen__sub">
          Used in {usage} recipe{usage === 1 ? '' : 's'}, so it cannot be deleted — their nutrition
          was computed from it.
        </p>
      ) : confirming ? (
        <div className="builder__actions">
          <button type="button" className="btn" onClick={() => setConfirming(false)}>
            Keep
          </button>
          <button type="button" className="btn btn--danger" onClick={() => void remove()}>
            Really delete
          </button>
        </div>
      ) : (
        <button type="button" className="linkbtn" onClick={() => setConfirming(true)}>
          Delete this food
        </button>
      )}
      {error !== null && (
        <div className="notice notice--error">
          <p className="notice__body">{error}</p>
        </div>
      )}
    </>
  );
}
