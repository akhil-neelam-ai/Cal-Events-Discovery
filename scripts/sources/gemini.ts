/**
 * Gemini long-tail adapter — demoted from primary curator.
 *
 * Now that LiveWhale + E-Hub deliver the structured corpus, Gemini exists
 * only to surface long-tail items those feeds miss: student-org socials,
 * external-but-Berkeley-hosted talks, smaller research center events that
 * don't push to events.berkeley.edu. We ask for ≤ 12 events with low
 * temperature, validate every record against the canonical schema, and drop
 * anything that fails. Failures are non-fatal — the orchestrator continues.
 */

import { GoogleGenAI } from '@google/genai';
import type { CanonicalEvent } from '../lib/schema.js';
import { CanonicalEventSchema } from '../lib/schema.js';

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [2_000, 8_000, 30_000];
const MAX_EVENTS = 12;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractJsonArray(text: string): unknown[] | null {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  const first = stripped.indexOf('[');
  const last = stripped.lastIndexOf(']');
  if (first === -1 || last <= first) return null;
  const candidate = stripped.substring(first, last + 1);
  try {
    const parsed = JSON.parse(candidate);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
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

export interface FetchResult {
  events: CanonicalEvent[];
  rawCount: number;
  filteredPast: number;
  invalid: number;
  groundingSources: Array<{ title: string; uri: string }>;
}

export async function fetchGeminiLongTail(apiKey: string): Promise<FetchResult> {
  const ai = new GoogleGenAI({ apiKey });
  const fetched_at = new Date().toISOString();

  const todayIso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  const prompt = `
You are a Berkeley campus events researcher. The official events.berkeley.edu calendar is already fully ingested (≈1,500 events). Do NOT duplicate it.

Today's date: ${todayIso} (America/Los_Angeles)

Your job is to find UP TO ${MAX_EVENTS} **long-tail** Berkeley events that the official calendar tends to MISS:
- Registered student org socials, club meetings, recruiting events (callink.berkeley.edu)
- Greek life philanthropy events
- Pop-up startup / VC / pitch events at SkyDeck, BHGAP, House Fund
- Community talks at venues that don't sync to LiveWhale (e.g., Berkeley Public Library Cal collabs, Free Speech Movement Cafe events)
- Visiting scholar talks announced only on department mailing lists

REQUIREMENTS (every event MUST satisfy):
1. Date in the next 30 days, on or after ${todayIso}
2. Located ON UC Berkeley campus OR within Berkeley city limits
3. Specific start date — no "ongoing" or date ranges
4. Real, verifiable URL (no events.berkeley.edu URLs — those are already covered)

Return ONLY a JSON array. No markdown, no prose. Each element MUST have exactly these fields:
{
  "title": "...",
  "description": "1-2 sentence summary",
  "start_at": "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM:SS-07:00",
  "all_day": true | false,
  "venue": "...",
  "organizer": "...",
  "canonical_url": "https://...",
  "categories": ["Academic" | "Arts" | "Sports" | "Science & Tech" | "Student Life" | "Entrepreneurship"]
}

If you cannot find ${MAX_EVENTS} events that satisfy ALL requirements, return fewer. An empty array [] is acceptable. NEVER fabricate.
`.trim();

  let response: { text?: string; candidates?: unknown[] } | null = null;
  let lastError = '';
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attemptsMade = attempt;
    try {
      response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          temperature: 0.2,
          topP: 0.9,
        },
      }) as { text?: string; candidates?: unknown[] };
      break;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      lastError = msg;
      console.warn(`[gemini] attempt ${attempt}/${MAX_ATTEMPTS} failed: ${msg}`);
      if (/API_KEY_INVALID|API key not valid/i.test(msg)) {
        break;
      }
      if (attempt < MAX_ATTEMPTS) await sleep(BACKOFF_MS[attempt - 1]);
    }
  }

  if (!response) {
    throw new Error(`Gemini failed after ${attemptsMade} attempt${attemptsMade === 1 ? '' : 's'}: ${lastError}`);
  }

  const text = response.text || '';
  const parsed = extractJsonArray(text);
  if (!parsed) {
    throw new Error('Gemini returned no parseable JSON array');
  }

  const events: CanonicalEvent[] = [];
  let invalid = 0;
  let filteredPast = 0;

  for (let i = 0; i < parsed.length; i++) {
    const raw = parsed[i] as Record<string, unknown>;
    const start_at = String(raw.start_at ?? '');
    const dateOnly = start_at.slice(0, 10);
    if (dateOnly && dateOnly < todayIso) {
      filteredPast++;
      continue;
    }

    const canonicalUrl = String(raw.canonical_url ?? '');
    if (canonicalUrl.includes('events.berkeley.edu')) {
      // We told it not to dup the official feed; drop if it ignored us.
      invalid++;
      continue;
    }

    const candidate: CanonicalEvent = {
      source_name: 'gemini',
      source_id: `gemini_${dateOnly.replace(/-/g, '')}_${i + 1}`,
      source_url: 'https://gemini.google.com/',
      evidence_url: canonicalUrl || undefined,
      title: String(raw.title ?? ''),
      description: String(raw.description ?? ''),
      start_at,
      end_at: undefined,
      timezone: 'America/Los_Angeles',
      all_day: Boolean(raw.all_day),
      venue: String(raw.venue ?? ''),
      building: '',
      address: '',
      modality: 'in_person',
      organizer: String(raw.organizer ?? ''),
      organizer_unit: String(raw.organizer ?? ''),
      audience: '',
      cost: '',
      registration_url: undefined,
      canonical_url: canonicalUrl,
      categories: Array.isArray(raw.categories) ? raw.categories.map(String) : [],
      tags: Array.isArray(raw.categories) ? raw.categories.map(String) : [],
      last_seen_at: fetched_at,
      confidence: 0.55,
      quality_flags: ['llm_extracted'],
    };

    const validated = CanonicalEventSchema.safeParse(candidate);
    if (!validated.success) {
      invalid++;
      continue;
    }
    events.push(validated.data);
  }

  // Pull grounding sources for the published source list.
  const groundingSources: Array<{ title: string; uri: string }> = [];
  const candidates = (response.candidates ?? []) as Array<{
    groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> };
  }>;
  const chunks = candidates[0]?.groundingMetadata?.groundingChunks ?? [];
  for (const chunk of chunks) {
    if (chunk.web?.uri) {
      groundingSources.push({ title: chunk.web.title || chunk.web.uri, uri: chunk.web.uri });
    }
  }

  console.log(`[gemini] parsed ${events.length}/${parsed.length} (past: ${filteredPast}, invalid: ${invalid})`);
  return { events, rawCount: parsed.length, filteredPast, invalid, groundingSources };
}
