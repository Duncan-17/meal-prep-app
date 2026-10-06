/**
 * A meter's fill, split by the food each part came from.
 *
 * Steak and eggs in one protein bar: a steak-coloured run, then an
 * egg-coloured one, each as long as its contribution. Laid inside a track that
 * is `position: relative; overflow: hidden`, which supplies the rounded ends.
 *
 * Colour is not the only signal — every segment carries its food and amount as
 * a title, and the Diary lists each food beside a dot of the same colour.
 */

import { contributionsFor, placeSegments, type Segment } from '@/domain/contributions';
import { DERIVED_TOTALS } from '@/nutrition/registry';
import type { MealLog } from '@/domain/types';

/** Who contributed to each nutrient across these logs — per-item snapshots. */
export type SegmentsFor = (nutrientKey: string) => Segment[];

export function segmentsForLogs(logs: readonly MealLog[]): SegmentsFor {
  const items = logs.flatMap((log) => log.items);
  return (nutrientKey) => contributionsFor(items, nutrientKey, DERIVED_TOTALS);
}

interface Props {
  segments: readonly Segment[];
  /** What a full track represents — the goal. */
  full: number;
  /** "g", "kcal" — for the hover label. */
  unit: string;
  format: (amount: number) => string;
}

export function SegmentedFill({ segments, full, unit, format }: Props) {
  const placed = placeSegments(segments, full);
  return (
    <>
      {placed.map(({ segment, start, length }, index) => (
        <span
          key={`${segment.label}-${index}`}
          className={`segment${index < placed.length - 1 ? ' segment--split' : ''}`}
          style={{
            left: `${start * 100}%`,
            width: `${length * 100}%`,
            background: segment.color ?? 'var(--segment-neutral)',
          }}
          title={`${segment.label} · ${format(segment.amount)} ${unit}`}
        />
      ))}
    </>
  );
}
