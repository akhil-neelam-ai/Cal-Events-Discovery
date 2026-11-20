export function ErrorStateView({
  onRetry,
}: {
  onRetry: () => void | Promise<void>;
}) {
  return (
    <div className="sheet-plain beside">
      <h3>Failed to load events</h3>
      <p>We couldn&apos;t load the latest Berkeley event feed.</p>
      <p>Check your connection and try again.</p>
      <div className="sheet-actions">
        <button
          type="button"
          onClick={() => {
            void onRetry();
          }}
          className="btn-toner"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
