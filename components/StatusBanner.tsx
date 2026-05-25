import { StatusBannerData } from "../utils/statusUi";

export function StatusBanner({
  banner,
  onDismiss,
}: {
  banner: StatusBannerData;
  onDismiss: () => void;
}) {
  const wrapperClass =
    banner.tone === "warning"
      ? "bg-yellow-50 border-b border-yellow-200 text-yellow-900 text-xs"
      : "bg-blue-50 border-b border-blue-200 text-blue-900 text-xs";

  const iconClass =
    banner.tone === "warning"
      ? "w-4 h-4 shrink-0 mt-px text-yellow-700"
      : "w-4 h-4 shrink-0 mt-px text-blue-700";

  return (
    <div className={wrapperClass}>
      <div className="container mx-auto flex items-start gap-2 px-4 py-2">
        <svg
          className={iconClass}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-2.99l-6.93-12a2 2 0 00-3.48 0l-6.93 12A2 2 0 005.07 19z"
          />
        </svg>
        <span className="flex-1">
          <strong>{banner.title}</strong> {banner.message}
        </span>
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
