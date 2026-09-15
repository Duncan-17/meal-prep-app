/**
 * What is actually in the fridge.
 *
 * Discrete stock reads as a count ("4 of 6 servings left"); bulk stock gets a
 * progress bar and a weight. Same underlying arithmetic — `portionStyle` only
 * picks the presentation (PLAN.md §3a).
 */

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { AdjustSheet } from '@/features/fridge/AdjustSheet';
import { PhasePlaceholder } from '@/ui/PhasePlaceholder';
import { listFridge } from '@/db/fridge';
import { fractionRemaining } from '@/domain/portions';
import { formatAmount } from '@/nutrition/registry';
import { relativeDay, toDayKey } from '@/domain/dates';
import type { FridgeEntry } from '@/domain/types';

export function FridgeScreen() {
  const entries = useLiveQuery(() => listFridge(), []);
  const [adjusting, setAdjusting] = useState<FridgeEntry | null>(null);

  // Keep the open sheet in step with live data after an adjustment.
  const live =
    adjusting === null ? null : (entries?.find((entry) => entry.id === adjusting.id) ?? null);

  return (
    <div className="screen">
      <h1 className="screen__title">Fridge</h1>
      <p className="screen__sub">What is cooked and waiting.</p>

      {entries === undefined ? (
        <p className="screen__sub">Loading…</p>
      ) : entries.length === 0 ? (
        <EmptyFridge />
      ) : (
        <ul className="cards">
          {entries.map((entry) => (
            <li key={entry.id}>
              <StockCard entry={entry} onAdjust={() => setAdjusting(entry)} />
            </li>
          ))}
        </ul>
      )}

      <PhasePlaceholder
        phase={6}
        title="Logging meals"
        items={[
          'From Fridge — stepper for discrete, percent picker for bulk',
          'Quick Add — search, manual entry, favourites',
          'Stock deducts transactionally; deleting a log restores it',
        ]}
      />

      <AdjustSheet entry={live} onClose={() => setAdjusting(null)} />
    </div>
  );
}

function StockCard({ entry, onAdjust }: { entry: FridgeEntry; onAdjust: () => void }) {
  const fraction = fractionRemaining(entry);
  const kcal = entry.nutritionPerUnit.energy_kcal;

  return (
    <div className="stock">
      <div className="stock__head">
        <span
          className="card__dot"
          style={{ background: entry.componentColor }}
          aria-hidden="true"
        />
        <div className="stock__title">
          <span className="card__name">{entry.componentName}</span>
          <span className="card__meta">
            Cooked {relativeDay(toDayKey(new Date(entry.cookedAt)))}
          </span>
        </div>
        <button type="button" className="btn stock__adjust" onClick={onAdjust}>
          Adjust
        </button>
      </div>

      {entry.portionStyle === 'bulk' ? (
        <>
          <div className="bar" role="img" aria-label={`${Math.round(fraction * 100)}% left`}>
            <span
              className="bar__fill"
              style={{ width: `${fraction * 100}%`, background: entry.componentColor }}
            />
          </div>
          <p className="stock__amount">
            {Math.round(fraction * 100)}% left · {formatWeight(entry.remaining)}
            {kcal === undefined
              ? ''
              : ` · ${formatAmount('energy_kcal', kcal * entry.remaining)} kcal remaining`}
          </p>
        </>
      ) : (
        <p className="stock__amount">
          <strong>{round(entry.remaining)}</strong> of {round(entry.initialQuantity)} {entry.unit}
          {entry.remaining === 1 ? '' : 's'} left
          {kcal === undefined ? '' : ` · ${formatAmount('energy_kcal', kcal)} kcal each`}
        </p>
      )}
    </div>
  );
}

function EmptyFridge() {
  return (
    <div className="placeholder">
      <p style={{ margin: '0 0 10px', fontWeight: 600 }}>Nothing cooked yet</p>
      <p className="screen__sub" style={{ margin: 0 }}>
        Schedule a cook on the Calendar, then mark it cooked — it lands here as stock you can log
        meals from.
      </p>
    </div>
  );
}

/** Grams under a kilo, kilos above — 1.9 kg reads better than 1900 g. */
function formatWeight(grams: number): string {
  return grams >= 1000 ? `${(grams / 1000).toFixed(2)} kg` : `${Math.round(grams)} g`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
