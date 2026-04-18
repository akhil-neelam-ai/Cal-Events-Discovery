/**
 * Script to update events.json with fresh data from Gemini API.
 * Run this periodically (e.g., via cron job) to keep events up-to-date.
 *
 * Usage: npx tsx scripts/updateEvents.ts
 */

import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CalEvent {
  id: string;
  title: string;
  organizer: string;
  date: string;
  time: string;
  location: string;
  description: string;
  tags: string[];
  url: string;
}

interface GroundingSource {
  title: string;
  uri: string;
}

const URL_TIMEOUT_MS = 10_000;
const CONCURRENCY = 10;
const GEMINI_MAX_ATTEMPTS = 3;
const GEMINI_BACKOFF_MS = [2_000, 8_000, 30_000];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractJsonArray(text: string): CalEvent[] | null {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  const firstBracket = stripped.indexOf('[');
  const lastBracket = stripped.lastIndexOf(']');
  if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
    return null;
  }

  const candidate = stripped.substring(firstBracket, lastBracket + 1);
  try {
    const parsed = JSON.parse(candidate);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    // Trailing malformed object — retry by truncating to the last complete "}"
    const lastBrace = candidate.lastIndexOf('}');
    if (lastBrace === -1) return null;
    try {
      const repaired = candidate.substring(0, lastBrace + 1) + ']';
      const parsed = JSON.parse(repaired);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function loadLastGoodEvents(outputPath: string): {
  events: CalEvent[];
  sources: GroundingSource[];
} {
  try {
    const raw = fs.readFileSync(outputPath, 'utf-8');
    const data = JSON.parse(raw);
    const todayIso = new Date().toISOString().split('T')[0];
    const futureEvents = (data.events || []).filter(
      (e: CalEvent) => e.date >= todayIso
    );
    return { events: futureEvents, sources: data.sources || [] };
  } catch {
    return { events: [], sources: [] };
  }
}

function buildFallbackMap(urls: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const url of urls) {
    try {
      const host = new URL(url).hostname;
      if (!map.has(host)) map.set(host, url);
    } catch {}
  }
  return map;
}

async function checkUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(URL_TIMEOUT_MS),
      headers: { 'User-Agent': 'Cal-Events-Discovery-Bot' },
      redirect: 'follow',
    });
    if (res.ok) return true;
    // Some servers reject HEAD; retry with GET
    const getRes = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(URL_TIMEOUT_MS),
      headers: { 'User-Agent': 'Cal-Events-Discovery-Bot' },
      redirect: 'follow',
    });
    return getRes.ok;
  } catch {
    return false;
  }
}

async function verifyEventUrls(
  events: CalEvent[],
  fallbackMap: Map<string, string>
): Promise<CalEvent[]> {
  const DEFAULT_FALLBACK = 'https://events.berkeley.edu/';
  const results = new Array<CalEvent>(events.length);
  let index = 0;
  let verified = 0;
  let replaced = 0;

  async function worker() {
    while (true) {
      const i = index++;
      if (i >= events.length) return;
      const event = events[i];
      const ok = await checkUrl(event.url);
      if (ok) {
        results[i] = event;
        verified++;
      } else {
        let fallback = DEFAULT_FALLBACK;
        try {
          const host = new URL(event.url).hostname;
          fallback = fallbackMap.get(host) || DEFAULT_FALLBACK;
        } catch {}
        console.warn(`  [REPLACED] "${event.title}" — ${event.url} → ${fallback}`);
        results[i] = { ...event, url: fallback };
        replaced++;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, events.length) }, () => worker()));
  console.log(`URL verification: ${verified} ok, ${replaced} replaced`);
  return results;
}

