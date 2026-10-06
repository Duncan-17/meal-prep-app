/**
 * Food search — USDA, or the foods you saved yourself.
 *
 * Reused by the recipe builder, Quick Add and the fridge, so it takes an
 * `onSelect` rather than knowing what happens next. That reuse is why the
 * "My foods" toggle lives HERE: before it, a food you typed in could be put in
 * the fridge from the Foods library and nowhere else — not eaten, not added to
 * a recipe — because every picker only searched USDA.
 */

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { MIN_QUERY_LENGTH, useFoodSearch } from '@/features/foods/useFoodSearch';
import { ManualFoodEntry } from '@/features/foods/ManualFoodEntry';
import { FoodApiError } from '@/features/foods/api';
import { customFoodAsAdapted, listCustomFoods } from '@/db/ingredients';
import { RESULT_CAP, describeFood, rankFoods } from '@/domain/foodSearch';
import { nutritionForGrams } from '@/domain/nutrients';
import { formatAmount } from '@/nutrition/registry';
import type { AdaptedFood, Ingredient } from '@/domain/types';

interface Props {
  onSelect: (food: AdaptedFood) => void;
}

type Mode = 'usda' | 'mine';

/** Which half was used last, so someone who mostly logs saved foods stays there. */
const MODE_KEY = 'foodsearch.mode';

/** Shown under the name so the provenance of a number is never a mystery. */
const PREVIEW_KEYS = ['energy_kcal', 'protein_g', 'carbs_g', 'fat_g'] as const;

const PREVIEW_LABELS: Record<string, string> = {
  energy_kcal: 'kcal',
  protein_g: 'P',
  carbs_g: 'C',
  fat_g: 'F',
};

export function FoodSearch({ onSelect }: Props) {
  const [mode, setModeState] = useState<Mode>(readMode);
  const [query, setQuery] = useState('');
  const [manualOpen, setManualOpen] = useState(false);

  function setMode(next: Mode) {
    setModeState(next);
    setManualOpen(false);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // Private mode or blocked storage — the toggle still works this session.
    }
  }

  return (
    <div className="foodsearch">
      <div className="segmented segmented--full segmented--tight" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'usda'}
          className={`segmented__option${mode === 'usda' ? ' segmented__option--on' : ''}`}
          onClick={() => setMode('usda')}
        >
          USDA database
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'mine'}
          className={`segmented__option${mode === 'mine' ? ' segmented__option--on' : ''}`}
          onClick={() => setMode('mine')}
        >
          My foods
        </button>
      </div>

      <input
        className="foodsearch__input"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={mode === 'usda' ? 'Search foods — try “chicken thigh”' : 'Filter your foods'}
        aria-label={mode === 'usda' ? 'Search foods' : 'Filter your foods'}
        autoComplete="off"
      />

      {mode === 'usda' ? (
        <UsdaResults
          query={query}
          manualOpen={manualOpen}
          setManualOpen={setManualOpen}
          onSelect={onSelect}
        />
      ) : (
        <MyFoods query={query} onSelect={onSelect} />
      )}
    </div>
  );
}

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'mine' ? 'mine' : 'usda';
  } catch {
    return 'usda';
  }
}

