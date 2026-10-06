/**
 * The Component library — the list of things you batch-cook.
 *
 * Reads through `useLiveQuery`, so saving a Component anywhere updates this
 * without a refresh and without a store (PLAN.md §2).
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';

import { FoodLibrary } from '@/features/foods/FoodLibrary';

import { listComponents } from '@/db/components';
import { formatAmount } from '@/nutrition/registry';
import type { Component } from '@/domain/types';

/**
 * Two libraries under one tab.
 *
 * **Recipes** are things you assemble and cook a batch of. **Foods** are single
 * items you type in yourself because the database has never heard of them — the
 * specific yoghurt drink, a particular protein bar.
 *
 * A segmented toggle rather than two stacked lists: on a phone, stacking them
 * means scrolling past every recipe to reach the foods, and the two are used at
 * completely different moments.
 */
type Tab = 'recipes' | 'foods';

export function ComponentLibraryScreen() {
  const components = useLiveQuery(() => listComponents(), []);
  const [tab, setTab] = useState<Tab>('recipes');

  return (
    <div className="screen">
      <h1 className="screen__title">Recipes &amp; foods</h1>

      <div className="segmented segmented--full">
        <button
          type="button"
          className={`segmented__option${tab === 'recipes' ? ' segmented__option--on' : ''}`}
          onClick={() => setTab('recipes')}
        >
          Recipes
        </button>
        <button
          type="button"
          className={`segmented__option${tab === 'foods' ? ' segmented__option--on' : ''}`}
          onClick={() => setTab('foods')}
        >
          Foods
        </button>
      </div>

      {tab === 'foods' ? <FoodLibrary /> : <RecipeList components={components} />}
    </div>
  );
}

function RecipeList({ components }: { components: Component[] | undefined }) {
  return (
    <>
      <div className="screen__head">
        <p className="screen__sub">Things you cook a batch of, built from ingredients.</p>
        <Link className="btn btn--primary" to="/components/new">
          + New recipe
        </Link>
      </div>

      {components === undefined ? (
        <p className="screen__sub">Loading…</p>
      ) : components.length === 0 ? (
        <EmptyLibrary />
      ) : (
        <ul className="cards">
          {components.map((component) => (
            <li key={component.id}>
              <Link className="card" to={`/components/${component.id}`}>
                <span
                  className="card__dot"
                  style={{ background: component.color }}
                  aria-hidden="true"
                />
                <span className="card__body">
                  <span className="card__name">{component.name}</span>
                  <span className="card__meta">{describe(component)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function describe(component: Component): string {
  const parts: string[] = [];
  if (component.category !== undefined) parts.push(component.category);

  parts.push(
    component.portionStyle === 'bulk'
      ? `${Math.round(component.baseQuantity)} g batch`
      : `${component.baseQuantity} × ${component.baseUnit}`,
  );

  const kcal = component.nutritionPerBase.energy_kcal;
  if (kcal !== undefined && component.baseQuantity > 0) {
    parts.push(
      component.portionStyle === 'bulk'
        ? `${formatAmount('energy_kcal', (kcal / component.baseQuantity) * 100)} kcal/100 g`
        : `${formatAmount('energy_kcal', kcal / component.baseQuantity)} kcal each`,
    );
  }

  return parts.join(' · ');
}

function EmptyLibrary() {
  return (
    <div className="placeholder">
      <p style={{ margin: '0 0 10px', fontWeight: 600 }}>No recipes yet</p>
      <p className="screen__sub" style={{ margin: 0 }}>
        A recipe is something you cook a batch of — chicken thighs, a pot of rice, a tub of
        guacamole. Name it, list what goes in, and it becomes schedulable, cookable and loggable.
      </p>
    </div>
  );
}