async function fetchEHubEvents(): Promise<CalEvent[]> {
  const EHUB_URL = 'https://ehub.berkeley.edu/events/';
  const events: CalEvent[] = [];

  try {
    console.log('Fetching E-Hub events from', EHUB_URL);
    const response = await fetch(EHUB_URL);
    if (!response.ok) {
      console.warn(`E-Hub fetch failed: ${response.status}`);
      return events;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    $('.wfea-card-item').each((index, element) => {
      try {
        const $card = $(element);

        // Extract title
        const title = $card.find('.eaw-content-block h3').first().text().trim();
        if (!title) return;

        // Extract description
        const description = $card.find('.eaw-content-block p').first().text().trim() || title;

        // Extract registration link
        const registrationLink = $card.find('.eaw-booknow').attr('href') || EHUB_URL;

        // Extract date text (e.g., "Feb 12" or similar)
        // E-Hub dates are often in the card but format varies, look for common patterns
        let dateStr = '';
        const cardText = $card.text();

        // Try to find date patterns like "Feb 12", "February 12", "2/12", etc.
        const dateMatch = cardText.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}/i);
        if (dateMatch) {
          const currentYear = new Date().getFullYear();
          const parsedDate = new Date(`${dateMatch[0]}, ${currentYear}`);
          if (!isNaN(parsedDate.getTime())) {
            dateStr = parsedDate.toISOString().split('T')[0];
          }
        }

        // Skip if we couldn't extract a valid date
        if (!dateStr) {
          console.warn(`Skipping E-Hub event "${title}" - could not extract date`);
          return;
        }

        // Skip past events — E-Hub sometimes lists yesterday's events in today's HTML
        const todayIso = new Date().toISOString().split('T')[0];
        if (dateStr < todayIso) {
          return;
        }

        // Generate unique ID
        const id = `EHUB_${dateStr.replace(/-/g, '')}_${String(index + 1).padStart(3, '0')}`;

        events.push({
          id,
          title,
          organizer: 'Berkeley E-Hub',
          date: dateStr,
          time: 'See event page',
          location: 'Berkeley E-Hub',
          description,
          url: registrationLink,
          tags: ['Entrepreneurship']
        });
      } catch (err) {
        console.warn('Error parsing E-Hub event:', err);
      }
    });

    console.log(`Found ${events.length} E-Hub events`);
  } catch (error) {
    console.error('E-Hub scraper error:', error);
  }

  return events;
}

