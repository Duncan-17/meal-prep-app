import { PhasePlaceholder } from '@/ui/PhasePlaceholder';

export function CalendarScreen() {
  return (
    <div className="screen">
      <h1 className="screen__title">Calendar</h1>
      <p className="screen__sub">Week view, scheduled batches, what you ate.</p>
      <PhasePlaceholder
        phase={4}
        title="Calendar & scheduling"
        items={[
          'Week strip with ‹ › navigation',
          'Overview mode — one mark per meal log, colored by Component',
          'Tap-to-schedule a Component onto a day',
          'Specific mode & Day Detail arrive in Phase 7',
        ]}
      />
    </div>
  );
}
