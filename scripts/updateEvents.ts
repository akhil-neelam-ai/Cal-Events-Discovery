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

  const prioritySources = [
    "https://events.berkeley.edu/",
    "https://cdss.berkeley.edu/news-events/events-calendar",
    "https://botanicalgarden.berkeley.edu/events-page/event-calendar/",
    "https://anthropology.berkeley.edu/news-events/events-calendar",
    "https://ce3.berkeley.edu/events",
    "https://research-it.berkeley.edu/events-trainings/upcoming-events-trainings"
  ].join("\n");

  const prompt = `
    You are the Daily Event Curator for UC Berkeley.
    Task: Generate the DAILY BATCH of upcoming events.
    Current Date: ${currentDate}

    GOAL: Find a diverse list of exactly 40-50 upcoming events spanning:
    - Academic seminars & lectures
    - Arts, music, and performances
    - Sports and recreation
    - Career fairs and workshops
    - Student life and club socials
    - Science & Technology events

    SEARCH STRATEGY:
    1. Scan priority sources: ${prioritySources}
    2. Broaden search to include Berkeley department news, UC Berkeley News events, and CalPerformances.

    DATA FORMAT:
    Return ONLY a valid JSON array.
    [
      {
        "id": "unique_id",
        "title": "Event Title",
        "organizer": "Department/Group",
        "date": "YYYY-MM-DD",
        "time": "Start Time",
        "location": "Venue",
        "description": "Short summary",
        "url": "Link",
        "tags": ["Category - Academic, Arts, Sports, Science & Tech, Career, or Student Life"]
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

    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');

    if (firstBracket !== -1 && lastBracket !== -1) {
      try {
        events = JSON.parse(text.substring(firstBracket, lastBracket + 1));
      } catch (e) {
        console.error("JSON Parse Error:", e);
        process.exit(1);
      }
    }

    // Extract Grounding Metadata
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
