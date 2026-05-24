import { useEffect, useState } from "react";

import {
  addDaysToDateKey,
  getCurrentPacificDateKey,
} from "../utils/eventDates";

function msUntilNextPacificMidnight(now = new Date()): number {
  const todayKey = getCurrentPacificDateKey(now);
  const tomorrowKey = addDaysToDateKey(todayKey, 1);
  const [year, month, day] = tomorrowKey.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    timeZoneName: "longOffset",
  }).formatToParts(probe);
  const offset =
    parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT-08:00";
  const match = offset.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  const sign = match?.[1] === "-" ? -1 : 1;
  const hours = Number(match?.[2] ?? 8);
  const minutes = Number(match?.[3] ?? 0);
  const offsetMs = sign * (hours * 3_600_000 + minutes * 60_000);
  const midnightUtc = Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMs;
  return Math.max(0, midnightUtc - now.getTime() + 1_000);
}

export function usePacificDateKeys() {
  const [dateKeys, setDateKeys] = useState(() => {
    const today = getCurrentPacificDateKey();
    return {
      todayKey: today,
      tomorrowKey: addDaysToDateKey(today, 1),
      nextWeekKey: addDaysToDateKey(today, 7),
    };
  });

  useEffect(() => {
    let intervalId: number | undefined;
    let midnightTimeoutId: number | undefined;

    const refresh = () => {
      const today = getCurrentPacificDateKey();
      setDateKeys({
        todayKey: today,
        tomorrowKey: addDaysToDateKey(today, 1),
        nextWeekKey: addDaysToDateKey(today, 7),
      });
    };

    const scheduleMidnightRefresh = () => {
      if (midnightTimeoutId) {
        window.clearTimeout(midnightTimeoutId);
      }
      midnightTimeoutId = window.setTimeout(() => {
        refresh();
        scheduleMidnightRefresh();
      }, msUntilNextPacificMidnight());
    };

    scheduleMidnightRefresh();
    intervalId = window.setInterval(refresh, 60_000);

    return () => {
      if (intervalId) window.clearInterval(intervalId);
      if (midnightTimeoutId) window.clearTimeout(midnightTimeoutId);
    };
  }, []);

  return dateKeys;
}
