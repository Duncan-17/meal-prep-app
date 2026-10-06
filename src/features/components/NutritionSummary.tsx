/**
 * Live nutrition for a Component, per unit and per batch.
 *
 * Shows coverage next to anything partially known. A component built from
 * rice and chicken knows the chicken's B12 and nothing about the rice's, and
 * that distinction is the reason the coverage machinery exists (PLAN.md §3c) —
 * so it belongs on screen, not just in the data.
 */

import { coverageFor, isFullyCovered } from '@/domain/coverage';
import {
  DEFAULT_PINNED_NUTRIENTS,
  formatAmount,
  nutrientName,
  withDerivedTotals,
} from '@/nutrition/registry';
import type { NutrientAggregate, PortionStyle } from '@/domain/types';

interface Props {
  aggregate: NutrientAggregate;
  baseQuantity: number;
  baseUnit: string;
  portionStyle: PortionStyle;
}

export function NutritionSummary({
  aggregate: stored,
  baseQuantity,
  baseUnit,
  portionStyle,
}: Props) {
  const aggregate = withDerivedTotals(stored);
  const known = DEFAULT_PINNED_NUTRIENTS.filter((key) => key in aggregate.nutrients);

  if (known.length === 0) {
    return (
      <section className="section">
        <h2 className="section__title">Nutrition</h2>
        <p className="summary__empty">Add ingredients to see nutrition.</p>
      </section>
    );
  }

  const divisor = baseQuantity > 0 ? baseQuantity : 1;
  // Per gram is a meaningless display unit for bulk, so show per 100 g.
  const perUnitScale = portionStyle === 'bulk' ? 100 / divisor : 1 / divisor;
  const perUnitLabel = portionStyle === 'bulk' ? 'per 100 g' : `per ${baseUnit}`;

  return (
    <section className="section">
      <h2 className="section__title">Nutrition</h2>

      <table className="summary">
        <thead>
          <tr>
            <th scope="col">Nutrient</th>
            <th scope="col">{perUnitLabel}</th>
            <th scope="col">whole batch</th>
          </tr>
        </thead>
        <tbody>
          {known.map((key) => {
            const total = aggregate.nutrients[key] ?? 0;
            const covered = isFullyCovered(aggregate.coverage, key);
            return (
              <tr key={key}>
                <th scope="row">
                  {nutrientName(key)}
                  {!covered && (
                    <span
                      className="summary__coverage"
                      title={`${Math.round(coverageFor(aggregate.coverage, key) * 100)}% of the batch weight had data for this`}
                    >
                      {Math.round(coverageFor(aggregate.coverage, key) * 100)}%
                    </span>
                  )}
                </th>
                <td>{formatAmount(key, total * perUnitScale)}</td>
                <td>{formatAmount(key, total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="summary__foot">
        {Math.round(aggregate.totalGrams)} g total
        {portionStyle === 'discrete' && baseQuantity > 0
          ? ` · ${Math.round(aggregate.totalGrams / baseQuantity)} g per ${baseUnit}`
          : ''}
      </p>

      {known.some((key) => !isFullyCovered(aggregate.coverage, key)) && (
        <p className="summary__foot">
          A percentage means only that share of the batch weight had data for that nutrient. The
          real total is higher, not lower.
        </p>
      )}
    </section>
  );
}
