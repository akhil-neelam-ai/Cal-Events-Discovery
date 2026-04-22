import { SOURCE_LABELS } from "../appConfig";
import { IngestionStatus } from "../types";

export type StatusBannerData = {
  tone: "warning" | "info";
  title: string;
  message: string;
};

export function formatStatusSources(status: IngestionStatus): string {
  const failed = status.sources
    .filter((source) => !source.ok)
    .map((source) => SOURCE_LABELS[source.name] || source.name);
  if (failed.length === 0) {
    return "";
  }

  if (failed.length === 1) {
    return failed[0];
  }

  if (failed.length === 2) {
    return `${failed[0]} and ${failed[1]}`;
  }

  return `${failed.slice(0, 2).join(", ")} and ${failed.length - 2} more`;
}

export function formatNamedSources(names: string[] | undefined): string {
  if (!names || names.length === 0) {
    return "";
  }

  const labels = names.map((name) => SOURCE_LABELS[name] || name);
  if (labels.length === 1) {
    return labels[0];
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  return `${labels.slice(0, 2).join(", ")} and ${labels.length - 2} more`;
}

export function buildStatusBanner(
  statusReport: IngestionStatus | null,
): StatusBannerData | null {
  if (!statusReport) {
    return null;
  }

  const failedSources = statusReport.sources.filter((source) => !source.ok);
  const failedLabel = formatStatusSources(statusReport);
  const fallbackLabel = formatNamedSources(statusReport.fallback_sources);
  const degradedLabel = formatNamedSources(statusReport.degraded_sources);

  if (
    statusReport.degraded ||
    statusReport.fallback_used ||
    statusReport.last_good_used > 0
  ) {
    return {
      tone: "warning",
      title: statusReport.fallback_used
        ? "Showing mostly fresh data."
        : "Showing partial data.",
      message: statusReport.fallback_used
        ? fallbackLabel
          ? `The latest update reused cached events for ${fallbackLabel}.`
          : failedLabel
            ? `The latest update had source issues (${failedLabel}) and reused cached events for part of the feed.`
            : "The latest update reused cached events for part of the feed."
        : degradedLabel
          ? `${degradedLabel} did not return a healthy result in the latest run.`
          : statusReport.degraded_reason ||
            "One or more sources did not return a healthy result in the latest run.",
    };
  }

  if (failedSources.length > 0) {
    return {
      tone: "info",
      title: "Some sources were unavailable.",
      message: failedLabel
        ? `The current dataset loaded successfully, but ${failedLabel} did not return data in the latest run.`
        : "The current dataset loaded successfully, but one or more sources did not return data in the latest run.",
    };
  }

  return null;
}
