/**
 * The full nutrient panel — vitamins, minerals, fats and the rest — tucked
 * behind one tap under a summary's calorie bar and macro rings.
 *
 * The user asked for the micronutrients to be reachable from both the
 * average-day and the per-day summary (2026-10-08). Collapsed by default so a
 * scratchpad stays short until they are wanted.
 */

import { DayDetail } from '@/features/log/DayDetail';
import type { NutrientTarget } from '@/domain/plan';
import type { NutrientAggregate } from '@/domain/types';
import type { SegmentsFor } from '@/ui/SegmentedFill';

interface Props {
  totals: NutrientAggregate;
  targets: Map<string, NutrientTarget>;
  segmentsFor: SegmentsFor;
}

export function AllNutrients({ totals, targets, segmentsFor }: Props) {
  return (
    <details className="allnutrients">
      <summary>All nutrients — vitamins, minerals and more</summary>
      <DayDetail totals={totals} targets={targets} segmentsFor={segmentsFor} />
    </details>
  );
}
