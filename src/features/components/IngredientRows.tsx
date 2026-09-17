/**
 * The ingredient list inside the builder, reorderable by drag.
 *
 * `dnd-kit` is used here and nowhere else in v1 (PLAN.md §1.5). Dragging is
 * bound to an explicit handle rather than the whole row, because the row is
 * full of number inputs and a drag-anywhere row makes them miserable to edit
 * on a phone.
 */

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { resolveToGrams, unitOptionsFor } from '@/nutrition/units';
import type { GramConfidence } from '@/domain/types';
import type { DraftIngredient } from '@/features/components/draft';

interface Props {
  items: DraftIngredient[];
  onChange: (items: DraftIngredient[]) => void;
}

export function IngredientRows({ items, onChange }: Props) {
  const sensors = useSensors(
    // A small distance threshold means a tap still registers as a tap.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    const from = items.findIndex((item) => item.uid === active.id);
    const to = items.findIndex((item) => item.uid === over.id);
    if (from === -1 || to === -1) return;
    onChange(arrayMove(items, from, to));
  }

  function update(uid: string, patch: Partial<DraftIngredient>) {
    onChange(items.map((item) => (item.uid === uid ? { ...item, ...patch } : item)));
  }

  function remove(uid: string) {
    onChange(items.filter((item) => item.uid !== uid));
  }

  if (items.length === 0) {
    return <p className="ingredients__empty">No ingredients yet. Search below to add one.</p>;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((item) => item.uid)} strategy={verticalListSortingStrategy}>
        <ul className="ingredients">
          {items.map((item) => (
            <IngredientRow key={item.uid} item={item} onUpdate={update} onRemove={remove} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

interface RowProps {
  item: DraftIngredient;
  onUpdate: (uid: string, patch: Partial<DraftIngredient>) => void;
  onRemove: (uid: string) => void;
}

function IngredientRow({ item, onUpdate, onRemove }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.uid,
  });

  const resolved = resolveToGrams(item.quantity, item.unit, item.food);

  return (
    <li
      ref={setNodeRef}
      className={`ingredient${isDragging ? ' ingredient--dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition: transition ?? undefined }}
    >
      <button
        type="button"
        className="ingredient__handle"
        aria-label={`Reorder ${item.food.name}`}
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>

      <div className="ingredient__body">
        <span className="ingredient__name">{item.food.name}</span>

        <div className="ingredient__controls">
          <input
            className="field__input ingredient__qty"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={item.quantity}
            onChange={(event) => onUpdate(item.uid, { quantity: Number(event.target.value) })}
            aria-label={`Quantity of ${item.food.name}`}
          />

          <select
            className="field__input ingredient__unit"
            value={item.unit}
            onChange={(event) => onUpdate(item.uid, { unit: event.target.value })}
            aria-label={`Unit for ${item.food.name}`}
          >
            {unitOptions(item).map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>

          <span className={`grams grams--${resolved.confidence}`}>
            {resolved.confidence === 'unknown'
              ? 'weight unknown'
              : `${Math.round(resolved.grams)} g`}
          </span>

          <button
            type="button"
            className="ingredient__remove"
            onClick={() => onRemove(item.uid)}
            aria-label={`Remove ${item.food.name}`}
          >
            ✕
          </button>
        </div>

        <ConfidenceNote confidence={resolved.confidence} unit={item.unit} />
      </div>
    </li>
  );
}

/**
 * Only says something when the number is a guess. An exact mass conversion
 * needs no commentary; a density estimate does.
 */
function ConfidenceNote({ confidence, unit }: { confidence: GramConfidence; unit: string }) {
  if (confidence === 'exact' || confidence === 'portion' || confidence === 'user') return null;

  if (confidence === 'unknown') {
    return (
      <p className="ingredient__note ingredient__note--warn">
        No gram weight known for “{unit}”. Switch to a weight unit, or this ingredient contributes
        nothing.
      </p>
    );
  }

  return (
    <p className="ingredient__note">
      {confidence === 'assumed'
        ? 'Weight assumed from water density — approximate.'
        : 'Weight estimated from density — approximate.'}
    </p>
  );
}

/**
 * The food's own portions first, then the generic units.
 *
 * Its own measurements have real gram weights behind them; the generic list
 * may need a density guess, so it should not be what the eye lands on first.
 */
function unitOptions(item: DraftIngredient): string[] {
  const options = unitOptionsFor(item.food);
  return options.includes(item.unit) ? options : [...options, item.unit];
}
