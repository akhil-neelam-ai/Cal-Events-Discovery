import { CalEvent } from "../types";

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

function parseWallClock(event: CalEvent): {
  allDay: boolean;
  startLocal: string;
  endLocal: string;
} {
  const dateKey = event.date.slice(0, 10);
  const compactDate = dateKey.replace(/-/g, "");

  if (/all\s*day/i.test(event.time)) {
    const endDate = new Date(`${dateKey}T00:00:00Z`);
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    return {
      allDay: true,
      startLocal: compactDate,
      endLocal: endDate.toISOString().slice(0, 10).replace(/-/g, ""),
    };
  }

  const match = event.time.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
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

  const endHour = hour + 1;
  const pad = (value: number) => String(value).padStart(2, "0");

  return {
    allDay: false,
    startLocal: `${compactDate}T${pad(hour)}${pad(minute)}00`,
    endLocal: `${compactDate}T${pad(endHour)}${pad(minute)}00`,
  };
}

export function buildEventIcs(event: CalEvent): string {
  const uid = `${event.id}@cal-events.com`;
  const { allDay, startLocal, endLocal } = parseWallClock(event);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Cal Events Discovery//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${formatIcsUtc(new Date())}`,
  ];

  if (allDay) {
    lines.push(`DTSTART;VALUE=DATE:${startLocal}`);
    lines.push(`DTEND;VALUE=DATE:${endLocal}`);
  } else {
    lines.push(`DTSTART;TZID=${PT_TIME_ZONE}:${startLocal}`);
    lines.push(`DTEND;TZID=${PT_TIME_ZONE}:${endLocal}`);
  }

  lines.push(`SUMMARY:${escapeIcsText(event.title)}`);
  lines.push(`DESCRIPTION:${escapeIcsText(event.description || event.title)}`);
  if (event.location) {
    lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  }
  if (event.url) {
    lines.push(`URL:${event.url}`);
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
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
