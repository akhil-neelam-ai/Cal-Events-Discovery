# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev                          # Vite dev server → localhost:5173
npm run build                        # tsc + vite build → dist/
npm run update-events                # Run full data pipeline → public/events.json + search-index.json + status.json
API_KEY=... npm run update-events    # Also run Gemini long-tail adapter
npm run validate                     # Run test suite (Node + tsx loader)
npm run preview                      # Preview built output locally
vercel --prod                        # Deploy to Vercel
```

## Architecture

Three layers, cleanly separated.

### 1. Data pipeline (`scripts/`)

`scripts/updateEvents.ts` is the orchestrator. It runs 9 source adapters in parallel with a 60 s timeout each, dedupes the union, projects to legacy shape, writes 3 static JSON artifacts to `public/`.

**Source priority** (used by dedupe to pick winner when two sources have the same event):
```
livewhale (4) > callink / cal_performances / calbears / bampfa / haas / berkeley_law / simons (3) > ehub (2) > gemini (1)
```

**Failure handling** — each source has a `RecoveryPolicy` in `updateEvents.ts`:
- On error or below `minHealthyCount`: mark degraded, optionally restore last-good events from previous `events.json` (filtered to today+ PT)
- If every source returns 0 events: refuse to overwrite the existing file and exit non-zero
- `status.json` always written with per-source details, degradation flags, and fallback counts

**CanonicalEvent** (`scripts/lib/schema.ts`) is the internal schema (Zod-validated). Every adapter must emit valid `CanonicalEvent[]`. `projectToLegacy()` in `scripts/lib/normalize.ts` converts to `LegacyCalEvent` for publication.

### 2. Source adapters (`scripts/sources/`)

| File | Method | Notes |
|------|--------|-------|
| `livewhale.ts` | iCal (node-ical) | Main campus feed + 30+ department group feeds in parallel, deduped by UID. Group feed URL: `/live/ical/events/group/<Name>` (case-sensitive). |
| `callink.ts` | CampusGroups JSON API | Student org events |
| `cal_performances.ts` | WordPress REST API | Arts presenter |
| `calbears.ts` | iCal | Athletics schedule |
| `bampfa.ts` | HTML scraper (cheerio) | Film/art museum |
| `tribe.ts` | Tribe/WP REST API | Haas + Berkeley Law — generic adapter, reusable for any site running The Events Calendar plugin |
| `simons.ts` | iCal | CS theory research institute |
| `ehub.ts` | HTML scraper (cheerio) | Entrepreneurship hub |
| `gemini.ts` | Gemini API + Google Search grounding | Long-tail only, ≤12 events, lowest confidence. Retry backoff: [15 s, 45 s, 90 s] on 503. Only runs if `API_KEY` env var is set. |

### 3. Frontend (`App.tsx` + `utils/`)

Loads `events.json` and `search-index.json` at startup. Search is entirely client-side.

**Search flow** (`utils/searchEngine.ts`):
1. `buildSearchPlan(query)` — detects temporal intent, time-of-day, modality, category, free/paid, expands via `DOMAIN_SYNONYMS` and venue aliases
2. `searchEvents(events, plan, index)` — hard-filter pool → inverted index scoring → Fuse.js fallback if <3 results → broadening heuristic (relax date → relax category)

**Search index** (`scripts/lib/buildIndex.ts` → `public/search-index.json`): field-differentiated inverted index. Fields: `t` (title, weight 60), `g` (tags, 45), `o` (organizer, 30), `l` (location, 20), `d` (description, 10). Values are arrays of event-position integers into the `ids[]` array. Venue aliases (e.g., `bampfa` → "arts film museum cinema gallery") are injected at build time so queries match without the venue name.

**Categorization** (`scripts/lib/normalize.ts` → `deriveFrontendTags()`): weighted scoring across 6 frontend categories. Weights: organizer identity map (100) > source-provided tags (40) > title keywords (10) > organizer text (8) > description (3). Student Life is the catch-all (wins only when all other scores are 0).

**URL state** (`utils/urlState.ts`): search query, date range, category, source, and selected event ID are all synced to the URL hash. `userSetDateRangeRef` (useRef) prevents query interpretation from overriding an explicit filter-bar click.

**Date handling**: all date comparisons use `America/Los_Angeles` (PT, DST-aware) via `Intl.DateTimeFormat`. `isoDateInPT()` converts ISO timestamps to `YYYY-MM-DD` in PT. The `todayKey` / `tomorrowKey` / `nextWeekKey` state updates every 60 s via `setInterval` so the UI stays correct across midnight.

## Key Files

| File | Purpose |
|------|---------|
| `scripts/updateEvents.ts` | Orchestrator — runs adapters, dedupes, writes public JSON |
| `scripts/lib/schema.ts` | Zod schemas: `CanonicalEvent`, `LegacyCalEvent`, `StatusReport` |
| `scripts/lib/dedupe.ts` | Source-priority dedup by (normalized title, date) |
| `scripts/lib/normalize.ts` | `projectToLegacy`, `deriveFrontendTags`, `isoDateInPT`, `cleanTitle` |
| `scripts/lib/buildIndex.ts` | Inverted index generator with venue alias expansion |
| `utils/searchEngine.ts` | `buildSearchPlan` + `searchEvents` — entire client search logic |
| `utils/textUtils.ts` | Porter-lite stemmer, tokenizer, `DOMAIN_SYNONYMS`, venue alias map |
| `App.tsx` | Monolithic React component (~1,700 lines): all UI, state, event handlers |
| `types.ts` | Frontend-facing types: `CalEvent`, `SearchFilters`, `IngestionStatus` |
| `public/events.json` | Published events (committed to repo, served statically) |
| `public/status.json` | Per-source health + degradation flags (committed to repo) |
| `public/search-index.json` | Inverted index (~215 KB, committed to repo) |
| `.github/workflows/update-events.yml` | Daily cron at 11:25 UTC (4:25 AM PDT) |

## Non-Obvious Details

**All-day events**: iCal VEVENTs with `VALUE=DATE` → `all_day: true` + `start_at: YYYY-MM-DD` (no time component). `displayTime()` returns `"All day"` for these.

**LiveWhale group feeds**: The main feed misses events posted only to department calendars. Group feeds use path-based URLs (not query params), and group names are case-sensitive. The adapter fetches 30+ groups in parallel and dedupes by UID.

**Tribe adapter reusability**: `scripts/sources/tribe.ts` exports both `fetchHaas` and `fetchBerkeleyLaw` — it's a generic WP REST adapter. Adding a new WordPress site running The Events Calendar plugin requires only a new export with a different base URL.

**Stemming must be consistent**: `buildIndex.ts` and `searchEngine.ts` both call the same `stem()` function from `utils/textUtils.ts`. If you change the stemmer, regenerate the index.

**Gemini long-tail demoted**: Gemini was previously the primary data source. It is now lowest-priority supplemental only (≤12 events, no fallback policy). Hallucination prevention is enforced by Zod validation — records that fail the schema are silently dropped.

**`runAdapterWithTimeout`** in `updateEvents.ts` wraps each adapter so it never rejects. This allows `Promise.all` (not `Promise.allSettled`) — one timeout cannot cancel the others, and source names are always preserved in the result.
