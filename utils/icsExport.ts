import { CalEvent } from "../types";
import { addDaysToDateKey, isContiguousRun } from "./eventDates";

const PT_TIME_ZONE = "America/Los_Angeles";

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function formatIcsUtc(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

interface TimeWindow {
  allDay: boolean;
  startLocal: string;
  endLocal: string;
}

/** Compute the iCal DTSTART/DTEND for a single occurrence on `dateKey`. */
function timeWindow(time: string, dateKey: string): TimeWindow {
  const compactDate = dateKey.replace(/-/g, "");

  if (/all\s*day/i.test(time)) {
    const endDate = new Date(`${dateKey}T00:00:00Z`);
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    return {
      allDay: true,
      startLocal: compactDate,
      endLocal: endDate.toISOString().slice(0, 10).replace(/-/g, ""),
    };
  }

  const match = time.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!match) {
    return {
      allDay: false,
      startLocal: `${compactDate}T120000`,
      endLocal: `${compactDate}T130000`,
    };
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3].toLowerCase();
  if (meridiem === "am" && hour === 12) hour = 0;
  if (meridiem === "pm" && hour !== 12) hour += 12;

  let endHour = hour + 1;
  let endDateCompact = compactDate;
  if (endHour >= 24) {
    endHour -= 24;
    endDateCompact = addDaysToDateKey(dateKey, 1).replace(/-/g, "");
  }
  const pad = (value: number) => String(value).padStart(2, "0");

  return {
    allDay: false,
    startLocal: `${compactDate}T${pad(hour)}${pad(minute)}00`,
    endLocal: `${endDateCompact}T${pad(endHour)}${pad(minute)}00`,
  };
}

/** Build a single VEVENT block (array of lines). */
function veventLines(
  uid: string,
  window: TimeWindow,
  event: CalEvent,
): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${formatIcsUtc(new Date())}`,
  ];

  if (window.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${window.startLocal}`);
    lines.push(`DTEND;VALUE=DATE:${window.endLocal}`);
  } else {
    lines.push(`DTSTART;TZID=${PT_TIME_ZONE}:${window.startLocal}`);
    lines.push(`DTEND;TZID=${PT_TIME_ZONE}:${window.endLocal}`);
  }

  lines.push(`SUMMARY:${escapeIcsText(event.title)}`);
  lines.push(`DESCRIPTION:${escapeIcsText(event.description || event.title)}`);
  if (event.location) {
    lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  }
  if (event.url) {
    lines.push(`URL:${event.url}`);
  }
  lines.push("END:VEVENT");
  return lines;
}

/**
 * VEVENT blocks for an event. Multi-day events (set by collapseMultiDay):
 *   - a continuous all-day run becomes one spanning all-day VEVENT;
 *   - a gappy/recurring run becomes one VEVENT per occurrence date, so the
 *     calendar shows exactly the days it happens (no phantom gap days).
 */
function buildVevents(event: CalEvent): string[] {
  const dates = event.dates && event.dates.length > 1 ? event.dates : null;

  if (dates) {
    const allDay = /all\s*day/i.test(event.time);

    if (allDay && isContiguousRun(dates)) {
      const start = dates[0].replace(/-/g, "");
      const endExclusive = addDaysToDateKey(dates[dates.length - 1], 1).replace(
        /-/g,
        "",
      );
      return veventLines(
        `${event.id}@cal-events.com`,
        { allDay: true, startLocal: start, endLocal: endExclusive },
        event,
      );
    }

    // Gappy run (or timed recurrence): one VEVENT per occurrence.
    return dates.flatMap((dateKey) =>
      veventLines(
        `${event.id}-${dateKey}@cal-events.com`,
        timeWindow(event.time, dateKey),
        event,
      ),
    );
  }

  return veventLines(
    `${event.id}@cal-events.com`,
    timeWindow(event.time, event.date.slice(0, 10)),
    event,
  );
}

export function buildEventIcs(event: CalEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Cal Events Discovery//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...buildVevents(event),
    "END:VCALENDAR",
  ];
  return `${lines.join("\r\n")}\r\n`;
}

export function downloadEventIcs(event: CalEvent): void {
  const blob = new Blob([buildEventIcs(event)], {
    type: "text/calendar;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `event-${event.id.replace(/[^\w.-]+/g, "_")}.ics`;
  anchor.click();
  URL.revokeObjectURL(url);
}
