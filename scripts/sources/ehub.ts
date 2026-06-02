/**
 * E-Hub HTML scraper — secondary source.
 *
 * ehub.berkeley.edu doesn't publish a feed, so we scrape the events page
 * with cheerio. Cards expose title, description, registration link, and
 * a date string (e.g., "Feb 12") that we coerce to YYYY-MM-DD.
 */

import * as cheerio from "cheerio";
import type { FetchOptions } from "../lib/abort.js";
import { fetchWithRetry } from "../lib/fetchWithRetry.js";
import type { CanonicalEvent, FetchResult } from "../lib/schema.js";
import { CanonicalEventSchema } from "../lib/schema.js";
import { todayPT } from "../lib/normalize.js";

const EHUB_URL = "https://ehub.berkeley.edu/events/";
const FETCH_TIMEOUT_MS = 30_000;
const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

export function inferEhubDate(
  dateText: string,
  todayIso = todayPT(),
): string | null {
  const match = dateText.trim().match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2})$/);
  if (!match) return null;

  const [, monthName, dayRaw] = match;
  const month = MONTHS[monthName.toLowerCase()];
  if (!month) return null;

  const day = String(Number(dayRaw)).padStart(2, "0");
  const todayYear = Number(todayIso.slice(0, 4));
  const todayMonth = Number(todayIso.slice(5, 7));
  const eventMonth = Number(month);
  let candidate = `${todayYear}-${month}-${day}`;

  const daysPast =
    (Date.parse(`${todayIso}T00:00:00Z`) -
      Date.parse(`${candidate}T00:00:00Z`)) /
    86_400_000;

  if (
    candidate < todayIso &&
    ((todayMonth >= 11 && eventMonth <= 2) || daysPast > 180)
  ) {
    candidate = `${todayYear + 1}-${month}-${day}`;
  }

  return candidate;
}

export async function fetchEHub(
  options: FetchOptions = {},
): Promise<FetchResult> {
  const events: CanonicalEvent[] = [];
  let rawCount = 0;
  let filteredPast = 0;
  let invalid = 0;

  const response = await fetchWithRetry(
    EHUB_URL,
    {
      headers: { "User-Agent": "Cal-Events-Discovery-Bot" },
    },
    {
      signal: options.signal,
      timeoutMs: FETCH_TIMEOUT_MS,
      label: "ehub",
    },
  );

  const html = await response.text();
  const $ = cheerio.load(html);
  const todayIso = todayPT();
  const fetched_at = new Date().toISOString();

  $(".wfea-card-item").each((index, element) => {
    rawCount++;
    try {
      const $card = $(element);
      const title = $card.find(".eaw-content-block h3").first().text().trim();
      if (!title) {
        invalid++;
        return;
      }

      const description =
        $card.find(".eaw-content-block p").first().text().trim() || title;
      const registrationLink =
        $card.find(".eaw-booknow").attr("href") || EHUB_URL;
      const cardText = $card.text();

      const dateMatch = cardText.match(
        /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}/i,
      );
      if (!dateMatch) {
        invalid++;
        return;
      }
      const dateStr = inferEhubDate(dateMatch[0], todayIso);
      if (!dateStr) {
        invalid++;
        return;
      }

      if (dateStr < todayIso) {
        filteredPast++;
        return;
      }

      const candidate: CanonicalEvent = {
        source_name: "ehub",
        source_id: `${dateStr.replace(/-/g, "")}_${index + 1}`,
        source_url: EHUB_URL,
        evidence_url: registrationLink,
        title,
        description,
        start_at: dateStr,
        end_at: undefined,
        timezone: "America/Los_Angeles",
        all_day: true,
        venue: "Berkeley E-Hub",
        building: "",
        address: "",
        modality: "in_person",
        organizer: "Berkeley E-Hub",
        organizer_unit: "Berkeley E-Hub",
        audience: "",
        cost: "",
        registration_url: registrationLink,
        canonical_url: registrationLink,
        categories: ["Entrepreneurship"],
        tags: ["Entrepreneurship"],
        last_seen_at: fetched_at,
        confidence: 0.85,
        quality_flags: ["date_year_inferred"],
      };

      const validated = CanonicalEventSchema.safeParse(candidate);
      if (!validated.success) {
        invalid++;
        return;
      }
      events.push(validated.data);
    } catch {
      invalid++;
    }
  });

  console.log(
    `[ehub] parsed ${events.length}/${rawCount} (past: ${filteredPast}, invalid: ${invalid})`,
  );
  return { events, rawCount, filteredPast, invalid };
}
