import { PhasePlaceholder } from '@/ui/PhasePlaceholder';

export function FridgeScreen() {
  return (
    <div className="screen">
      <h1 className="screen__title">Fridge</h1>
      <p className="screen__sub">What's cooked and still available.</p>
      <PhasePlaceholder
        phase={5}
        title="Cook → Fridge"
        items={[
          'Mark cooked, with actual-yield confirmation',
          'Discrete: 4 of 6 servings left',
          'Bulk: progress bar, 62% left ≈1.9kg',
          'Adjust and Discard remaining',
        ]}
      />
    </div>
  );
}
