import { PhasePlaceholder } from '@/ui/PhasePlaceholder';

export function ComponentLibraryScreen() {
  return (
    <div className="screen">
      <h1 className="screen__title">Components</h1>
      <p className="screen__sub">Reusable batch-cookable items.</p>
      <PhasePlaceholder
        phase={3}
        title="Component Builder & Library"
        items={[
          'Card list with color dot, category, yield',
          'Builder — ingredients, discrete/bulk toggle, live nutrition',
          'Color picker with distinctness warning',
          'Needs Phase 2 food lookup first',
        ]}
      />
    </div>
  );
}
