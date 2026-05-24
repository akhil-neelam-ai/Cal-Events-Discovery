import { SOURCE_LABELS } from "../appConfig";

export function formatStaleDataBannerMessage(
  dataAgeHours: number,
  degradedSources: string[],
): string {
  const roundedAge = Math.max(1, Math.round(dataAgeHours));
  const labels = degradedSources.map(
    (source) => SOURCE_LABELS[source] || source,
  );

  if (labels.length === 0) {
    return `Showing events from about ${roundedAge}h ago while sources recover.`;
  }

  if (labels.length === 1) {
    return `Showing events from ${roundedAge}h ago — ${labels[0]} temporarily unavailable.`;
  }

  if (labels.length === 2) {
    return `Showing events from ${roundedAge}h ago — ${labels[0]} and ${labels[1]} temporarily unavailable.`;
  }

  return `Showing events from ${roundedAge}h ago — ${labels.slice(0, 2).join(", ")} and ${labels.length - 2} more temporarily unavailable.`;
}

export function shouldShowStaleDataBanner(
  dataAgeHours: number | undefined,
  degradedSources: string[] | undefined,
): boolean {
  const age = typeof dataAgeHours === "number" ? dataAgeHours : 0;
  const sources = degradedSources ?? [];
  return age > 12 || sources.length > 0;
}
