import { PhasePlaceholder } from '@/ui/PhasePlaceholder';

export function LogScreen() {
  return (
    <div className="screen">
      <h1 className="screen__title">Log</h1>
      <p className="screen__sub">Record a meal from the fridge, or anything else.</p>
      <PhasePlaceholder
        phase={6}
        title="Logging"
        items={[
          'From Fridge — steppers for discrete, percent picker for bulk',
          'Quick Add — search, manual entry, saveable favorites',
          'Barcode scan (ZXing fallback on iOS)',
          'Transactional stock deduction; deleting a log restores stock',
        ]}
      />
    </div>
  );
}
