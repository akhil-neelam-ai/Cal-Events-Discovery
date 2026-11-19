import type { InterpretedChip } from "../utils/searchEngine";

export function InterpretedChips({
  chips,
  onDismiss,
}: {
  chips: InterpretedChip[];
  onDismiss: (key: string) => void;
}) {
  if (chips.length === 0) {
    return null;
  }

  return (
    <div
      className="chips beside"
      aria-live="polite"
      aria-label="Search interpretations"
    >
      <span className="wall-label">Interpreted as</span>
      {chips.map((chip) => (
        <span key={chip.key} className="chip">
          {chip.label}
          <button
            type="button"
            aria-label={`Remove ${chip.label} filter`}
            onClick={() => onDismiss(chip.key)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </span>
      ))}
    </div>
  );
}
