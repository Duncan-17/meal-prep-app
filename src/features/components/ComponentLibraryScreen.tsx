import { useState } from 'react';

import { PhasePlaceholder } from '@/ui/PhasePlaceholder';
import { FoodSearch } from '@/features/foods/FoodSearch';
import { ProxyStatus } from '@/features/foods/ProxyStatus';
import { formatAmount, nutrientName } from '@/nutrition/registry';
import type { AdaptedFood } from '@/domain/types';

export function ComponentLibraryScreen() {
  // Phase 2 has no Component to attach a food to yet — Phase 3 builds that.
  // Until then, selecting a food shows what was actually stored, which is the
  // honest way to prove the lookup and the registry mapping work.
  const [selected, setSelected] = useState<AdaptedFood | null>(null);

  return (
    <div className="screen">
      <h1 className="screen__title">Components</h1>
      <p className="screen__sub">Reusable batch-cookable items.</p>

      <section className="section">
        <h2 className="section__title">Food lookup</h2>
        <ProxyStatus />
        <FoodSearch onSelect={setSelected} />
        {selected !== null && <SelectedFood food={selected} onClear={() => setSelected(null)} />}
      </section>

      <PhasePlaceholder
        phase={3}
        title="Component Builder & Library"
        items={[
          'Card list with color dot, category, yield',
          'Builder — ingredients, discrete/bulk toggle, live nutrition',
          'Color picker with distinctness warning',
          'Food lookup above is Phase 2 and already works',
        ]}
      />
    </div>
  );
}

/** Everything the registry recognised, so a bad mapping is visible immediately. */
function SelectedFood({ food, onClear }: { food: AdaptedFood; onClear: () => void }) {
  const entries = Object.entries(food.nutritionPer100g).sort(([a], [b]) =>
    nutrientName(a).localeCompare(nutrientName(b)),
  );

  return (
    <div className="selected">
      <div className="selected__head">
        <p className="selected__name">{food.name}</p>
        <button type="button" className="linkbtn" onClick={onClear}>
          Clear
        </button>
      </div>

      <p className="selected__meta">
        {food.source} · {food.dataType ?? 'manual'} · {entries.length} nutrients mapped
      </p>

      {food.portionGrams !== undefined && (
        <p className="selected__meta">
          Portions:{' '}
          {Object.entries(food.portionGrams)
            .map(([label, grams]) => `1 ${label} = ${grams.toFixed(0)} g`)
            .join(' · ')}
        </p>
      )}

      {entries.length === 0 ? (
        <p className="selected__meta">No nutrients mapped — check the registry mapping.</p>
      ) : (
        <ul className="nutrients">
          {entries.map(([key, value]) => (
            <li key={key} className="nutrients__row">
              <span>{nutrientName(key)}</span>
              <span className="nutrients__value">{formatAmount(key, value)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
