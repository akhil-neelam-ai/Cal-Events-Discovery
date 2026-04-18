/**
 * E-Hub HTML scraper — secondary source.
 *
 * ehub.berkeley.edu doesn't publish a feed, so we scrape the events page
 * with cheerio. Cards expose title, description, registration link, and
 * a date string (e.g., "Feb 12") that we coerce to YYYY-MM-DD.
 */

import * as cheerio from 'cheerio';
import type { CanonicalEvent } from '../lib/schema.js';
import { CanonicalEventSchema } from '../lib/schema.js';

const EHUB_URL = 'https://ehub.berkeley.edu/events/';
const FETCH_TIMEOUT_MS = 30_000;

export interface FetchResult {
  events: CanonicalEvent[];
  rawCount: number;
  filteredPast: number;
  invalid: number;
}

function todayPT(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function fetchEHub(): Promise<FetchResult> {
  console.log(`[ehub] fetching ${EHUB_URL}`);
  const events: CanonicalEvent[] = [];
  let rawCount = 0;
  let filteredPast = 0;
  let invalid = 0;

  const response = await fetch(EHUB_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'User-Agent': 'Cal-Events-Discovery-Bot' },
  });
  if (!response.ok) {
    throw new Error(`E-Hub fetch failed: ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const todayIso = todayPT();
  const fetched_at = new Date().toISOString();

  $('.wfea-card-item').each((index, element) => {
    rawCount++;
    try {
      const $card = $(element);
      const title = $card.find('.eaw-content-block h3').first().text().trim();
      if (!title) {
        invalid++;
        return;
      }

      const description = $card.find('.eaw-content-block p').first().text().trim() || title;
      const registrationLink = $card.find('.eaw-booknow').attr('href') || EHUB_URL;
      const cardText = $card.text();

      const dateMatch = cardText.match(
        /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}/i
      );
      if (!dateMatch) {
        invalid++;
        return;
      }
      const currentYear = new Date().getFullYear();
      const parsedDate = new Date(`${dateMatch[0]}, ${currentYear}`);
      if (isNaN(parsedDate.getTime())) {
        invalid++;
        return;
      }
      const dateStr = parsedDate.toISOString().split('T')[0];

      if (dateStr < todayIso) {
        filteredPast++;
        return;
      }

      const candidate: CanonicalEvent = {
        source_name: 'ehub',
        source_id: `${dateStr.replace(/-/g, '')}_${index + 1}`,
        source_url: EHUB_URL,
        evidence_url: registrationLink,
        title,
        description,
        start_at: dateStr,
        end_at: undefined,
        timezone: 'America/Los_Angeles',
        all_day: true,
        venue: 'Berkeley E-Hub',
        building: '',
        address: '',
        modality: 'in_person',
        organizer: 'Berkeley E-Hub',
        organizer_unit: 'Berkeley E-Hub',
        audience: '',
        cost: '',
        registration_url: registrationLink,
        canonical_url: registrationLink,
        categories: ['Entrepreneurship'],
        tags: ['Entrepreneurship'],
        last_seen_at: fetched_at,
        confidence: 0.85,
        quality_flags: ['date_year_inferred'],
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

  console.log(`[ehub] parsed ${events.length}/${rawCount} (past: ${filteredPast}, invalid: ${invalid})`);
  return { events, rawCount, filteredPast, invalid };
}
