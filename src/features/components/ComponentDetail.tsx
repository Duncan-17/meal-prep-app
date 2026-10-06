/**
 * One Component: its recipe, its nutrition, and what you can do with it.
 *
 * Delete is guarded — a Component with cook history cannot be removed without
 * orphaning the batches and fridge entries that point at it.
 */

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';

import { NutritionSummary } from '@/features/components/NutritionSummary';
import {
  ComponentInUseError,
  componentUsage,
  deleteComponent,
  getComponent,
} from '@/db/components';
import { getIngredients } from '@/db/ingredients';
import { resolveToGrams } from '@/nutrition/units';

export function ComponentDetail() {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const component = useLiveQuery(() => getComponent(id), [id]);
  const usage = useLiveQuery(() => componentUsage(id), [id]);
  const ingredients = useLiveQuery(
    async () =>
      component === undefined
        ? new Map()
        : getIngredients(component.ingredients.map((entry) => entry.ingredientId)),
    [component],
  );

  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (component === undefined) {
    return (
      <div className="screen">
        <p className="screen__sub">Loading…</p>
      </div>
    );
  }

  const hasHistory = usage !== undefined && (usage.batches > 0 || usage.fridgeEntries > 0);

  async function handleDelete() {
    setDeleteError(null);
    try {
      await deleteComponent(id);
      navigate('/components');
    } catch (error) {
      setDeleteError(
        error instanceof ComponentInUseError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error),
      );
      setConfirming(false);
    }
  }

  return (
    <div className="screen">
      <Link className="linkbtn" to="/components">
        ‹ Recipes
      </Link>

      <div className="detail__head">
        <span
          className="card__dot card__dot--lg"
          style={{ background: component.color }}
          aria-hidden="true"
        />
        <div>
          <h1 className="screen__title">{component.name}</h1>
          <p className="screen__sub">
            {component.category !== undefined ? `${component.category} · ` : ''}
            {component.portionStyle === 'bulk'
              ? `${Math.round(component.baseQuantity)} g batch, logged by percentage`
              : `${component.baseQuantity} × ${component.baseUnit}, logged by count`}
          </p>
        </div>
      </div>

      <section className="section">
        <h2 className="section__title">Ingredients</h2>
        <ul className="recipe">
          {component.ingredients
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((entry) => {
              const ingredient = ingredients?.get(entry.ingredientId);
              const grams =
                ingredient === undefined
                  ? null
                  : resolveToGrams(entry.quantity, entry.unit, ingredient).grams;
              return (
                <li key={`${entry.ingredientId}-${entry.order}`} className="recipe__row">
                  <span>{ingredient?.name ?? 'Missing ingredient'}</span>
                  <span className="recipe__amount">
                    {entry.quantity} {entry.unit}
                    {grams !== null && entry.unit !== 'g' ? ` · ${Math.round(grams)} g` : ''}
                  </span>
                </li>
              );
            })}
        </ul>
      </section>

      <NutritionSummary
        aggregate={{
          nutrients: component.nutritionPerBase,
          coverage: component.coveragePerBase,
          totalGrams: component.totalGrams,
        }}
        baseQuantity={component.baseQuantity}
        baseUnit={component.baseUnit}
        portionStyle={component.portionStyle}
      />

      <div className="builder__actions">
        <Link className="btn" to={`/components/${component.id}/edit`}>
          Edit
        </Link>
        {confirming ? (
          <>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              Keep
            </button>
            <button type="button" className="btn btn--danger" onClick={() => void handleDelete()}>
              Really delete
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn"
            onClick={() => setConfirming(true)}
            disabled={hasHistory}
            title={hasHistory ? 'Cooked before — deleting would orphan that history' : undefined}
          >
            Delete
          </button>
        )}
      </div>

      {hasHistory && usage !== undefined && (
        <p className="screen__sub">
          Cooked {usage.batches} time{usage.batches === 1 ? '' : 's'} · {usage.fridgeEntries} fridge
          entr{usage.fridgeEntries === 1 ? 'y' : 'ies'}. Editing is fine — history keeps its own
          snapshot — but it can no longer be deleted.
        </p>
      )}

      {deleteError !== null && (
        <div className="notice notice--error">
          <p className="notice__body">{deleteError}</p>
        </div>
      )}
    </div>
  );
}
