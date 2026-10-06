/**
 * Create or edit a Component.
 *
 * Nothing touches the database until Save: the draft holds whole `AdaptedFood`
 * objects, and ingredient rows are only created at that point. Abandoning a
 * half-built Component leaves nothing behind.
 */

import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router-dom';

import { ColorPicker } from '@/ui/ColorPicker';
import { FoodSearch } from '@/features/foods/FoodSearch';
import { IngredientRows } from '@/features/components/IngredientRows';
import { NutritionSummary } from '@/features/components/NutritionSummary';
import {
  draftNutrition,
  effectiveBaseQuantity,
  emptyDraft,
  nextUid,
  validateDraft,
  type ComponentDraftState,
  type DraftIngredient,
} from '@/features/components/draft';
import { fetchFoodDetail } from '@/features/foods/api';
import { componentColors, getComponent, saveComponent } from '@/db/components';
import { upsertIngredient, getIngredients } from '@/db/ingredients';
import { suggestUnusedSwatch } from '@/domain/color';
import { defaultPortion } from '@/nutrition/units';
import { db } from '@/db/schema';
import type { AdaptedFood } from '@/domain/types';

export function ComponentBuilder() {
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const editingId = params.id === undefined ? undefined : Number(params.id);

  const [draft, setDraft] = useState<ComponentDraftState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [pendingFood, setPendingFood] = useState<string | null>(null);

  const others = useLiveQuery(() => componentColors(editingId), [editingId]) ?? [];

  // Load an existing Component, or start a blank one with an unused swatch.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (editingId === undefined) {
        const used = await componentColors();
        if (cancelled) return;
        setDraft(emptyDraft(suggestUnusedSwatch(used.map((entry) => entry.color))));
        return;
      }

      const component = await getComponent(editingId);
      if (component === undefined || cancelled) return;

      // Rehydrate ingredient rows from their stored ids.
      const ingredients = await getIngredients(
        component.ingredients.map((entry) => entry.ingredientId),
      );
      if (cancelled) return;

      const rows: DraftIngredient[] = component.ingredients
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((entry) => {
          const ingredient = ingredients.get(entry.ingredientId);
          const food: AdaptedFood = {
            source: ingredient?.source ?? 'manual',
            sourceId: ingredient?.sourceId ?? String(entry.ingredientId),
            name: ingredient?.name ?? 'Missing ingredient',
            nutritionPer100g: ingredient?.nutritionPer100g ?? {},
            ...(ingredient?.portionGrams === undefined
              ? {}
              : { portionGrams: ingredient.portionGrams }),
          };
          return { uid: nextUid(), food, quantity: entry.quantity, unit: entry.unit };
        });

      setDraft({
        // exactOptionalPropertyTypes: omit the key rather than set undefined.
        ...(component.id === undefined ? {} : { id: component.id }),
        name: component.name,
        color: component.color,
        category: component.category ?? '',
        portionStyle: component.portionStyle,
        baseQuantity: component.baseQuantity,
        baseUnit: component.baseUnit,
        ingredients: rows,
      });
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [editingId]);

  const nutrition = useMemo(() => (draft === null ? null : draftNutrition(draft)), [draft]);

  if (draft === null || nutrition === null) {
    return (
      <div className="screen">
        <p className="screen__sub">Loading…</p>
      </div>
    );
  }

  const totalGrams = nutrition.totalGrams;
  const baseQuantity = effectiveBaseQuantity(draft, totalGrams);
  const problems = validateDraft(draft, totalGrams);
  const blocking = problems.filter((problem) => !problem.message.includes('contribute nothing'));

  function patch(changes: Partial<ComponentDraftState>) {
    setDraft((prior) => (prior === null ? prior : { ...prior, ...changes }));
  }

  /**
   * Re-fetch at full precision before adding. FDC's search endpoint rounds to
   * ~3 significant figures; what gets stored should be the better number.
   */
  async function addFood(food: AdaptedFood) {
    setPendingFood(food.sourceId);
    const { food: resolved } = await fetchFoodDetail(food);
    setPendingFood(null);
    setShowSearch(false);
    setDraft((prior) =>
      prior === null
        ? prior
        : {
            ...prior,
            ingredients: [
              ...prior.ingredients,
              // The food's own portion beats 100 g: a burger knows it weighs
              // 291 g "per item", so "1 item" is the honest default.
              { uid: nextUid(), food: resolved, ...defaultPortion(resolved) },
            ],
          },
    );
  }

  async function handleSave() {
    if (draft === null || blocking.length > 0) return;
    setSaving(true);
    setSaveError(null);

    try {
      // Ingredients are only written now — one row per distinct food, reused
      // across every Component that references it.
      const ingredientIds = await Promise.all(
        draft.ingredients.map((item) => upsertIngredient(item.food)),
      );

      const id = await saveComponent({
        ...(draft.id === undefined ? {} : { id: draft.id }),
        name: draft.name,
        color: draft.color,
        category: draft.category,
        portionStyle: draft.portionStyle,
        baseQuantity,
        baseUnit: draft.portionStyle === 'bulk' ? 'g' : draft.baseUnit,
        ingredients: draft.ingredients.map((item, index) => ({
          ingredientId: ingredientIds[index] ?? 0,
          quantity: item.quantity,
          unit: item.unit,
          order: index,
        })),
        nutritionPerBase: nutrition!.nutrients,
        coveragePerBase: nutrition!.coverage,
        totalGrams,
      });

      navigate(`/components/${id}`);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="screen">
      <h1 className="screen__title">{draft.id === undefined ? 'New recipe' : 'Edit recipe'}</h1>

      <label className="field">
        <span className="field__label">Name</span>
        <input
          className="field__input"
          value={draft.name}
          onChange={(event) => patch({ name: event.target.value })}
          placeholder="Chicken Thighs"
        />
      </label>

      <label className="field">
        <span className="field__label">Category</span>
        <input
          className="field__input"
          value={draft.category}
          onChange={(event) => patch({ category: event.target.value })}
          placeholder="Protein"
          list="component-categories"
        />
        <datalist id="component-categories">
          {['Protein', 'Carb', 'Veg', 'Sauce', 'Side', 'Breakfast'].map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </label>

      <ColorPicker value={draft.color} onChange={(color) => patch({ color })} existing={others} />

      <PortionStyleField draft={draft} totalGrams={totalGrams} onPatch={patch} />

      <section className="section">
        <h2 className="section__title">Ingredients</h2>
        <IngredientRows
          items={draft.ingredients}
          onChange={(ingredients) => patch({ ingredients })}
        />

        {showSearch ? (
          <div className="builder__search">
            <FoodSearch onSelect={(food) => void addFood(food)} />
            {pendingFood !== null && (
              <p className="foodsearch__status">Fetching full-precision data…</p>
            )}
            <button type="button" className="btn" onClick={() => setShowSearch(false)}>
              Done adding
            </button>
          </div>
        ) : (
          <button type="button" className="btn" onClick={() => setShowSearch(true)}>
            + Add ingredient
          </button>
        )}
      </section>

      <NutritionSummary
        aggregate={nutrition}
        baseQuantity={baseQuantity}
        baseUnit={draft.portionStyle === 'bulk' ? 'g' : draft.baseUnit}
        portionStyle={draft.portionStyle}
      />

      {problems.length > 0 && (
        <ul className="problems">
          {problems.map((problem) => (
            <li key={problem.field + problem.message}>{problem.message}</li>
          ))}
        </ul>
      )}

      {saveError !== null && (
        <div className="notice notice--error">
          <p className="notice__body">{saveError}</p>
        </div>
      )}

      <div className="builder__actions">
        <button type="button" className="btn" onClick={() => navigate('/components')}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={blocking.length > 0 || saving}
          onClick={() => void handleSave()}
        >
          {saving ? 'Saving…' : 'Save Component'}
        </button>
      </div>

      {import.meta.env.DEV && (
        <button
          type="button"
          className="linkbtn"
          onClick={() => void db.delete().then(() => window.location.reload())}
        >
          Reset local database (dev only)
        </button>
      )}
    </div>
  );
}

function PortionStyleField({
  draft,
  totalGrams,
  onPatch,
}: {
  draft: ComponentDraftState;
  totalGrams: number;
  onPatch: (changes: Partial<ComponentDraftState>) => void;
}) {
  return (
    <div className="field">
      <span className="field__label">Portion style</span>

      <div className="segmented">
        <button
          type="button"
          className={`segmented__option${draft.portionStyle === 'discrete' ? ' segmented__option--on' : ''}`}
          onClick={() => onPatch({ portionStyle: 'discrete' })}
        >
          Discrete
        </button>
        <button
          type="button"
          className={`segmented__option${draft.portionStyle === 'bulk' ? ' segmented__option--on' : ''}`}
          onClick={() => onPatch({ portionStyle: 'bulk' })}
        >
          Bulk
        </button>
      </div>

      {draft.portionStyle === 'discrete' ? (
        <div className="yield">
          <input
            className="field__input yield__qty"
            type="number"
            inputMode="numeric"
            min="1"
            step="any"
            value={draft.baseQuantity}
            onChange={(event) => onPatch({ baseQuantity: Number(event.target.value) })}
            aria-label="Base yield"
          />
          <input
            className="field__input yield__unit"
            value={draft.baseUnit}
            onChange={(event) => onPatch({ baseUnit: event.target.value })}
            aria-label="Yield unit"
          />
          <span className="yield__hint">counted portions — a stepper when logging</span>
        </div>
      ) : (
        <p className="yield__hint">
          Measured by weight: {Math.round(totalGrams)} g total, taken as a percentage of what is
          left when logging.
        </p>
      )}
    </div>
  );
}
