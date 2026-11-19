import type { InterpretedChip } from "../utils/searchEngine";

/**
 * The chip row under the view heading. "Interpreted as" names what the
 * search words set. "Only from" names a source that came without words,
 * from a shared link or an agent, since the page has no source control.
 */
export function InterpretedChips({
  chips,
  onDismiss,
  sourceLabel = null,
  onClearSource,
}: {
  chips: InterpretedChip[];
  onDismiss: (key: string) => void;
  sourceLabel?: string | null;
  onClearSource?: () => void;
}) {
  if (chips.length === 0 && !sourceLabel) {
    return null;
  }

  return (
    <div
      className="chips beside"
      aria-live="polite"
      aria-label="Active filters"
    >
      {chips.length > 0 && (
        <>
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
        </>
      )}
      {sourceLabel && (
        <>
          <span className="wall-label">Only from</span>
          <span className="chip">
            {sourceLabel}
            <button
              type="button"
              aria-label={`Remove ${sourceLabel} source filter`}
              onClick={onClearSource}
            >
              <span aria-hidden="true">×</span>
            </button>
          </span>
        </>
      )}
    </div>
  );
}
