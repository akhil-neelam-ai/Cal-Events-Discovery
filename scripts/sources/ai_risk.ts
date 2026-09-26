/**
 * Berkeley AI Risk speaker series adapter.
 *
 * ai-risk.berkeley.edu has no iCal/API. The schedule lives in
 * speaker-series.js as a `speakerEvents` array (speaker, talk title, abstract,
 * date, time, location). The public Google Calendar exists but every VEVENT is
 * titled "AI Risk speaker series" — too generic for discovery. We parse the JS
 * file instead.
 *
 * None of these talks appear in the central LiveWhale feed.
 */

import type { CanonicalEvent, FetchResult, Modality } from "../lib/schema.js";
import { CanonicalEventSchema } from "../lib/schema.js";
import { todayPT } from "../lib/normalize.js";
import type { FetchOptions } from "../lib/abort.js";
import { fetchWithRetry } from "../lib/fetchWithRetry.js";

export const PAGE_URL = "https://ai-risk.berkeley.edu/speaker-series.html";
export const SCRIPT_URL = "https://ai-risk.berkeley.edu/speaker-series.js";
const SOURCE_URL = "https://ai-risk.berkeley.edu/";
const FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_DURATION_MINUTES = 90;
const PT_TIME_ZONE = "America/Los_Angeles";
const PT_OFFSET_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: PT_TIME_ZONE,
  timeZoneName: "longOffset",
});
const PT_WALL_TIME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: PT_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export interface RawAiRiskTalk {
  id: number | string;
  speakerName: string;
  speakerAffiliation: string;
  speakerWebsite: string;
  talkTitle: string;
  talkAbstract: string;
  eventDate: string;
  eventTime: string;
  eventLocation: string;
  eventLink: string;
  videoUrl: string;
  slidesUrl: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function ptOffsetForInstant(instant: Date): string {
  const parts = PT_OFFSET_FORMATTER.formatToParts(instant);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  const match = tz.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  return match
    ? `${match[1]}${pad2(Number(match[2]))}:${match[3] ?? "00"}`
    : "-08:00";
}

function ptWallTimeParts(instant: Date): Record<string, string> {
  return Object.fromEntries(
    PT_WALL_TIME_FORMATTER.formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function ptOffsetFor(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): string {
  const target = {
    year: String(year),
    month: pad2(month),
    day: pad2(day),
    hour: pad2(hour),
    minute: pad2(minute),
    second: "00",
  };
  const localIso = `${target.year}-${target.month}-${target.day}T${target.hour}:${target.minute}:${target.second}`;

  for (const candidateOffset of ["-08:00", "-07:00"]) {
    const candidate = new Date(`${localIso}${candidateOffset}`);
    if (Number.isNaN(candidate.getTime())) continue;

    const parts = ptWallTimeParts(candidate);
    if (
      parts.year === target.year &&
      parts.month === target.month &&
      parts.day === target.day &&
      parts.hour === target.hour &&
      parts.minute === target.minute
    ) {
      return ptOffsetForInstant(candidate);
    }
  }

  return ptOffsetForInstant(new Date(Date.UTC(year, month - 1, day, 12, 0, 0)));
}

function skipWs(source: string, index: number): number {
  let i = index;
  while (i < source.length) {
    const ch = source[i];
    if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") {
      i++;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    break;
  }
  return i;
}

function parseJsString(
  source: string,
  index: number,
): { value: string; next: number } {
  const quote = source[index];
  if (quote !== '"' && quote !== "'") {
    throw new Error(`expected string at ${index}`);
  }
  let i = index + 1;
  let out = "";
  while (i < source.length) {
    const ch = source[i];
    if (ch === quote) {
      return { value: out, next: i + 1 };
    }
    if (ch === "\\") {
      const next = source[i + 1];
      if (next === "n") out += "\n";
      else if (next === "t") out += "\t";
      else if (next === "r") out += "\r";
      else if (next === quote || next === "\\" || next === "/") out += next;
      else out += next ?? "";
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  throw new Error("unterminated string");
}

function parseJsNumber(
  source: string,
  index: number,
): { value: number; next: number } {
  const match = source.slice(index).match(/^-?\d+(?:\.\d+)?/);
  if (!match) {
    throw new Error(`expected number at ${index}`);
  }
  return { value: Number(match[0]), next: index + match[0].length };
}

function parseJsIdent(
  source: string,
  index: number,
): { value: string; next: number } {
  const match = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
  if (!match) {
    throw new Error(`expected identifier at ${index}`);
  }
  return { value: match[0], next: index + match[0].length };
}

interface JsObject {
  [key: string]: JsValue;
}
type JsValue = string | number | boolean | null | JsObject | JsValue[];

function parseJsValue(
  source: string,
  index: number,
): { value: JsValue; next: number } {
  const i = skipWs(source, index);
  const ch = source[i];
  if (ch === '"' || ch === "'") {
    return parseJsString(source, i);
  }
  if (ch === "-" || (ch >= "0" && ch <= "9")) {
    return parseJsNumber(source, i);
  }
  if (ch === "{") {
    return parseJsObject(source, i);
  }
  if (ch === "[") {
    return parseJsArray(source, i);
  }
  if (source.startsWith("true", i)) {
    return { value: true, next: i + 4 };
  }
  if (source.startsWith("false", i)) {
    return { value: false, next: i + 5 };
  }
  if (source.startsWith("null", i)) {
    return { value: null, next: i + 4 };
  }
  throw new Error(`unexpected token at ${i}: ${source.slice(i, i + 16)}`);
}

function parseJsObject(
  source: string,
  index: number,
): { value: JsObject; next: number } {
  if (source[index] !== "{") {
    throw new Error(`expected { at ${index}`);
  }
  const obj: JsObject = {};
  let i = skipWs(source, index + 1);
  while (i < source.length) {
    if (source[i] === "}") {
      return { value: obj, next: i + 1 };
    }
    const key =
      source[i] === '"' || source[i] === "'"
        ? parseJsString(source, i)
        : parseJsIdent(source, i);
    i = skipWs(source, key.next);
    if (source[i] !== ":") {
      throw new Error(`expected : after key ${key.value}`);
    }
    const parsed = parseJsValue(source, i + 1);
    obj[key.value] = parsed.value;
    i = skipWs(source, parsed.next);
    if (source[i] === ",") {
      i = skipWs(source, i + 1);
      continue;
    }
    if (source[i] === "}") {
      return { value: obj, next: i + 1 };
    }
    throw new Error(`expected , or } at ${i}`);
  }
  throw new Error("unterminated object");
}

function parseJsArray(
  source: string,
  index: number,
): { value: JsValue[]; next: number } {
  if (source[index] !== "[") {
    throw new Error(`expected [ at ${index}`);
  }
  const items: JsValue[] = [];
  let i = skipWs(source, index + 1);
  while (i < source.length) {
    if (source[i] === "]") {
      return { value: items, next: i + 1 };
    }
    const parsed = parseJsValue(source, i);
    items.push(parsed.value);
    i = skipWs(source, parsed.next);
    if (source[i] === ",") {
      i = skipWs(source, i + 1);
      continue;
    }
    if (source[i] === "]") {
      return { value: items, next: i + 1 };
    }
    throw new Error(`expected , or ] at ${i}`);
  }
  throw new Error("unterminated array");
}

function asString(value: JsValue | undefined): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asId(value: JsValue | undefined): number | string | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

export function parseSpeakerEventsScript(source: string): RawAiRiskTalk[] {
  const match = source.match(/(?:const|let|var)\s+speakerEvents\s*=/);
  if (!match || match.index === undefined) {
    throw new Error("speakerEvents assignment not found");
  }
  const start = source.indexOf("[", match.index);
  if (start < 0) {
    throw new Error("speakerEvents array not found");
  }
  const parsed = parseJsArray(source, start);
  if (!Array.isArray(parsed.value)) {
    throw new Error("speakerEvents is not an array");
  }

  const talks: RawAiRiskTalk[] = [];
  for (const item of parsed.value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const id = asId(item.id);
    if (id === null) continue;
    talks.push({
      id,
      speakerName: asString(item.speakerName),
      speakerAffiliation: asString(item.speakerAffiliation),
      speakerWebsite: asString(item.speakerWebsite),
      talkTitle: asString(item.talkTitle),
      talkAbstract: asString(item.talkAbstract),
      eventDate: asString(item.eventDate),
      eventTime: asString(item.eventTime),
      eventLocation: asString(item.eventLocation),
      eventLink: asString(item.eventLink),
      videoUrl: asString(item.videoUrl),
      slidesUrl: asString(item.slidesUrl),
    });
  }
  return talks;
}

/** Normalize `2025-10-7` / `2025-10-07` to YYYY-MM-DD, or null if unusable. */
export function normalizeEventDate(raw: string): string | null {
  const match = raw.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function parseEventTime(
  raw: string,
): { hour: number; minute: number } | null {
  const match = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function ptDateTimeToIso(
  dateKey: string,
  hour: number,
  minute: number,
): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const offset = ptOffsetFor(year, month, day, hour, minute);
  return `${dateKey}T${pad2(hour)}:${pad2(minute)}:00${offset}`;
}

function addMinutes(
  dateKey: string,
  hour: number,
  minute: number,
  extraMinutes: number,
): { dateKey: string; hour: number; minute: number } {
  const total = hour * 60 + minute + extraMinutes;
  const dayDelta = Math.floor(total / (24 * 60));
  const remainder = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const nextHour = Math.floor(remainder / 60);
  const nextMinute = remainder % 60;
  const [year, month, day] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + dayDelta));
  const nextKey = `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
  return { dateKey: nextKey, hour: nextHour, minute: nextMinute };
}

function inferModality(location: string, eventLink: string): Modality {
  const haystack = `${location} ${eventLink}`.toLowerCase();
  const virtual = /\b(zoom|virtual|online|webinar)\b/.test(haystack);
  const inPerson =
    /\b(hall|room|plaza|auditorium|lab|building|soda|sutardja)\b/.test(
      haystack,
    );
  if (virtual && inPerson) return "hybrid";
  if (virtual) return "virtual";
  return "in_person";
}

function absoluteUrl(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  try {
    return new URL(value, SOURCE_URL).href;
  } catch {
    return undefined;
  }
}

function httpUrl(raw: string): string | undefined {
  const resolved = absoluteUrl(raw);
  if (!resolved) return undefined;
  if (!/^https?:\/\//i.test(resolved)) return undefined;
  return resolved;
}

export function talkTitleFor(talk: RawAiRiskTalk): string {
  const title = talk.talkTitle.trim();
  const speaker = talk.speakerName.trim();
  if (!title || /^tba\.?$/i.test(title)) {
    return speaker
      ? `${speaker} — Berkeley AI Risk Speaker Series`
      : "Berkeley AI Risk Speaker Series";
  }
  return title;
}

export function mapTalkToCanonical(
  talk: RawAiRiskTalk,
  fetchedAt: string,
): CanonicalEvent | null {
  const dateKey = normalizeEventDate(talk.eventDate);
  const time = parseEventTime(talk.eventTime);
  if (!dateKey || !time) return null;

  const title = talkTitleFor(talk);
  const start_at = ptDateTimeToIso(dateKey, time.hour, time.minute);
  const endParts = addMinutes(
    dateKey,
    time.hour,
    time.minute,
    DEFAULT_DURATION_MINUTES,
  );
  const end_at = ptDateTimeToIso(
    endParts.dateKey,
    endParts.hour,
    endParts.minute,
  );
  const location = talk.eventLocation.trim();
  const speakerLine = [talk.speakerName.trim(), talk.speakerAffiliation.trim()]
    .filter(Boolean)
    .join(", ");
  const extras = [
    talk.talkAbstract.trim(),
    httpUrl(talk.videoUrl) ? `Video: ${httpUrl(talk.videoUrl)}` : "",
    httpUrl(talk.slidesUrl) ? `Slides: ${httpUrl(talk.slidesUrl)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const description = [speakerLine, extras].filter(Boolean).join("\n\n");
  const eventLink = httpUrl(talk.eventLink);

  const candidate: CanonicalEvent = {
    source_name: "ai_risk",
    source_id: `${talk.id}::${dateKey}`,
    source_url: SOURCE_URL,
    evidence_url: SCRIPT_URL,
    title,
    description: description || title,
    start_at,
    end_at,
    timezone: PT_TIME_ZONE,
    all_day: false,
    venue: location || "UC Berkeley",
    building: "",
    address: "",
    modality: inferModality(location, talk.eventLink),
    organizer: "Berkeley AI Risk",
    organizer_unit: "Berkeley AI Risk",
    audience: "",
    cost: "",
    registration_url: eventLink,
    canonical_url: PAGE_URL,
    categories: ["Science & Tech"],
    tags: ["Science & Tech"],
    last_seen_at: fetchedAt,
    confidence: 0.9,
    quality_flags: [],
  };

  const validated = CanonicalEventSchema.safeParse(candidate);
  return validated.success ? validated.data : null;
}

export async function fetchAiRisk(
  options: FetchOptions = {},
): Promise<FetchResult> {
  const todayIso = todayPT();
  const fetched_at = new Date().toISOString();

  const res = await fetchWithRetry(
    SCRIPT_URL,
    {
      headers: {
        "User-Agent": "Cal-Events-Discovery-Bot",
        Accept: "text/javascript, application/javascript, text/plain, */*",
      },
    },
    {
      signal: options.signal,
      timeoutMs: FETCH_TIMEOUT_MS,
      label: "ai_risk",
    },
  );

  const source = await res.text();
  const talks = parseSpeakerEventsScript(source);

  const events: CanonicalEvent[] = [];
  let filteredPast = 0;
  let invalid = 0;

  for (const talk of talks) {
    const mapped = mapTalkToCanonical(talk, fetched_at);
    if (!mapped) {
      invalid++;
      continue;
    }
    const dateKey = normalizeEventDate(talk.eventDate);
    if (dateKey && dateKey < todayIso) {
      filteredPast++;
      continue;
    }
    events.push(mapped);
  }

  console.log(
    `[ai_risk] parsed ${events.length}/${talks.length} (past: ${filteredPast}, invalid: ${invalid})`,
  );
  return { events, rawCount: talks.length, filteredPast, invalid };
}