function UsdaResults({
  query,
  manualOpen,
  setManualOpen,
  onSelect,
}: {
  query: string;
  manualOpen: boolean;
  setManualOpen: (open: boolean) => void;
  onSelect: (food: AdaptedFood) => void;
}) {
  const { status, foods: candidates, from, error } = useFoodSearch(query);
  const foods = useMemo(() => rankFoods(candidates, query), [candidates, query]);

  const showEmpty = status === 'ready' && foods.length === 0;

  return (
    <>
      <p className="foodsearch__status" role="status">
        {statusText({ query, status, count: foods.length, from })}
      </p>

      {error !== null && <SearchError error={error} />}

      {foods.length > 0 && (
        <ul className="foodsearch__results">
          {foods.map((food) => (
            <li key={`${food.source}:${food.sourceId}`}>
              <FoodCard food={food} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      )}

      {foods.length >= RESULT_CAP && (
        <p className="foodsearch__status">
          The {RESULT_CAP} closest matches. Not there? Add a word — “cooked”, “raw”, “white”.
        </p>
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
    </>
  );
}

/**
 * One result, labelled so it can be told from its neighbours: what it is,
 * how it was prepared, and whose it is.
 */
function FoodCard({
  food,
  onSelect,
}: {
  food: AdaptedFood;
  onSelect: (food: AdaptedFood) => void;
}) {
  const described = describeFood(food);
  const serving = food.dataType === 'Branded' ? food.portionGrams?.serving : undefined;

  return (
    <button type="button" className="foodcard" onClick={() => onSelect(food)}>
      <span className="foodcard__name">
        {described.title}
        {described.detail !== null && (
          <span className="foodcard__detail">, {described.detail}</span>
        )}
      </span>
      <span className="foodcard__meta">
        {described.prep !== null && (
          <span
            className={`badge badge--prep${described.prepInferred ? ' badge--guess' : ''}`}
            title={
              described.prepInferred
                ? 'Not stated on the label — inferred from calories per 100 g'
                : undefined
            }
          >
            {described.prep}
          </span>
        )}
        {described.brand !== null && <span className="badge">{described.brand}</span>}
        {described.category !== null && <span className="badge">{described.category}</span>}
        <span className="foodcard__source" title={food.dataType}>
          {described.source}
        </span>
      </span>
      <span className="foodcard__nums">
        <Preview food={food} />
        {serving !== undefined && ` · serving ${Math.round(serving)} g`}
      </span>
    </button>
  );
}

/** The user's own foods, filtered locally — no network, works offline. */
function MyFoods({ query, onSelect }: { query: string; onSelect: (food: AdaptedFood) => void }) {
  const foods = useLiveQuery(() => listCustomFoods(), []);

  if (foods === undefined) return <p className="foodsearch__status">Loading…</p>;

  if (foods.length === 0) {
    return (
      <p className="foodsearch__status">
        No saved foods yet. Add them under Recipes → Foods, and they will be here to pick.
      </p>
    );
  }

  const needle = query.trim().toLowerCase();
  const shown =
    needle === '' ? foods : foods.filter((food) => food.name.toLowerCase().includes(needle));

  return (
    <>
      <p className="foodsearch__status" role="status">
        {needle === ''
          ? `${foods.length} saved food${foods.length === 1 ? '' : 's'}`
          : shown.length === 0
            ? 'None of your foods match.'
            : `${shown.length} of ${foods.length}`}
      </p>
      {shown.length > 0 && (
        <ul className="foodsearch__results">
          {shown.map((food) => (
            <li key={food.id}>
              <button
                type="button"
                className="foodcard"
                onClick={() => onSelect(customFoodAsAdapted(food))}
              >
                <span className="foodcard__name">{food.name}</span>
                <span className="foodcard__nums">{perServing(food)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** "250 g serving · 150 kcal" — how a label reads, which is how these were entered. */
function perServing(food: Ingredient): string {
  const grams = food.portionGrams?.serving;
  if (grams === undefined) {
    const kcal = food.nutritionPer100g.energy_kcal;
    return kcal === undefined
      ? 'no calories recorded'
      : `${formatAmount('energy_kcal', kcal)} kcal / 100 g`;
  }
  const kcal = nutritionForGrams(food.nutritionPer100g, grams).energy_kcal;
  return `${Math.round(grams)} g serving${kcal === undefined ? '' : ` · ${formatAmount('energy_kcal', kcal)} kcal`}`;
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
  if (parts.length === 0) return <>no nutrition data</>;
  return <>{parts.join(' · ')} / 100 g</>;
}

function SearchError({ error }: { error: Error }) {
  const apiError = error instanceof FoodApiError ? error : null;
  const isMissingKey = apiError?.status === 503;

  /**
   * USDA throttles rapid searches and reports it as a 400 with a generic nginx
   * body, not a 429. The proxy already retries with a seconds-scale backoff;
   * if one still gets through, "searched too quickly" is the truth, whereas
   * the raw "returned 400" reads like the app sent something malformed.
   */
  const isThrottled =
    apiError !== null &&
    (apiError.status === 429 || (apiError.status === 502 && /returned 400/.test(error.message)));

  if (isThrottled) {
    return (
      <div className="notice notice--warn">
        <p className="notice__title">USDA is throttling us</p>
        <p className="notice__body">
          Their search rejects requests that arrive too close together. Give it a couple of seconds
          and try again — the same search usually works straight away.
        </p>
      </div>
    );
  }

  return (
    <div className="notice notice--error">
      <p className="notice__title">
        {isMissingKey ? 'The USDA key is not configured' : 'Search failed'}
      </p>
      <p className="notice__body">{error.message}</p>
      {apiError?.detail !== undefined && <p className="notice__body">{apiError.detail}</p>}
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
  return `${count} best match${count === 1 ? '' : 'es'} · ${from === 'cache' ? 'from cache' : 'from USDA'}`;
}
