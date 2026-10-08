/**
 * The full nutrient panel for one day.
 *
 * Collapsed by group, with a toggle for the sparse tail (PLAN.md §4). Storage
 * is the complete USDA panel; display is layered, because 75 numbers at once is
 * not insight.
 *
 * A nutrient with data but no target shows a bare value. A nutrient with no
 * data at all is hidden unless asked for — and listed as *missing*, never as
 * zero, which is the distinction the whole coverage system exists to keep.
 */

import { useState } from 'react';

import { TargetBar } from '@/ui/TargetBar';
import { coverageNote } from '@/domain/coverage';
import {
  NUTRIENTS,
  NUTRIENT_GROUP_LABELS,
  NUTRIENT_GROUP_ORDER,
  formatAmount,
  getNutrient,
  nutrientName,
  type NutrientGroup,
} from '@/nutrition/registry';
import type { NutrientTarget } from '@/domain/plan';
import type { NutrientAggregate } from '@/domain/types';
import type { SegmentsFor } from '@/ui/SegmentedFill';

interface Props {
  totals: NutrientAggregate;
  targets: Map<string, NutrientTarget>;
  /** Split each meter by the food it came from. */
  segmentsFor?: SegmentsFor;
}

export function DayDetail({ totals, targets, segmentsFor }: Props) {
  const [showEmpty, setShowEmpty] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<NutrientGroup>>(new Set(['macro']));

  function toggleGroup(group: NutrientGroup) {
    setOpenGroups((prior) => {
      const next = new Set(prior);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  const known = Object.keys(totals.nutrients).length;

  return (
    <section className="section">
      <div className="screen__head">
        <h2 className="section__title">Full panel</h2>
        <button type="button" className="linkbtn" onClick={() => setShowEmpty(!showEmpty)}>
          {showEmpty ? 'Hide nutrients with no data' : 'Show nutrients with no data'}
        </button>
      </div>

      <p className="screen__sub">
        {known} nutrient{known === 1 ? '' : 's'} with data.
      </p>

      {NUTRIENT_GROUP_ORDER.map((group) => {
        const definitions = NUTRIENTS.filter((definition) => definition.group === group);
        const withData = definitions.filter((definition) => definition.key in totals.nutrients);
        const withoutData = definitions.filter(
          (definition) => !(definition.key in totals.nutrients),
        );

        if (withData.length === 0 && !showEmpty) return null;

        const open = openGroups.has(group);

        return (
          <div key={group} className="plangroup">
            <button
              type="button"
              className="plangroup__toggle"
              onClick={() => toggleGroup(group)}
              aria-expanded={open}
            >
              <span>{NUTRIENT_GROUP_LABELS[group]}</span>
              <span className="plangroup__count">
                {withData.length}
                {showEmpty ? ` of ${definitions.length}` : ''}
                <span aria-hidden="true">{open ? ' ▾' : ' ▸'}</span>
              </span>
            </button>

            {open && (
              <>
                {withData.map((definition) => (
                  <PanelRow
                    key={definition.key}
                    nutrientKey={definition.key}
                    totals={totals}
                    target={targets.get(definition.key)}
                    segments={segmentsFor?.(definition.key)}
                  />
                ))}

                {showEmpty && withoutData.length > 0 && (
                  <p className="panel__missing">
                    No data for: {withoutData.map((d) => nutrientName(d.key)).join(', ')}.
                  </p>
                )}
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}

/**
 * A nutrient with a target gets a meter; one without gets its value.
 * Neither ever renders as a percentage of a goal that does not exist.
 */
function PanelRow({
  nutrientKey,
  totals,
  target,
  segments,
}: {
  nutrientKey: string;
  totals: NutrientAggregate;
  target: NutrientTarget | undefined;
  segments: ReturnType<SegmentsFor> | undefined;
}) {
  const amount = totals.nutrients[nutrientKey] ?? 0;

  if (target !== undefined) {
    return (
      <TargetBar
        nutrientKey={nutrientKey}
        amount={amount}
        target={target}
        coverage={totals.coverage}
        segments={segments}
      />
    );
  }

  const note = coverageNote(totals.coverage, nutrientKey);

  return (
    <div className="panel__row">
      <span>{nutrientName(nutrientKey)}</span>
      <span className="panel__value">
        {formatAmount(nutrientKey, amount)} {getNutrient(nutrientKey)?.unit ?? ''}
        {note !== null && <span className="summary__coverage">{note}</span>}
      </span>
    </div>
  );
}
