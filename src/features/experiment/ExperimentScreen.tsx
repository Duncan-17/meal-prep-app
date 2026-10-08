/**
 * The Experiment tab: every saved scratchpad.
 *
 * Each one is a draft of a period's food — what you might buy and cook — kept
 * so it can be reused in later weeks, much like a shopping list (PLAN.md §10).
 */

import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';

import { createScratchpad, listScratchpads } from '@/db/scratchpads';
import type { Scratchpad } from '@/domain/types';

export function ExperimentScreen() {
  const pads = useLiveQuery(() => listScratchpads(), []);
  const navigate = useNavigate();

  async function create() {
    const id = await createScratchpad(`Scratchpad ${(pads?.length ?? 0) + 1}`);
    navigate(`/experiment/${id}`);
  }

  return (
    <div className="screen">
      <div className="screen__head screen__head--gap">
        <h1 className="screen__title">Experiment</h1>
        <button type="button" className="btn btn--primary" onClick={() => void create()}>
          + New scratchpad
        </button>
      </div>

      {pads === undefined ? (
        <p className="screen__sub">Loading…</p>
      ) : pads.length === 0 ? (
        <div className="placeholder">
          <p style={{ margin: 0, fontWeight: 600 }}>No scratchpads yet</p>
        </div>
      ) : (
        <ul className="cards">
          {pads.map((pad) => (
            <li key={pad.id}>
              <Link className="card" to={`/experiment/${pad.id}`}>
                <span className="card__body">
                  <span className="card__name">{pad.name}</span>
                  <span className="card__meta">{describe(pad)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function describe(pad: Scratchpad): string {
  const items = pad.items.length;
  return `${items} item${items === 1 ? '' : 's'} · ${periodName(pad.days)}`;
}

export function periodName(days: number): string {
  if (days === 7) return 'a week';
  if (days === 14) return 'two weeks';
  if (days === 30) return 'a month';
  return `${days} day${days === 1 ? '' : 's'}`;
}
