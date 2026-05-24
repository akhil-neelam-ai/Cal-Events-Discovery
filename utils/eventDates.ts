import { CalEvent, SearchFilters } from "../types";

const PACIFIC_TIME_ZONE = "America/Los_Angeles";
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const PACIFIC_DATE_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const PACIFIC_SYNC_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC_TIME_ZONE,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

export type EventGroup = {
  dateKey: string;
  label: string;
  events: CalEvent[];
};

function formatDateKeyInTimeZone(date: Date): string {
  const parts = PACIFIC_DATE_PARTS_FORMATTER.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    return "";
  }

  return `${year}-${month}-${day}`;
}

function formatShortDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return dateKey;
  return `${MONTHS[month - 1]} ${day}`;
}

export function getPacificDateKey(dateString: string): string {
  if (DATE_ONLY_RE.test(dateString)) {
    return dateString;
  }

  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return formatDateKeyInTimeZone(parsed);
}

export function getCurrentPacificDateKey(now = new Date()): string {
  return formatDateKeyInTimeZone(now);
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) {
    return dateKey;
  }

  const shifted = new Date(Date.UTC(year, month - 1, day));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export function formatPacificDateTime(timestamp: number): string {
  return PACIFIC_SYNC_FORMATTER.format(new Date(timestamp));
}

export function formatRelativeSyncAge(
  timestamp: number,
  now = Date.now(),
): string {
  const diffMs = Math.max(0, now - timestamp);
  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatCardTime(time: string | undefined): string {
  if (!time || /all\s*day/i.test(time)) {
    return "All day";
  }

  const match = time.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!match) {
    return time;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3].toLowerCase();

  if (meridiem === "am" && hour === 12) {
    hour = 0;
  } else if (meridiem === "pm" && hour !== 12) {
    hour += 12;
  }

  const date = new Date(Date.UTC(2020, 0, 1, hour, minute));
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: minute === 0 ? undefined : "2-digit",
    hour12: true,
    timeZone: "UTC",
  })
    .format(date)
    .replace(":00", "")
    .toLowerCase()
    .replace(" ", "");
}

function weekdayLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) {
    return dateKey;
  }

  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
}

export function formatRelativeEventDate(
  event: Pick<CalEvent, "date" | "time">,
  now = new Date(),
): string {
  const dateKey = getPacificDateKey(event.date);
  if (!dateKey) {
    return formatEventDate(event.date);
  }

  const todayKey = getCurrentPacificDateKey(now);
  const tomorrowKey = addDaysToDateKey(todayKey, 1);
  const weekOutKey = addDaysToDateKey(todayKey, 7);
  const timeLabel = formatCardTime(event.time);

  if (dateKey === todayKey) {
    return `Today, ${timeLabel}`;
  }

  if (dateKey === tomorrowKey) {
    return `Tomorrow, ${timeLabel}`;
  }

  if (dateKey > todayKey && dateKey <= weekOutKey) {
    return `${weekdayLabel(dateKey)}, ${timeLabel}`;
  }

  const [, month, day] = dateKey.split("-").map(Number);
  if (!month || !day) {
    return `${formatEventDate(event.date)}, ${timeLabel}`;
  }

  return `${MONTHS[month - 1]} ${day}, ${timeLabel}`;
}

export function dateGroupLabel(dateKey: string): string {
  const todayKey = getCurrentPacificDateKey();
  const tomorrowKey = addDaysToDateKey(todayKey, 1);
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return dateKey;
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayName = date.toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
  const shortDate = formatShortDateKey(dateKey);
  if (dateKey === todayKey) return `Today · ${shortDate}`;
  if (dateKey === tomorrowKey) return `Tomorrow · ${shortDate}`;
  return `${dayName} · ${shortDate}`;
}

export function formatEventDate(dateString: string): string {
  const key = getPacificDateKey(dateString) || dateString.slice(0, 10);
  const [, month, day] = key.split("-").map(Number);

  if (!month || !day) {
    return dateString;
  }

  const ordinal = (value: number) => {
    if (value > 3 && value < 21) return "th";
    switch (value % 10) {
      case 1:
        return "st";
      case 2:
        return "nd";
      case 3:
        return "rd";
      default:
        return "th";
    }
  };

  return `${day}${ordinal(day)} ${MONTHS[month - 1]}`;
}

export function filterEventsByDateRange(
  events: CalEvent[],
  dateRange: SearchFilters["dateRange"],
  todayKey: string,
  nextWeekKey: string,
  tomorrowKey?: string,
): CalEvent[] {
  return events.filter((event) => {
    const eventDateKey = getPacificDateKey(event.date);
    if (!eventDateKey) {
      return false;
    }

    if (dateRange === "today") {
      return eventDateKey === todayKey;
    }

    if (dateRange === "tomorrow") {
      return eventDateKey === (tomorrowKey ?? addDaysToDateKey(todayKey, 1));
    }

    if (dateRange === "week") {
      return eventDateKey >= todayKey && eventDateKey <= nextWeekKey;
    }

    return eventDateKey >= todayKey;
  });
}

export function sortEventsChronologically(events: CalEvent[]): CalEvent[] {
  return [...events].sort((left, right) => {
    const dateCompare = (getPacificDateKey(left.date) || "").localeCompare(
      getPacificDateKey(right.date) || "",
    );
    if (dateCompare !== 0) return dateCompare;
    return (
      timeSortValue(left.time) - timeSortValue(right.time) ||
      left.title.localeCompare(right.title)
    );
  });
}

function timeSortValue(time: string | undefined): number {
  if (!time || /all\s*day/i.test(time)) {
    return 0;
  }

  const match = time.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!match) {
    return Number.MAX_SAFE_INTEGER;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3].toLowerCase();

  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) {
    return Number.MAX_SAFE_INTEGER;
  }

  if (meridiem === "am" && hour === 12) {
    hour = 0;
  } else if (meridiem === "pm" && hour !== 12) {
    hour += 12;
  }

  return hour * 60 + minute;
}

export function buildEventGroups(events: CalEvent[]): EventGroup[] {
  const groups: EventGroup[] = [];

  for (const event of sortEventsChronologically(events)) {
    const dateKey = getPacificDateKey(event.date);
    const last = groups[groups.length - 1];

    if (last && last.dateKey === dateKey) {
      last.events.push(event);
    } else {
      groups.push({ dateKey, label: dateGroupLabel(dateKey), events: [event] });
    }
  }

  return groups;
}
