/**
 * "Mark cooked", with actual-yield confirmation (PLAN.md §1.6).
 *
 * Asking what really came out of the pan is the point of this sheet. Planned
 * yield is a guess; six portions is often five or seven, and every per-serving
 * number downstream is wrong if this is taken on faith.
 */

import { useEffect, useState } from 'react';

import { Sheet } from '@/ui/Sheet';
import { markCooked, plannedYield } from '@/db/fridge';
import { batchNutrition } from '@/db/batches';
import { formatAmount } from '@/nutrition/registry';
import type { Batch } from '@/domain/types';

interface Props {
  batch: Batch | null;
  onClose: () => void;
  onCooked?: () => void;
}

export function MarkCookedSheet({ batch, onClose, onCooked }: Props) {
  const planned = batch === null ? 0 : plannedYield(batch.baseQuantity, batch.scale);
  const [yieldText, setYieldText] = useState(String(planned));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset when a different batch opens the sheet.
  useEffect(() => {
    setYieldText(String(planned));
    setError(null);
  }, [planned, batch?.id]);

  const actual = Number(yieldText);
  const valid = Number.isFinite(actual) && actual > 0;
  const differs = valid && Math.abs(actual - planned) > 1e-9;

  async function confirm() {
    if (batch?.id === undefined || !valid) return;
    setSaving(true);
    setError(null);
    try {
      await markCooked(batch.id, actual);
      onCooked?.();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  const unit = batch === null ? '' : batch.portionStyle === 'bulk' ? 'g' : batch.baseUnit;

  return (
    <Sheet
      open={batch !== null}
      title={batch === null ? 'Mark cooked' : `Cooked ${batch.componentName}`}
      onClose={onClose}
    >
      {batch !== null && (
        <>
          <p className="screen__sub">
            How much did you actually get? Planned {planned} {unit}.
          </p>

          <label className="field">
            <span className="field__label">Actual yield</span>
            <div className="yield">
              <input
                className="field__input yield__qty"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={yieldText}
                onChange={(event) => setYieldText(event.target.value)}
                autoFocus
              />
              <span className="yield__hint">{unit}</span>
            </div>
          </label>

          {valid && (
            <p className="yield__hint">
              {describePerUnit(batch, actual, unit)}
              {differs ? ' · recalculated for the real yield, not the plan' : ''}
            </p>
          )}

          {!valid && yieldText !== '' && (
            <p className="ingredient__note ingredient__note--warn">
              Yield must be greater than zero.
            </p>
          )}

          {error !== null && (
            <div className="notice notice--error">
              <p className="notice__body">{error}</p>
            </div>
          )}

          <div className="builder__actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!valid || saving}
              onClick={() => void confirm()}
            >
              {saving ? 'Saving…' : 'Into the fridge'}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

function describePerUnit(batch: Batch, actualYield: number, unit: string): string {
  const total = batchNutrition(batch);
  const kcal = total.energy_kcal;
  if (kcal === undefined) return `${actualYield} ${unit}`;

  if (batch.portionStyle === 'bulk') {
    return `${formatAmount('energy_kcal', (kcal / actualYield) * 100)} kcal per 100 g`;
  }
  return `${formatAmount('energy_kcal', kcal / actualYield)} kcal per ${batch.baseUnit}`;
}
