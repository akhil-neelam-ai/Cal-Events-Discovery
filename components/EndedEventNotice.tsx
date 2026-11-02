export const ENDED_EVENT_NOTICE =
  "This event has ended. Here's what else is happening on campus.";

/** Shown when a shared link names an event the feed no longer lists. */
export function EndedEventNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      role="status"
      className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-xs"
    >
      <p>{ENDED_EVENT_NOTICE}</p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="-m-1 shrink-0 rounded-full p-2 text-slate-400 transition-colors hover:bg-berkeley-gold/20 hover:text-berkeley-blue focus:outline-hidden focus-visible:ring-2 focus-visible:ring-berkeley-gold/70"
      >
        <svg
          className="h-3 w-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.5}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}