async function updateEvents() {
  const apiKey = process.env.API_KEY;

  if (!apiKey) {
    console.error("Error: API_KEY environment variable is required");
    console.error("Usage: API_KEY=your_key npx tsx scripts/updateEvents.ts");
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });

  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  // Priority sources organized by category
  const prioritySourceUrls = [
    // Main Campus Hubs
    "https://events.berkeley.edu/",
    "https://calperformances.org/events/",
    "https://calbears.com/calendar",
    "https://ehub.berkeley.edu/events/",

    // Schools & Colleges
    "https://events.berkeley.edu/chem/",
    "https://cdss.berkeley.edu/news-events/events-calendar",
    "https://events.berkeley.edu/coe/",
    "https://www.ischool.berkeley.edu/events",
    "https://www.law.berkeley.edu/events/",
    "https://publichealth.berkeley.edu/events/",
    "https://gspp.berkeley.edu/events",

    // Research Centers & Tech Institutes
    "https://rdi.berkeley.edu/events",
    "https://haas.berkeley.edu/energy-institute/events/",
    "https://bids.berkeley.edu/events",
    "https://citris-uc.org/events/",
    "https://cltc.berkeley.edu/events/",
    "https://simons.berkeley.edu/events",
    "https://scet.berkeley.edu/events/",
    "https://innovativegenomics.org/events/",
    "https://blumcenter.berkeley.edu/events/",
    "https://www.ssl.berkeley.edu/events/",
    "https://its.berkeley.edu/events",

    // Arts, Culture & Public Venues
    "https://bampfa.org/calendar",
    "https://www.lawrencehallofscience.org/events/",
    "https://botanicalgarden.berkeley.edu/events"
  ];
  const prioritySources = prioritySourceUrls.join("\n");

  const prompt = `
    You are the Daily Event Curator for UC Berkeley.
    Task: Generate the DAILY BATCH of upcoming events.
    Current Date: ${currentDate}

    GOAL: Find a diverse list of 50-70 upcoming events spanning ALL categories below.
    You MUST include events from EVERY category:

    REQUIRED CATEGORIES (include events from ALL of these):
    1. Academic seminars & lectures (at least 10 events)
    2. Arts, music, and performances (at least 8 events)
    3. Sports and recreation - Cal Bears games, intramurals (at least 8 events)
    4. Student life and club socials (at least 8 events)
    5. Science & Technology events - CS, AI, data science, engineering (at least 8 events)
    6. Entrepreneurship & startup events (at least 8 events)

    PRIORITY SOURCES (scan these first):
    ${prioritySources}

    ADDITIONAL SEARCHES REQUIRED:
    - Search "Cal Bears basketball schedule 2026" for sports events
    - Search "UC Berkeley computer science events" for tech events
    - Search "Berkeley data science seminars" for science events
    - Search "UC Berkeley student organizations events" for student life
    - Search "Berkeley campus recreation intramural sports"
    - Search for events from libraries, graduate division, research centers

    CRITICAL LOCATION REQUIREMENT:
    - ONLY include events happening ON UC Berkeley campus OR in Berkeley, CA
    - ONLY include events organized by UC Berkeley departments, schools, or student organizations
    - DO NOT include events in San Francisco, Oakland, Silicon Valley, or other Bay Area cities
    - DO NOT include events organized by non-Berkeley entities (e.g., Smart Cities Council, external organizations)
    - Location must contain "Berkeley", "UC Berkeley", "Cal", or specific campus building names
    - If an event is outside Berkeley city, EXCLUDE IT even if it mentions Berkeley

    IMPORTANT GUIDELINES:
    - ONLY include actual public events (lectures, performances, games, workshops, meetings)
    - DO NOT include administrative deadlines, document preparation periods, application windows, or decision dates
    - Events must have a specific date/time when people can attend
    - DO NOT include ongoing/multi-week exhibitions or open-ended events. Each event must have a single specific start date.
    - The "date" field MUST be in YYYY-MM-DD format (e.g. "2026-02-05"). Never use words like "Ongoing" or date ranges.
    - For Cal Athletics events, use: https://calbears.com/sports/2021/2/23/cal-golden-bears-tickets.aspx
    - Verify events are real by checking the source URLs

    DATA FORMAT:
    Return ONLY a valid JSON array. No markdown, no explanation.
    [
      {
        "id": "unique_id",
        "title": "Event Title",
        "organizer": "Department/Group",
        "date": "YYYY-MM-DD",
        "time": "Start Time",
        "location": "Venue",
        "description": "Short summary (1-2 sentences)",
        "url": "Direct link to event page",
        "tags": ["Category - use: Academic, Arts, Sports, Science & Tech, Student Life, or Entrepreneurship"]
      }
    ]
  `;

  const outputPath = path.join(__dirname, "..", "public", "events.json");

  console.log("Fetching events from Gemini API...");

  let response: any = null;
  let geminiFailureReason = "";
  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt++) {
    try {
      response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          temperature: 0.3,
          topP: 0.95,
        }
      });
      break;
    } catch (error: any) {
      const status = error?.status ?? error?.response?.status;
      geminiFailureReason = `status=${status ?? 'unknown'} message=${error?.message ?? error}`;
      console.warn(`Gemini attempt ${attempt}/${GEMINI_MAX_ATTEMPTS} failed: ${geminiFailureReason}`);
      if (attempt < GEMINI_MAX_ATTEMPTS) {
        const wait = GEMINI_BACKOFF_MS[attempt - 1];
        console.log(`Retrying in ${wait}ms...`);
        await sleep(wait);
      }
    }
  }

  let events: CalEvent[] = [];
  let geminiSucceeded = false;
  const uniqueSourcesFromGemini: GroundingSource[] = [];

  if (response) {
    const text = response.text || "";
    console.log("\n=== GEMINI RESPONSE DEBUG ===");
    console.log("Response text length:", text.length);
    console.log("First 500 chars:", text.substring(0, 500));
    console.log("Has candidates:", !!response.candidates);
    console.log("Candidates length:", response.candidates?.length || 0);
    console.log("=============================\n");

    const parsed = extractJsonArray(text);
    if (parsed) {
      events = parsed;
      geminiSucceeded = true;
    } else {
      geminiFailureReason = "failed to extract JSON array from response";
      console.warn(geminiFailureReason);
    }
  }

  if (!geminiSucceeded) {
    console.warn(`\n⚠️  Gemini step failed (${geminiFailureReason}). Falling back to last-good events.json + E-Hub scraper.`);
    const lastGood = loadLastGoodEvents(outputPath);
    events = lastGood.events;
    uniqueSourcesFromGemini.push(...lastGood.sources);
    console.log(`Loaded ${events.length} future events from last-good events.json`);
  }

  // Filter out events with non-ISO date formats (e.g. "Ongoing (through May 29, 2026)")
  const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
  events = events.filter(event => {
    if (!isoDateRegex.test(event.date)) {
      console.warn(`Skipping event "${event.title}" — invalid date format: "${event.date}"`);
      return false;
    }
    return true;
  });

  // Verify URLs — replace broken ones with the best known fallback for that domain
  console.log("Verifying event URLs...");
  const fallbackMap = buildFallbackMap(prioritySourceUrls);
  events = await verifyEventUrls(events, fallbackMap);

  // Extract grounding sources only when Gemini succeeded; otherwise reuse last-good sources
  const sources: GroundingSource[] = [...uniqueSourcesFromGemini];
  if (geminiSucceeded && response) {
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    chunks.forEach((chunk: any) => {
      if (chunk.web?.uri) {
        sources.push({ title: chunk.web.title || chunk.web.uri, uri: chunk.web.uri });
      }
    });

    if (sources.length === 0) {
      const parts = response.candidates?.[0]?.content?.parts || [];
      parts.forEach((part: any) => {
        if (part.googleSearchResult?.result) {
          part.googleSearchResult.result.forEach((result: any) => {
            if (result.url) {
              sources.push({ title: result.title || result.url, uri: result.url });
            }
          });
        }
      });
    }
  }

  const uniqueSources = Array.from(new Map(sources.map(s => [s.uri, s])).values());

  // Fetch E-Hub events separately via HTML scraping
  const ehubEvents = await fetchEHubEvents();

  // Deduplicate events by title and date (prefer scraper events over Gemini events)
  const eventMap = new Map<string, CalEvent>();
  events.forEach(event => {
    const key = `${event.title.toLowerCase().trim()}_${event.date}`;
    eventMap.set(key, event);
  });
  ehubEvents.forEach(event => {
    const key = `${event.title.toLowerCase().trim()}_${event.date}`;
    eventMap.set(key, event);
  });

  const allEvents = Array.from(eventMap.values());
  const duplicatesRemoved = (events.length + ehubEvents.length) - allEvents.length;
  if (duplicatesRemoved > 0) {
    console.log(`Removed ${duplicatesRemoved} duplicate events`);
  }

  if (ehubEvents.length > 0) {
    uniqueSources.push({
      title: 'Berkeley E-Hub Events',
      uri: 'https://ehub.berkeley.edu/events/'
    });
  }

  // Safety: never overwrite a healthy events.json with an empty file.
  // If both sources produced 0 events, keep the old file and exit non-zero
  // so the workflow surfaces the problem rather than silently deploying nothing.
  if (allEvents.length === 0) {
    console.error("Aborting: both Gemini and E-Hub returned 0 events. Keeping existing events.json unchanged.");
    process.exit(1);
  }

  const outputData = {
    events: allEvents,
    sources: uniqueSources,
    lastUpdated: Date.now()
  };

  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));

  console.log(`\nSuccess! Wrote ${allEvents.length} events (${geminiSucceeded ? 'Gemini live' : 'Gemini fallback from last-good'} + ${ehubEvents.length} from E-Hub).`);
  console.log(`Sources: ${uniqueSources.length}`);
  console.log(`Output: ${outputPath}`);

  if (!geminiSucceeded) {
    console.warn("⚠️  Ran in fallback mode. Check Gemini API quota / key.");
  }
}

updateEvents();
