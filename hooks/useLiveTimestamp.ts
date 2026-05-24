import { useEffect, useState } from "react";

import { formatRelativeSyncAge } from "../utils/eventDates";

export function useLiveTimestamp(timestamp: number | null): string | null {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!timestamp) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setTick((value) => value + 1);
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, [timestamp]);

  if (!timestamp) {
    return null;
  }

  return formatRelativeSyncAge(timestamp);
}

export function useLivePacificDateTime(
  timestamp: number | null,
): string | null {
  const relativeAge = useLiveTimestamp(timestamp);
  if (!timestamp || !relativeAge) {
    return null;
  }

  return relativeAge === "just now" ? "just now" : relativeAge;
}

export function useSyncStatusCopy(timestamp: number | null): string | null {
  const relativeAge = useLiveTimestamp(timestamp);
  if (!timestamp || !relativeAge) {
    return null;
  }

  return relativeAge === "just now"
    ? "Synced just now"
    : `Synced ${relativeAge}`;
}

export function useUpdatedStatusCopy(timestamp: number | null): string | null {
  const relativeAge = useLiveTimestamp(timestamp);
  if (!timestamp || !relativeAge) {
    return null;
  }

  return relativeAge === "just now"
    ? "Updated just now"
    : `Updated ${relativeAge}`;
}
