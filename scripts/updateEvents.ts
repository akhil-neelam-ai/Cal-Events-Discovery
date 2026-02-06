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

    GOAL: Find a diverse list of 50-70 upcoming events spanning:
    - Academic seminars & lectures
    - Arts, music, and performances
    - Sports and recreation
    - Student life and club socials
    - Science & Technology events
    - Entrepreneurship & startup events (from E-Hub, SCET, Skydeck)

    PRIORITY SOURCES (scan these first):
    ${prioritySources}

    SEARCH EXPANSION:
    Beyond the priority sources, also search for events from:
    - UC Berkeley student organizations and clubs
    - Campus recreation and intramural sports
    - Library events and workshops
    - Graduate division events

    IMPORTANT - Include entrepreneurship events from:
    - Berkeley E-Hub (ehub.berkeley.edu/events/) - startup workshops, founder talks, networking
    - SCET (scet.berkeley.edu/events/) - entrepreneurship seminars
    These should be tagged as "Science & Tech" or "Student Life"

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
        "tags": ["Category - use: Academic, Arts, Sports, Science & Tech, or Student Life"]
      }
    ]
  `;

  console.log("Fetching events from Gemini API...");

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      }
    });

    const text = response.text || "";
    let events: CalEvent[] = [];

    // Debug logging
    console.log("\n=== GEMINI RESPONSE DEBUG ===");
    console.log("Response text length:", text.length);
    console.log("First 500 chars:", text.substring(0, 500));
    console.log("Has candidates:", !!response.candidates);
    console.log("Candidates length:", response.candidates?.length || 0);
    console.log("=============================\n");

    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');

    if (firstBracket !== -1 && lastBracket !== -1) {
      try {
        events = JSON.parse(text.substring(firstBracket, lastBracket + 1));
      } catch (e) {
        console.error("JSON Parse Error:", e);
        console.error("Attempted to parse:", text.substring(firstBracket, lastBracket + 1));
        process.exit(1);
      }
    } else {
      console.warn("No JSON array found in response");
    }

    // Filter out events with non-ISO date formats (e.g. "Ongoing (through May 29, 2026)")
    const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
    const validEvents = events.filter(event => {
      if (!isoDateRegex.test(event.date)) {
        console.warn(`Skipping event "${event.title}" — invalid date format: "${event.date}"`);
        return false;
      }
      return true;
    });
    events = validEvents;

    // Verify URLs — replace broken ones with the best known fallback for that domain
    console.log("Verifying event URLs...");
    const fallbackMap = buildFallbackMap(prioritySourceUrls);
    events = await verifyEventUrls(events, fallbackMap);

    // Extract sources: try groundingChunks first (older models), then content parts (Gemini 2.5+)
    const sources: GroundingSource[] = [];
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    chunks.forEach((chunk: any) => {
      if (chunk.web?.uri) {
        sources.push({
          title: chunk.web.title || chunk.web.uri,
          uri: chunk.web.uri
        });
      }
    });

    if (sources.length === 0) {
      // Gemini 2.5+ returns search results as content parts instead of groundingChunks
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

    const uniqueSources = Array.from(new Map(sources.map(s => [s.uri, s])).values());

    const outputData = {
      events,
      sources: uniqueSources,
      lastUpdated: Date.now()
    };

    // Write to public/events.json
    const outputPath = path.join(__dirname, "..", "public", "events.json");
    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));

    console.log(`Success! Updated ${events.length} events.`);
    console.log(`Sources: ${uniqueSources.length}`);
    console.log(`Output: ${outputPath}`);

  } catch (error) {
    console.error("Gemini API Error:", error);
    process.exit(1);
  }
}

updateEvents();
