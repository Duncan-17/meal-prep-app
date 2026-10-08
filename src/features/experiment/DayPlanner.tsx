/**
 * Day by day: drag the food onto the days you would eat it.
 *
 * The user's choices (2026-10-08): one drag places ONE portion, and −/+ on
 * the day adjusts it; anything not placed waits in the tray and counts toward
 * no day. Drags go tray → day (place one), day → day (move one) and
 * day → tray (take one back).
 *
 * Touch needs a short press before a drag starts, or every scroll of the page
 * would pick something up. Mouse needs a few pixels of movement, so a click
 * on − or + is never mistaken for a drag. The keyboard sensor keeps it usable
 * without a pointer at all.
 */

import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';

import { TodaySummary } from '@/features/log/TodaySummary';
import { contributionsFor } from '@/domain/contributions';
import {
  adjustDay,
  contributors,
  dayTotal,
  moveOne,
  placeOne,
  placedOn,
  unplaced,
  type CostedItem,
} from '@/domain/scratchpad';
import { DAY_MACROS, progressFor, type NutrientTarget } from '@/domain/plan';
import { portionName } from '@/nutrition/scratchpad';
import { DERIVED_TOTALS, formatAmount } from '@/nutrition/registry';
import { macroColor, prefersDark } from '@/ui/vizPalette';
import type { Component, Scratchpad, ScratchpadItem } from '@/domain/types';

interface Props {
  pad: Scratchpad;
  costed: CostedItem[];
  components: ReadonlyMap<number, Component>;
  targets: Map<string, NutrientTarget>;
  onChange: (pad: Scratchpad) => void;
}

/** Where a dragged chip came from. */
type Origin = { uid: string; from: number | 'tray' };

const TRAY = 'tray';

