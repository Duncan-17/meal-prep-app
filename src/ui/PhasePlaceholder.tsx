/**
 * Scaffolding for Phase 0 only. Each placeholder is deleted when its phase
 * lands — if you can still see one, that screen is not built yet.
 */
type Props = { phase: number; title: string; items: string[] };

export function PhasePlaceholder({ phase, title, items }: Props) {
  return (
    <div className="placeholder">
      <span className="placeholder__badge">Phase {phase}</span>
      <p style={{ margin: '0 0 10px', fontWeight: 600 }}>{title}</p>
      <ul className="placeholder__list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
