export function ErrorStateView({
  onRetry,
}: {
  onRetry: () => void | Promise<void>;
}) {
  return (
    <div className="text-center py-10 bg-red-50 rounded-xl border border-red-200 max-w-lg mx-auto">
      <h3 className="text-xl text-red-800 font-bold mb-2">
        Failed to Load Events
      </h3>
      <p className="text-red-600 mb-2">
        We couldn&apos;t load the latest Berkeley event feed.
      </p>
      <p className="text-red-600 text-sm mb-4">
        Check your connection and try again.
      </p>
      <button
        onClick={() => {
          void onRetry();
        }}
        className="px-6 py-2 bg-red-700 hover:bg-red-800 text-white rounded-lg font-bold transition shadow-md"
      >
        Retry
      </button>
    </div>
  );
}
