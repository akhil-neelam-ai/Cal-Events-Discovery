import { useEffect, useState } from "react";

import {
  addDaysToDateKey,
  getCurrentPacificDateKey,
} from "../utils/eventDates";

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
    const intervalId = window.setInterval(() => {
      const today = getCurrentPacificDateKey();
      setDateKeys({
        todayKey: today,
        tomorrowKey: addDaysToDateKey(today, 1),
        nextWeekKey: addDaysToDateKey(today, 7),
      });
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, []);

  return dateKeys;
}
