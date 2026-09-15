/**
 * Correcting or discarding stock.
 *
 * Both write a `stockAdjustments` row. The distinction matters: a correction
 * says the count was wrong all along, a discard says food existed and was
 * thrown away. Neither ever counts as eaten (PLAN.md §1.7).
 */

import { useEffect, useState } from 'react';

import { Sheet } from '@/ui/Sheet';
import { adjustStock, discardRemaining } from '@/db/fridge';
import { fractionRemaining, percentOfRemaining } from '@/domain/portions';
import type { FridgeEntry } from '@/domain/types';

interface Props {
  entry: FridgeEntry | null;
  onClose: () => void;
}

export function AdjustSheet({ entry, onClose }: Props) {
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  useEffect(() => {
    setText(entry === null ? '' : String(round(entry.remaining)));
    setNote('');
    setError(null);
    setConfirmingDiscard(false);
  }, [entry?.id, entry?.remaining, entry]);

  if (entry === null) {
    return <Sheet open={false} title="Adjust" onClose={onClose} children={null} />;
  }

  const value = Number(text);
  const valid = Number.isFinite(value) && value >= 0;
  const changed = valid && Math.abs(value - entry.remaining) > 1e-9;

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <Sheet open title={entry.componentName} onClose={onClose}>
      <p className="screen__sub">
        {round(entry.remaining)} of {round(entry.initialQuantity)} {entry.unit} left
        {entry.portionStyle === 'bulk' ? ` · ${Math.round(fractionRemaining(entry) * 100)}%` : ''}
      </p>

      <label className="field">
        <span className="field__label">Correct the amount left</span>
        <div className="yield">
          <input
            className="field__input yield__qty"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <span className="yield__hint">{entry.unit}</span>
        </div>
      </label>

      {changed && (
        <p className="yield__hint">
          {value > entry.remaining
            ? `Adding ${round(value - entry.remaining)} ${entry.unit} back`
            : `Removing ${round(entry.remaining - value)} ${entry.unit} · ${Math.round(
                percentOfRemaining(entry.remaining, entry.remaining - value),
              )}% of what is left`}
          . Recorded as a correction, not as eaten.
        </p>
      )}

      <label className="field">
        <span className="field__label">Note (optional)</span>
        <input
          className="field__input"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="miscounted when packing"
        />
      </label>

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
          disabled={!changed}
          onClick={() => void run(() => adjustStock(entry.id!, value, 'correction', note))}
        >
          Save correction
        </button>
      </div>

      <hr className="rule" />

      {confirmingDiscard ? (
        <div className="builder__actions">
          <button type="button" className="btn" onClick={() => setConfirmingDiscard(false)}>
            Keep it
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => void run(() => discardRemaining(entry.id!, 'discard', note))}
          >
            Discard {round(entry.remaining)} {entry.unit}
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => void run(() => discardRemaining(entry.id!, 'spoiled', note))}
          >
            It spoiled
          </button>
        </div>
      ) : (
        <button type="button" className="linkbtn" onClick={() => setConfirmingDiscard(true)}>
          Discard the rest
        </button>
      )}
    </Sheet>
  );
}

/** Two decimals at most — stock is grams or portions, not physics. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