export function DayPlanner({ pad, costed, components, targets, onChange }: Props) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const [dragging, setDragging] = useState<Origin | null>(null);
  const [selected, setSelected] = useState(0);

  const update = (uid: string, change: (item: ScratchpadItem) => ScratchpadItem) =>
    onChange({ ...pad, items: pad.items.map((item) => (item.uid === uid ? change(item) : item)) });

  function onDragStart(event: DragStartEvent) {
    setDragging((event.active.data.current as Origin | undefined) ?? null);
  }

  function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    const origin = event.active.data.current as Origin | undefined;
    const target = event.over?.id;
    if (origin === undefined || target === undefined) return;

    const to = target === TRAY ? TRAY : Number(String(target).replace('day-', ''));
    if (origin.from === TRAY && to !== TRAY) update(origin.uid, (item) => placeOne(item, to));
    else if (origin.from !== TRAY && to !== TRAY) {
      const from = origin.from;
      update(origin.uid, (item) => moveOne(item, from, to));
    } else if (origin.from !== TRAY && to === TRAY) {
      const from = origin.from;
      update(origin.uid, (item) => adjustDay(item, from, -1));
    }
  }

  const tray = pad.items.filter((item) => unplaced(item) > 0);
  const draggedItem =
    dragging === null ? undefined : pad.items.find((item) => item.uid === dragging.uid);
  const day = Math.min(selected, pad.days - 1);
  const dayTotals = dayTotal(costed, day);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <Tray items={tray} components={components} />

      <div className="planner">
        {Array.from({ length: pad.days }, (_, index) => (
          <DayCard
            key={index}
            day={index}
            selected={index === day}
            costed={costed}
            components={components}
            targets={targets}
            onSelect={() => setSelected(index)}
            onAdjust={(uid, delta) => update(uid, (item) => adjustDay(item, index, delta))}
          />
        ))}
      </div>

      <section className="section">
        <h2 className="section__title">Day {day + 1}</h2>
        {Object.keys(dayTotals.nutrients).length === 0 ? (
          <p className="screen__sub">Nothing placed on this day yet.</p>
        ) : (
          <TodaySummary
            totals={dayTotals}
            targets={targets}
            segmentsFor={(key) =>
              contributionsFor(contributors(costed, pad.days, day), key, DERIVED_TOTALS)
            }
          />
        )}
      </section>

      <DragOverlay dropAnimation={null}>
        {draggedItem === undefined ? null : (
          <span className="chip chip--overlay">
            <span className="chip__dot" style={{ background: draggedItem.color }} />
            {draggedItem.label}
          </span>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** Everything not yet on a day. Sticky, so it stays in reach while scrolling. */
function Tray({
  items,
  components,
}: {
  items: ScratchpadItem[];
  components: ReadonlyMap<number, Component>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: TRAY });
  return (
    <div ref={setNodeRef} className={`tray${isOver ? ' tray--over' : ''}`}>
      <p className="tray__title">Not placed</p>
      {items.length === 0 ? (
        <p className="tray__empty">Everything is on a day.</p>
      ) : (
        <div className="tray__chips">
          {items.map((item) => (
            <Chip
              key={item.uid}
              id={`tray-${item.uid}`}
              origin={{ uid: item.uid, from: 'tray' }}
              item={item}
              count={unplaced(item)}
              unit={portionName(item, components)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DayCard({
  day,
  selected,
  costed,
  components,
  targets,
  onSelect,
  onAdjust,
}: {
  day: number;
  selected: boolean;
  costed: CostedItem[];
  components: ReadonlyMap<number, Component>;
  targets: Map<string, NutrientTarget>;
  onSelect: () => void;
  onAdjust: (uid: string, delta: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${day}` });
  const dark = prefersDark();
  const totals = dayTotal(costed, day);
  const kcal = totals.nutrients.energy_kcal;
  const kcalTarget = targets.get('energy_kcal');
  const here = costed.filter(({ item }) => placedOn(item, day) > 0);

  return (
    <div
      ref={setNodeRef}
      className={`daycard${isOver ? ' daycard--over' : ''}${selected ? ' daycard--selected' : ''}`}
    >
      <button type="button" className="daycard__head" onClick={onSelect}>
        <span className="daycard__title">Day {day + 1}</span>
        <span className="daycard__kcal">
          {kcal === undefined ? '—' : formatAmount('energy_kcal', kcal)}
          {kcalTarget === undefined ? '' : ` / ${formatAmount('energy_kcal', kcalTarget.amount)}`}
        </span>
      </button>

      {/* Carbs, fat, protein toward their goals — the ring colours, as thin bars. */}
      <div className="daycard__macros" aria-hidden="true">
        {DAY_MACROS.map((key) => {
          const target = targets.get(key);
          const amount = totals.nutrients[key];
          const fraction =
            target === undefined || amount === undefined
              ? 0
              : Math.min(1, progressFor(amount, target).fraction);
          return (
            <span key={key} className="daycard__macro">
              <span
                className="daycard__macrofill"
                style={{ width: `${fraction * 100}%`, background: macroColor(key, dark) }}
              />
            </span>
          );
        })}
      </div>

      {here.length === 0 ? (
        <p className="daycard__empty">Drop food here</p>
      ) : (
        <div className="daycard__chips">
          {here.map(({ item }) => (
            <span key={item.uid} className="placed">
              <Chip
                id={`day-${day}-${item.uid}`}
                origin={{ uid: item.uid, from: day }}
                item={item}
                count={placedOn(item, day)}
                unit={portionName(item, components)}
              />
              <span className="placed__steps">
                <button
                  type="button"
                  className="placed__step"
                  onClick={() => onAdjust(item.uid, -1)}
                  aria-label={`One less ${item.label} on day ${day + 1}`}
                >
                  −
                </button>
                <button
                  type="button"
                  className="placed__step"
                  disabled={unplaced(item) === 0}
                  onClick={() => onAdjust(item.uid, 1)}
                  aria-label={`One more ${item.label} on day ${day + 1}`}
                >
                  +
                </button>
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** A draggable piece of food: its colour, its name, how many. */
function Chip({
  id,
  origin,
  item,
  count,
  unit,
}: {
  id: string;
  origin: Origin;
  item: ScratchpadItem;
  count: number;
  unit: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data: origin });
  return (
    <span
      ref={setNodeRef}
      className={`chip${isDragging ? ' chip--dragging' : ''}`}
      {...attributes}
      {...listeners}
      aria-label={`${item.label}, ${count} ${unit}. Drag onto a day.`}
    >
      <span className="chip__dot" style={{ background: item.color }} />
      <span className="chip__label">{item.label}</span>
      <span className="chip__count">×{count}</span>
    </span>
  );
}
