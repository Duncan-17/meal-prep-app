/**
 * Debounced food search.
 *
 * Debouncing is not only a nicety here: every keystroke that reaches the proxy
 * costs a FoodData Central request against a rate-limited key. The in-flight
 * request is aborted whenever the query moves on, so a fast typist produces one
 * search, not eight.
 */

import { useEffect, useRef, useState } from 'react';

import { searchFoods, type SearchOutcome } from '@/features/foods/api';
import type { AdaptedFood } from '@/domain/types';

export type SearchStatus = 'idle' | 'searching' | 'ready' | 'error';

export interface FoodSearchState {
  status: SearchStatus;
  foods: AdaptedFood[];
  /** Where the current results came from, so the UI can say so. */
  from: SearchOutcome['from'] | null;
  error: Error | null;
}

const IDLE: FoodSearchState = { status: 'idle', foods: [], from: null, error: null };

/** Below this a search matches almost everything and is not worth a request. */
export const MIN_QUERY_LENGTH = 2;

export const DEBOUNCE_MS = 350;

export function useFoodSearch(query: string, debounceMs = DEBOUNCE_MS): FoodSearchState {
  const [state, setState] = useState<FoodSearchState>(IDLE);

  // Survives re-renders so a superseded request can be cancelled.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < MIN_QUERY_LENGTH) {
      abortRef.current?.abort();
      setState(IDLE);
      return;
    }

    setState((prior) => ({ ...prior, status: 'searching', error: null }));

    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      searchFoods(trimmed, { signal: controller.signal })
        .then((outcome) => {
          if (controller.signal.aborted) return;
          setState({ status: 'ready', foods: outcome.foods, from: outcome.from, error: null });
        })
        .catch((error: unknown) => {
          // An abort is this effect doing its job, not a failure to report.
          if (controller.signal.aborted) return;
          setState({
            status: 'error',
            foods: [],
            from: null,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        });
    }, debounceMs);

    return () => {
      clearTimeout(timer);
    };
  }, [query, debounceMs]);

  // Abort whatever is in flight when the component goes away.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return state;
}
