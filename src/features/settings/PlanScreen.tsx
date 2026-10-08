/**
 * The plan: weight goal and every nutrient target, daily and weekly.
 *
 * Starts as the FDA template and stays that way until touched. An untouched
 * target is labelled "FDA default" so a number you never chose never looks
 * like a number you did.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';

import { TargetRow } from '@/features/settings/TargetRow';
import { WeightPlan } from '@/features/settings/WeightPlan';
import { PinnedNutrients } from '@/features/settings/PinnedNutrients';
import { BackupSection } from '@/features/settings/BackupSection';
import { SyncSection } from '@/features/settings/SyncSection';
import { listTargets, planCustomisation, resetAllTargets } from '@/db/plan';
import {
  NUTRIENTS,
  NUTRIENT_GROUP_LABELS,
  NUTRIENT_GROUP_ORDER,
  getNutrient,
} from '@/nutrition/registry';
import { PLAN_PRIORITY_KEYS } from '@/nutrition/targets';
import type { NutrientGroup } from '@/nutrition/registry';
import type { NutrientTarget } from '@/domain/plan';

export function PlanScreen() {
  const targets = useLiveQuery(() => listTargets(), []);
  const stats = useLiveQuery(() => planCustomisation(), [targets]);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const byKey = new Map((targets ?? []).map((target) => [target.key, target]));

  const headline = PLAN_PRIORITY_KEYS.map((key) => byKey.get(key)).filter(
    (target): target is NutrientTarget => target !== undefined,
  );

  return (
    <div className="screen">
      <div className="screen__head">
        <div>
          <h1 className="screen__title">Plan</h1>
          <p className="screen__sub">Your goals, daily and weekly.</p>
        </div>
        <Link className="linkbtn" to="/log">
          Done
        </Link>
      </div>

      <WeightPlan />

      <section className="section">
        <h2 className="section__title">The big numbers</h2>
        {targets === undefined ? (
          <p className="screen__sub">Loading…</p>
        ) : (
          headline.map((target) => <TargetRow key={target.key} target={target} />)
        )}
      </section>

      <section className="section">
        <div className="screen__head">
          <h2 className="section__title">Micronutrients</h2>
          <button type="button" className="linkbtn" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show targets only' : 'Show all nutrients'}
          </button>
        </div>

        <p className="screen__sub">
          Every one starts at the FDA Daily Value. Edit any of them and it stops being a default.
        </p>

        {NUTRIENT_GROUP_ORDER.map((group) => (
          <NutrientGroupSection key={group} group={group} byKey={byKey} showAll={showAll} />
        ))}
      </section>

      <PinnedNutrients />

      <SyncSection />
      <BackupSection />

      <section className="section">
        <h2 className="section__title">Start over</h2>
        {stats !== undefined && (
          <p className="screen__sub">
            {stats.edited === 0
              ? `All ${stats.total} targets are still FDA defaults.`
              : `${stats.edited} of ${stats.total} targets are your own.`}
          </p>
        )}

        {confirmingReset ? (
          <div className="builder__actions">
            <button type="button" className="btn" onClick={() => setConfirmingReset(false)}>
              Keep my plan
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                void resetAllTargets();
                setConfirmingReset(false);
              }}
            >
              Reset every target to FDA defaults
            </button>
          </div>
        ) : (
          <button type="button" className="btn" onClick={() => setConfirmingReset(true)}>
            Reset to FDA defaults
          </button>
        )}
      </section>
    </div>
  );
}

function NutrientGroupSection({
  group,
  byKey,
  showAll,
}: {
  group: NutrientGroup;
  byKey: Map<string, NutrientTarget>;
  showAll: boolean;
}) {
  const headlineKeys = new Set(PLAN_PRIORITY_KEYS);

  const definitions = NUTRIENTS.filter((definition) => definition.group === group).filter(
    (definition) => {
      if (headlineKeys.has(definition.key)) return false; // shown above
      return showAll || byKey.has(definition.key);
    },
  );

  if (definitions.length === 0) return null;

  return (
    <div className="plangroup">
      <h3 className="plangroup__title">{NUTRIENT_GROUP_LABELS[group]}</h3>
      {definitions.map((definition) => (
        <TargetRow
          key={definition.key}
          target={byKey.get(definition.key)}
          nutrientKey={definition.key}
          unit={getNutrient(definition.key)?.unit}
        />
      ))}
    </div>
  );
}
