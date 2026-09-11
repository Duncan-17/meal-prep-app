/**
 * Ingredient search.
 *
 * Reused by the Component Builder (Phase 3) and Quick Add (Phase 6), so it
 * takes an `onSelect` rather than knowing what happens next.
 */

import { useState } from 'react';

import { MIN_QUERY_LENGTH, useFoodSearch } from '@/features/foods/useFoodSearch';
import { ManualFoodEntry } from '@/features/foods/ManualFoodEntry';
import { FoodApiError } from '@/features/foods/api';
import { formatAmount } from '@/nutrition/registry';
import type { AdaptedFood } from '@/domain/types';

interface Props {
  onSelect: (food: AdaptedFood) => void;
}

/** Shown under the name so the provenance of a number is never a mystery. */
const PREVIEW_KEYS = ['energy_kcal', 'protein_g', 'carbs_g', 'fat_g'] as const;

const PREVIEW_LABELS: Record<string, string> = {
  energy_kcal: 'kcal',
  protein_g: 'P',
  carbs_g: 'C',
  fat_g: 'F',
};

export function FoodSearch({ onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const { status, foods, from, error } = useFoodSearch(query);

  const showEmpty = status === 'ready' && foods.length === 0;

  return (
    <div className="foodsearch">
      <input
        className="foodsearch__input"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search foods — try “chicken thigh”"
        aria-label="Search foods"
        autoComplete="off"
      />

      <p className="foodsearch__status" role="status">
        {statusText({ query, status, count: foods.length, from })}
      </p>

      {error !== null && <SearchError error={error} />}

      {foods.length > 0 && (
        <ul className="foodsearch__results">
          {foods.map((food) => (
            <li key={`${food.source}:${food.sourceId}`}>
              <button type="button" className="foodcard" onClick={() => onSelect(food)}>
                <span className="foodcard__name">{food.name}</span>
                <span className="foodcard__meta">
                  {food.dataType !== undefined && <span className="badge">{food.dataType}</span>}
                  {food.brand !== undefined && <span className="badge">{food.brand}</span>}
                  <Preview food={food} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {(showEmpty || error !== null) && !manualOpen && (
        <button type="button" className="linkbtn" onClick={() => setManualOpen(true)}>
          Enter it manually instead
        </button>
      )}

      {manualOpen && (
        <ManualFoodEntry
          initialName={query}
          onCancel={() => setManualOpen(false)}
          onSubmit={(food) => {
            setManualOpen(false);
            onSelect(food);
          }}
        />
      )}
    </div>
  );
}

/** Per 100 g, which is the basis every adapter normalises to. */
function Preview({ food }: { food: AdaptedFood }) {
  const parts: string[] = [];
  for (const key of PREVIEW_KEYS) {
    const value = food.nutritionPer100g[key];
    // Presence, not truthiness — a measured 0 g is data worth showing.
    if (value === undefined) continue;
    parts.push(`${formatAmount(key, value)} ${PREVIEW_LABELS[key] ?? ''}`.trim());
  }
  if (parts.length === 0) return <span className="foodcard__nums">no nutrition data</span>;
  return <span className="foodcard__nums">{parts.join(' · ')} / 100 g</span>;
}

function SearchError({ error }: { error: Error }) {
  const isMissingKey = error instanceof FoodApiError && error.status === 503;
  const isRateLimited = error instanceof FoodApiError && error.status === 429;

  return (
    <div className="notice notice--error">
      <p className="notice__title">
        {isMissingKey
          ? 'The USDA key is not configured'
          : isRateLimited
            ? 'USDA rate limit reached'
            : 'Search failed'}
      </p>
      <p className="notice__body">{error.message}</p>
      {error instanceof FoodApiError && error.detail !== undefined && (
        <p className="notice__body">{error.detail}</p>
      )}
    </div>
  );
}

function statusText({
  query,
  status,
  count,
  from,
}: {
  query: string;
  status: string;
  count: number;
  from: string | null;
}): string {
  const trimmed = query.trim();
  if (trimmed.length === 0) return 'Search the USDA FoodData Central database.';
  if (trimmed.length < MIN_QUERY_LENGTH) return `Keep typing…`;
  if (status === 'searching') return 'Searching…';
  if (status === 'error') return '';
  if (count === 0) return 'Nothing found.';
  // Saying which layer answered makes the cache observable rather than folklore.
  return `${count} result${count === 1 ? '' : 's'} · ${from === 'cache' ? 'from cache' : 'from USDA'}`;
}
