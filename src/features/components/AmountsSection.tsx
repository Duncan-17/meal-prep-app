/**
 * How much of each ingredient actually goes in.
 *
 * Separated from picking the ingredients deliberately (user's framing,
 * 2026-10-06): choosing *what* is in fried rice and deciding *how much* rice
 * are two different jobs, and interleaving them means re-reading the whole list
 * to answer either question.
 *
 * Every row shows its resolved gram weight, because that is what the nutrition
 * is actually computed from — and shows when that weight is a guess rather
 * than a measurement.
 */

import { resolveToGrams, unitOptionsFor } from '@/nutrition/units';
import { formatAmount } from '@/nutrition/registry';
import { nutritionForGrams } from '@/domain/nutrients';
import type { DraftIngredient } from '@/features/components/draft';

interface Props {
  items: DraftIngredient[];
  onChange: (items: DraftIngredient[]) => void;
}

export function AmountsSection({ items, onChange }: Props) {
  if (items.length === 0) return null;

  function update(uid: string, patch: Partial<DraftIngredient>) {
    onChange(items.map((item) => (item.uid === uid ? { ...item, ...patch } : item)));
  }

  const totalGrams = items.reduce(
    (sum, item) => sum + resolveToGrams(item.quantity, item.unit, item.food).grams,
    0,
  );

  return (
    <section className="section">
      <h2 className="section__title">Amount of each</h2>
      <p className="screen__sub">How much goes into one batch.</p>

      <ul className="amounts">
        {items.map((item) => {
          const resolved = resolveToGrams(item.quantity, item.unit, item.food);
          const kcal = nutritionForGrams(item.food.nutritionPer100g, resolved.grams).energy_kcal;
          const estimated = resolved.confidence === 'density' || resolved.confidence === 'assumed';

          return (
            <li key={item.uid} className="amount">
              <span className="amount__name">{item.food.name}</span>

              <div className="amount__controls">
                <input
                  className="field__input amount__qty"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={item.quantity}
                  onChange={(event) => update(item.uid, { quantity: Number(event.target.value) })}
                  aria-label={`Amount of ${item.food.name}`}
                />
                <select
                  className="field__input amount__unit"
                  value={item.unit}
                  onChange={(event) => update(item.uid, { unit: event.target.value })}
                  aria-label={`Unit for ${item.food.name}`}
                >
                  {unitOptions(item).map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </div>

              <span className="amount__grams">
                {resolved.confidence === 'unknown' ? (
                  <span className="amount__warn">weight unknown</span>
                ) : (
                  <>
                    {Math.round(resolved.grams)} g
                    {kcal !== undefined && (
                      <span className="amount__kcal">
                        {' '}
                        · {formatAmount('energy_kcal', kcal)} kcal
                      </span>
                    )}
                    {estimated && <span className="amount__est"> · estimated</span>}
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="amounts__total">
        <strong>{Math.round(totalGrams)} g</strong> total
      </p>
    </section>
  );
}

function unitOptions(item: DraftIngredient): string[] {
  const options = unitOptionsFor(item.food);
  return options.includes(item.unit) ? options : [...options, item.unit];
}
