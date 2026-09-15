/**
 * Colour picker with a distinctness warning.
 *
 * Twelve suggested swatches plus a free hex field (PLAN.md §1.1). The warning
 * is deliberately **non-blocking** — it names the Component you would clash
 * with and then gets out of the way. Free choice was the locked decision; this
 * only makes the consequence visible.
 */

import { useId } from 'react';

import {
  SUGGESTED_SWATCHES,
  findSimilarColor,
  isValidHex,
  normalizeHex,
  readableTextColor,
} from '@/domain/color';

interface Props {
  value: string;
  onChange: (hex: string) => void;
  /** Other Components, for the clash check. */
  existing: ReadonlyArray<{ name: string; color: string }>;
}

export function ColorPicker({ value, onChange, existing }: Props) {
  const inputId = useId();
  const normalized = normalizeHex(value);
  const clash = normalized === null ? null : findSimilarColor(normalized, existing);

  return (
    <div className="colorpicker">
      <span className="field__label">Colour</span>

      <div className="colorpicker__swatches">
        {SUGGESTED_SWATCHES.map((swatch) => {
          const selected = normalized === swatch;
          return (
            <button
              key={swatch}
              type="button"
              className={`swatch${selected ? ' swatch--on' : ''}`}
              style={{ background: swatch, color: readableTextColor(swatch) }}
              onClick={() => onChange(swatch)}
              aria-label={`Use colour ${swatch}`}
              aria-pressed={selected}
            >
              {selected ? '✓' : ''}
            </button>
          );
        })}
      </div>

      <div className="colorpicker__custom">
        <label className="colorpicker__native" htmlFor={inputId}>
          <input
            id={inputId}
            type="color"
            value={normalized ?? '#000000'}
            onChange={(event) => onChange(event.target.value)}
          />
          <span>Custom</span>
        </label>

        <input
          className="field__input colorpicker__hex"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label="Hex colour"
          spellCheck={false}
        />
      </div>

      {!isValidHex(value) && <p className="colorpicker__note">Not a valid hex colour.</p>}

      {clash !== null && (
        <p className="colorpicker__note">
          <span
            className="colorpicker__dot"
            style={{ background: clash.color }}
            aria-hidden="true"
          />
          Similar to <strong>{clash.name}</strong> — they may be hard to tell apart on the calendar.
          You can still use it.
        </p>
      )}
    </div>
  );
}
