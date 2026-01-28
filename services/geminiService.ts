
import { GoogleGenAI } from "@google/genai";
import { CalEvent, SearchFilters, SearchResponse, GroundingSource } from "../types";

// Initialize Gemini Client
const apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
const ai = new GoogleGenAI({ apiKey });

const CACHE_KEY = 'cal_events_daily_cache';

/**
 * Checks if the cache is stale based on a 2 AM PST daily threshold.
 */
const isCacheStale = (timestamp: number): boolean => {
  // Get current time in California
  const now = new Date();
  const pstStr = now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
  const pstNow = new Date(pstStr);

  // Determine the start of the current "daily period" (today's 2 AM PST)
  const today2AM = new Date(pstNow);
  today2AM.setHours(2, 0, 0, 0);

  // Determine the start of the previous "daily period" (yesterday's 2 AM PST)
  const yesterday2AM = new Date(today2AM);
  yesterday2AM.setDate(yesterday2AM.getDate() - 1);

  // If currently before 2 AM, the "current period" started at yesterday's 2 AM.
  // If currently after 2 AM, the "current period" started at today's 2 AM.
  const currentPeriodStart = pstNow < today2AM ? yesterday2AM : today2AM;

  // Cache is stale if it was created before the most recent 2 AM PST
  return timestamp < currentPeriodStart.getTime();
};

export const fetchEventsFromGemini = async (forceRefresh: boolean = false): Promise<SearchResponse & { lastUpdated: number }> => {
  if (!apiKey) throw new Error("API Key is missing");

  // Check Cache first
  if (!forceRefresh) {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (!isCacheStale(parsed.timestamp)) {
        return { ...parsed.data, lastUpdated: parsed.timestamp };
      }
    }
  }

  const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

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
        console.error("JSON Parse Error", e);
      }
    }

    // Extract Grounding Metadata
    const sources: GroundingSource[] = [];
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    chunks.forEach((chunk: any) => {
      if (chunk.web?.uri) sources.push({ title: chunk.web.title || chunk.web.uri, uri: chunk.web.uri });
    });
    const uniqueSources = Array.from(new Map(sources.map(s => [s.uri, s])).values());

    const result = { events, sources: uniqueSources };
    const timestamp = Date.now();
    
    // Save to Cache
    localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp, data: result }));

    return { ...result, lastUpdated: timestamp };
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};
