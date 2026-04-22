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
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        Interpreted as
      </span>
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(253,181,21,0.4)] bg-[rgba(253,181,21,0.08)] px-3 py-1 text-xs font-semibold text-berkeley-blue"
        >
          {chip.label}
          <button
            type="button"
            aria-label={`Remove ${chip.label} filter`}
            onClick={() => onDismiss(chip.key)}
            className="-m-1 ml-0.5 rounded-full p-2 text-slate-400 transition-colors hover:bg-berkeley-gold/20 hover:text-berkeley-blue"
          >
            <svg
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </span>
      ))}
    </div>
  );
}
