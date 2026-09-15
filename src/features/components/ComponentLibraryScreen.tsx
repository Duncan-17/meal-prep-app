/**
 * The Component library — the list of things you batch-cook.
 *
 * Reads through `useLiveQuery`, so saving a Component anywhere updates this
 * without a refresh and without a store (PLAN.md §2).
 */

import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';

import { listComponents } from '@/db/components';
import { formatAmount } from '@/nutrition/registry';
import type { Component } from '@/domain/types';

export function ComponentLibraryScreen() {
  const components = useLiveQuery(() => listComponents(), []);

  return (
    <div className="screen">
      <div className="screen__head">
        <div>
          <h1 className="screen__title">Components</h1>
          <p className="screen__sub">Reusable batch-cookable items.</p>
        </div>
        <Link className="btn btn--primary" to="/components/new">
          + New
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
    </div>
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
      <p style={{ margin: '0 0 10px', fontWeight: 600 }}>No Components yet</p>
      <p className="screen__sub" style={{ margin: 0 }}>
        A Component is something you cook a batch of — chicken thighs, a pot of rice, a tub of
        guacamole. Build one and it becomes schedulable, cookable and loggable.
      </p>
    </div>
  );
}
