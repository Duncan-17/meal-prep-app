/**
 * One scratchpad item, compact until asked.
 *
 * Collapsed (the default) it is a single line: colour, name, a short summary
 * and remove. The user found the always-open version took far too much of
 * the screen (2026-10-08), so the controls live one tap down, and the full
 * nutrient breakdown one tap further.
 */

import { useState } from 'react';

import { Stepper } from '@/ui/Stepper';
import { placedTotal, withPortions } from '@/domain/scratchpad';
import { defaultFoodPortions, defaultRecipePortions, portionName } from '@/nutrition/scratchpad';
import {
  NUTRIENT_GROUP_LABELS,
  NUTRIENT_GROUP_ORDER,
  formatAmount,
  getNutrient,
  nutrientsInGroup,
  withDerivedTotals,
} from '@/nutrition/registry';
import { unitOptionsFor } from '@/nutrition/units';
import type { Component, NutrientAggregate, ScratchpadItem } from '@/domain/types';

interface Props {
  item: ScratchpadItem;
  total: NutrientAggregate;
  components: ReadonlyMap<number, Component>;
  onChange: (update: (item: ScratchpadItem) => ScratchpadItem) => void;
  onRemove: () => void;
}

export function ItemRow({ item, total, components, onChange, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const [showNutrition, setShowNutrition] = useState(false);
  const recipe = item.kind === 'recipe' ? components.get(item.componentId) : undefined;
  const name = portionName(item, components);
  const placed = placedTotal(item);
  const kcal = total.nutrients.energy_kcal;

  const amount =
    item.kind === 'food'
      ? `${round(item.quantity)} ${item.unit}`
      : `${round(item.batches)} batch${item.batches === 1 ? '' : 'es'}`;

  return (
    <li className={`paditem${open ? ' paditem--open' : ''}`}>
      <div className="paditem__head">
        <button
          type="button"
          className="paditem__toggle"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <span className="card__dot" style={{ background: item.color }} aria-hidden="true" />
          <span className="paditem__name">{item.label}</span>
          <span className="paditem__summary">
            {amount}
            {kcal === undefined ? '' : ` · ${formatAmount('energy_kcal', kcal)} kcal`}
            {placed > 0 ? ` · ${placed}/${item.portions} placed` : ''}
          </span>
          <span className="paditem__chevron" aria-hidden="true">
            {open ? '▴' : '▾'}
          </span>
        </button>
        <button
          type="button"
          className="ingredient__remove"
          onClick={onRemove}
          aria-label={`Remove ${item.label}`}
        >
          ✕
        </button>
      </div>

      {item.kind === 'recipe' && recipe === undefined && (
        <p className="paditem__meta">
          <span className="badge badge--limit">recipe deleted</span> It no longer counts toward
          anything.
        </p>
      )}

      {open && (
        <div className="paditem__body">
          <div className="paditem__controls">
            {item.kind === 'food' ? (
              <span className="paditem__amount">
                <input
                  className="field__input paditem__qty"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={item.quantity}
                  aria-label={`How much ${item.label}`}
                  onChange={(event) => {
                    const quantity = Math.max(0, Number(event.target.value));
                    onChange((current) => {
                      const next = { ...current, quantity } as typeof item;
                      return withPortions(next, defaultFoodPortions(next));
                    });
                  }}
                />
                <select
                  className="field__input paditem__unit"
                  value={item.unit}
                  aria-label={`Unit for ${item.label}`}
                  onChange={(event) => {
                    const unit = event.target.value;
                    onChange((current) => {
                      const next = { ...current, unit } as typeof item;
                      return withPortions(next, defaultFoodPortions(next));
                    });
                  }}
                >
                  {unitOptionsFor(item).map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </span>
            ) : (
              <span className="paditem__amount">
                <Stepper
                  value={item.batches}
                  min={0.5}
                  step={0.5}
                  onChange={(batches) =>
                    onChange((current) => {
                      const next = { ...current, batches } as typeof item;
                      return withPortions(
                        next,
                        recipe === undefined
                          ? Math.round((current.portions * batches) / item.batches)
                          : defaultRecipePortions(recipe, batches),
                      );
                    })
                  }
                  label={`Batches of ${item.label}`}
                />
                <span className="paditem__unitlabel">batch{item.batches === 1 ? '' : 'es'}</span>
              </span>
            )}

            <span className="paditem__amount">
              <span className="paditem__unitlabel">split into</span>
              <Stepper
                value={item.portions}
                min={1}
                onChange={(portions) => onChange((current) => withPortions(current, portions))}
                label={`Portions of ${item.label}`}
              />
            </span>
          </div>

          <p className="paditem__meta">
            {item.portions} × {name}
            {kcal === undefined
              ? ''
              : ` · ${formatAmount('energy_kcal', kcal / Math.max(1, item.portions))} kcal each`}
            {` · ${placed} placed on days, ${item.portions - placed} not placed`}
          </p>

          <button
            type="button"
            className="linkbtn paditem__more"
            onClick={() => setShowNutrition(!showNutrition)}
            aria-expanded={showNutrition}
          >
            {showNutrition ? 'Hide nutrition' : 'Nutrition breakdown'}
          </button>

          {showNutrition && <ItemNutrition total={total} portions={item.portions} portion={name} />}
        </div>
      )}
    </li>
  );
}

/** Every nutrient the item has data for, per portion and in all, grouped. */
function ItemNutrition({
  total,
  portions,
  portion,
}: {
  total: NutrientAggregate;
  portions: number;
  portion: string;
}) {
  const withTotals = withDerivedTotals(total);
  const groups = NUTRIENT_GROUP_ORDER.map((group) => ({
    group,
    rows: nutrientsInGroup(group).filter((def) => def.key in withTotals.nutrients),
  })).filter(({ rows }) => rows.length > 0);

  if (groups.length === 0) return <p className="paditem__meta">No nutrition data.</p>;

  return (
    <table className="summary paditem__table">
      <thead>
        <tr>
          <th scope="col">Nutrient</th>
          <th scope="col">per {portion}</th>
          <th scope="col">in all</th>
        </tr>
      </thead>
      {groups.map(({ group, rows }) => (
        <tbody key={group}>
          <tr>
            <th scope="rowgroup" colSpan={3} className="paditem__group">
              {NUTRIENT_GROUP_LABELS[group]}
            </th>
          </tr>
          {rows.map((def) => {
            const value = withTotals.nutrients[def.key] ?? 0;
            const unit = getNutrient(def.key)?.unit ?? '';
            return (
              <tr key={def.key}>
                <th scope="row">{def.name}</th>
                <td>
                  {formatAmount(def.key, value / Math.max(1, portions))} {unit}
                </td>
                <td>
                  {formatAmount(def.key, value)} {unit}
                </td>
              </tr>
            );
          })}
        </tbody>
      ))}
    </table>
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
