import { formatStaleDataBannerMessage } from "../utils/staleDataUi";

export function StaleDataBanner({
  dataAgeHours,
  degradedSources,
}: {
  dataAgeHours: number;
  degradedSources: string[];
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
    >
      <p className="font-medium">
        Some event sources are temporarily unavailable.
      </p>
      <p className="mt-1 text-amber-900">
        {formatStaleDataBannerMessage(dataAgeHours, degradedSources)}
      </p>
    </div>
  );
}
