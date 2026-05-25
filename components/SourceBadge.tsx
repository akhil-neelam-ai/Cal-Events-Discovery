import { SOURCE_LABELS, SOURCE_URLS } from "../appConfig";

export function SourceBadge({
  source,
  linked = true,
}: {
  source?: string;
  linked?: boolean;
}) {
  if (!source || !SOURCE_LABELS[source]) return null;

  const label = SOURCE_LABELS[source];
  const url = SOURCE_URLS[source];
  const inner = (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-400">
      <svg
        className="h-2.5 w-2.5 shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
        />
      </svg>
      {label}
    </span>
  );

  if (url && linked) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
        className="inline-flex rounded-sm px-2 py-1 -mx-2 -my-1 transition-colors hover:text-gray-600"
      >
        {inner}
      </a>
    );
  }

  return inner;
}
