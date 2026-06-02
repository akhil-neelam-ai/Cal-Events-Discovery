import { formatStaleDataBannerMessage } from "../utils/staleDataUi";

export function StaleDataBanner({
  dataAgeHours,
  degradedSources,
  onDismiss,
}: {
  dataAgeHours: number;
  degradedSources: string[];
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
    >
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <p className="font-medium">
            Some event sources are temporarily unavailable.
          </p>
          <p className="mt-1 text-amber-900">
            {formatStaleDataBannerMessage(dataAgeHours, degradedSources)}
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="ml-2 shrink-0 text-current opacity-60 transition-opacity hover:opacity-100"
        >
          ×
        </button>
      </div>
    </div>
  );
}
