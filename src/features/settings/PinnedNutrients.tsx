/**
 * Which nutrients get a meter, and in what order.
 *
 * These are the ones that appear on the Log screen and drive the weekly trend
 * chart. The chart draws at most four lines, so the order is not cosmetic —
 * the first four are the ones you will actually see plotted.
 */

import { useLiveQuery } from 'dexie-react-hooks';

import { db } from '@/db/schema';
import { DEFAULT_PINNED_NUTRIENTS, NUTRIENTS, nutrientName } from '@/nutrition/registry';
import { MAX_SERIES } from '@/ui/vizPalette';

const MAX_PINNED = 12;

export function PinnedNutrients() {
  const settings = useLiveQuery(() => db.settings.get('settings'), []);

  const pinned =
    settings?.pinnedNutrients !== undefined && settings.pinnedNutrients.length > 0
      ? settings.pinnedNutrients
      : [...DEFAULT_PINNED_NUTRIENTS];

  async function save(next: string[]) {
    const current = await db.settings.get('settings');
    await db.settings.put({
      id: 'settings',
      pinnedNutrients: next,
      ...(current?.offContact === undefined ? {} : { offContact: current.offContact }),
      ...(current?.lastBackupAt === undefined ? {} : { lastBackupAt: current.lastBackupAt }),
    });
  }

  function move(index: number, delta: number) {
    const next = [...pinned];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [moved] = next.splice(index, 1);
    if (moved !== undefined) next.splice(target, 0, moved);
    void save(next);
  }

  return (
    <section className="section">
      <h2 className="section__title">Pinned nutrients</h2>
      <p className="screen__sub">
        Shown as meters on the Diary screen. The first {MAX_SERIES} are the lines on the weekly
        chart — order matters.
      </p>

      <ol className="pinned">
        {pinned.map((key, index) => (
          <li key={key} className="pinned__row">
            <span className={`pinned__rank${index < MAX_SERIES ? ' pinned__rank--charted' : ''}`}>
              {index + 1}
            </span>
            <span className="pinned__name">{nutrientName(key)}</span>
            <button
              type="button"
              className="pinned__move"
              onClick={() => move(index, -1)}
              disabled={index === 0}
              aria-label={`Move ${nutrientName(key)} up`}
            >
              ↑
            </button>
            <button
              type="button"
              className="pinned__move"
              onClick={() => move(index, 1)}
              disabled={index === pinned.length - 1}
              aria-label={`Move ${nutrientName(key)} down`}
            >
              ↓
            </button>
            <button
              type="button"
              className="ingredient__remove"
              onClick={() => void save(pinned.filter((entry) => entry !== key))}
              aria-label={`Unpin ${nutrientName(key)}`}
            >
              ✕
            </button>
          </li>
        ))}
      </ol>

      {pinned.length < MAX_PINNED && (
        <label className="field">
          <span className="field__label">Pin another</span>
          <select
            className="field__input"
            value=""
            onChange={(event) => {
              if (event.target.value === '') return;
              void save([...pinned, event.target.value]);
            }}
          >
            <option value="">Choose a nutrient…</option>
            {NUTRIENTS.filter((definition) => !pinned.includes(definition.key)).map(
              (definition) => (
                <option key={definition.key} value={definition.key}>
                  {definition.name}
                </option>
              ),
            )}
          </select>
        </label>
      )}

      <button
        type="button"
        className="btn"
        onClick={() => void save([...DEFAULT_PINNED_NUTRIENTS])}
      >
        Reset to the default ten
      </button>
    </section>
  );
}
