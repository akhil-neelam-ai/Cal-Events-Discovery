import { SOURCE_LABELS, SOURCE_URLS } from "../appConfig";

export function SourceBadge({
  source,
  alsoListed = [],
  linked = true,
}: {
  source?: string;
  /** Other sources that list the same event, named after the first. */
  alsoListed?: string[];
  linked?: boolean;
}) {
  if (!source || !SOURCE_LABELS[source]) return null;

  const label = [source, ...alsoListed]
    .map((name) => SOURCE_LABELS[name])
    .filter(Boolean)
    .join(", ");
  const url = SOURCE_URLS[source];

  if (url && linked) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => event.stopPropagation()}
      >
        {label}
      </a>
    );
  }

  return <span>{label}</span>;
}
