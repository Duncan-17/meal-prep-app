/**
 * One scratchpad: what is in it, over what period, and how it adds up.
 *
 * Two views of the same food (the user's design, PLAN.md §10):
 *
 * - **Average day** — everything divided evenly over the period: "if I ate
 *   this every day, what would my average day look like?"
 * - **Day by day** — the scratchpad's own run of days, with the food dragged
 *   onto the days you would eat it.
 *
 * Every change saves the whole scratchpad at once. The screen keeps the
 * latest edit in local state until the database echoes it back, so a drag
 * never flickers back to where it came from while the write lands.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';

import { AddItemSheet } from '@/features/experiment/AddItemSheet';
import { DayPlanner } from '@/features/experiment/DayPlanner';
import { periodName } from '@/features/experiment/ExperimentScreen';
import { TodaySummary } from '@/features/log/TodaySummary';
import { AllNutrients } from '@/features/experiment/AllNutrients';
import { ItemRow } from '@/features/experiment/ItemRow';
import { Stepper } from '@/ui/Stepper';
import { db } from '@/db/schema';
import { deleteScratchpad, getScratchpad, saveScratchpad } from '@/db/scratchpads';
import { listTargets } from '@/db/plan';
import { contributionsFor } from '@/domain/contributions';
import { averageDay, contributors, withDays, type CostedItem } from '@/domain/scratchpad';
import { itemTotal } from '@/nutrition/scratchpad';
import { DERIVED_TOTALS } from '@/nutrition/registry';
import { targetsByKey } from '@/nutrition/targets';
import type { Scratchpad, ScratchpadItem } from '@/domain/types';

type View = 'average' | 'days';

const PRESETS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 7, label: 'Week' },
  { days: 14, label: '2 weeks' },
  { days: 30, label: 'Month' },
];

const MAX_DAYS = 90;

export function ScratchpadScreen() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const stored = useLiveQuery(() => getScratchpad(id), [id]);
  const components = useLiveQuery(
    async () => new Map((await db.components.toArray()).map((c) => [c.id!, c] as const)),
    [],
  );
  const targets = useLiveQuery(() => listTargets(), []);

  const [draft, setDraft] = useState<Scratchpad | null>(null);
  const [view, setView] = useState<View>('average');
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Drop the local copy once the database holds the same edit.
  useEffect(() => {
    if (draft !== null && stored !== undefined && stored.updatedAt >= draft.updatedAt) {
      setDraft(null);
    }
  }, [stored, draft]);

  const pad = draft ?? stored;

  const costed: CostedItem[] = useMemo(
    () =>
      pad === undefined || components === undefined
        ? []
        : pad.items.map((item) => ({ item, total: itemTotal(item, components) })),
    [pad, components],
  );

  if (stored === undefined || components === undefined || targets === undefined) {
    return <div className="screen">Loading…</div>;
  }
  if (pad === undefined) {
    return (
      <div className="screen">
        <p className="screen__sub">That scratchpad no longer exists.</p>
        <Link to="/experiment">Back to Experiment</Link>
      </div>
    );
  }

  const byKey = targetsByKey(targets);

  function change(next: Scratchpad) {
    const stamped = { ...next, updatedAt: Date.now() };
    setDraft(stamped);
    void saveScratchpad(stamped);
  }

  function changeItem(uid: string, update: (item: ScratchpadItem) => ScratchpadItem) {
    change({ ...pad!, items: pad!.items.map((item) => (item.uid === uid ? update(item) : item)) });
  }

  const average = averageDay(costed, pad.days);
  const averageSegments = (key: string) =>
    contributionsFor(contributors(costed, pad.days), key, DERIVED_TOTALS);

  return (
    <div className="screen">
      <Link className="linkbtn backlink" to="/experiment">
        ‹ Experiment
      </Link>

      <input
        className="padname"
        defaultValue={pad.name}
        key={pad.id}
        aria-label="Scratchpad name"
        onBlur={(event) => {
          const name = event.target.value.trim();
          if (name !== '' && name !== pad.name) change({ ...pad, name });
        }}
      />

      <section className="section">
        <h2 className="section__title">Period</h2>
        <div className="period">
          <div className="segmented segmented--sm">
            {PRESETS.map((preset) => (
              <button
                key={preset.days}
                type="button"
                className={`segmented__option${pad.days === preset.days ? ' segmented__option--on' : ''}`}
                onClick={() => change(withDays(pad, preset.days))}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <Stepper
            value={pad.days}
            min={1}
            max={MAX_DAYS}
            onChange={(days) => change(withDays(pad, days))}
            label="Days in the period"
          />
          <span className="period__label">days</span>
        </div>
      </section>

      <section className="section">
        <div className="screen__head">
          <h2 className="section__title">In this scratchpad</h2>
          <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
            + Add food or recipe
          </button>
        </div>
        {pad.items.length === 0 ? (
          <p className="screen__sub">Nothing yet.</p>
        ) : (
          <ul className="paditems">
            {costed.map(({ item, total }) => (
              <ItemRow
                key={item.uid}
                item={item}
                total={total}
                components={components}
                onChange={(update) => changeItem(item.uid, update)}
                onRemove={() =>
                  change({ ...pad, items: pad.items.filter((other) => other.uid !== item.uid) })
                }
              />
            ))}
          </ul>
        )}
      </section>

      {pad.items.length > 0 && (
        <>
          <div className="segmented segmented--full" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'average'}
              className={`segmented__option${view === 'average' ? ' segmented__option--on' : ''}`}
              onClick={() => setView('average')}
            >
              Average day
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'days'}
              className={`segmented__option${view === 'days' ? ' segmented__option--on' : ''}`}
              onClick={() => setView('days')}
            >
              Day by day
            </button>
          </div>

          {view === 'average' ? (
            <>
              <p className="screen__sub">
                Everything here, spread evenly over {periodName(pad.days)}.
              </p>
              <TodaySummary totals={average} targets={byKey} segmentsFor={averageSegments} />
              <AllNutrients totals={average} targets={byKey} segmentsFor={averageSegments} />
            </>
          ) : (
            <DayPlanner
              pad={pad}
              costed={costed}
              components={components}
              targets={byKey}
              onChange={change}
            />
          )}
        </>
      )}

      <hr className="rule" />
      {confirmDelete ? (
        <div className="builder__actions">
          <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
            Keep
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() =>
              void deleteScratchpad(pad.id!).then(() => navigate('/experiment', { replace: true }))
            }
          >
            Really delete
          </button>
        </div>
      ) : (
        <button type="button" className="linkbtn" onClick={() => setConfirmDelete(true)}>
          Delete this scratchpad
        </button>
      )}

      <AddItemSheet
        open={adding}
        onClose={() => setAdding(false)}
        onAdd={(item) => change({ ...pad, items: [...pad.items, item] })}
      />
    </div>
  );
}
