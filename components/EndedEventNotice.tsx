export const ENDED_EVENT_NOTICE =
  "This event has ended. Here's what else is happening on campus.";

/** Shown when a shared link names an event the feed no longer lists. */
export function EndedEventNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div role="status" className="note beside">
      <p>{ENDED_EVENT_NOTICE}</p>
      <button type="button" aria-label="Dismiss" onClick={onDismiss}>
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
