# AGENTS.md

Guidance for any coding agent working in this repository (Codex, Claude Code, or otherwise). This is the canonical agent instruction file; `CLAUDE.md` imports it.

## What this is

CalEvents Discovery aggregates roughly 1,900 UC Berkeley campus events from 12 active sources into static JSON, served by a React frontend with entirely client-side search. Built and maintained by one person. Deployed on Vercel at `cal-events.com`.

Stack: React 19, Vite 8, TypeScript, Tailwind v4, Fuse.js. Pipeline is TypeScript run through `tsx`, validated with Zod. Node 22.

## Commands

```bash
npm run dev                  # Vite dev server → localhost:5173
npm run build                # tsc + vite build → dist/
npm run validate             # Publish-critical suite: lint, format, typecheck, script tests, UI tests
npm run test:scripts         # node:test suite in scripts/tests/ (excludes search-quality and topic-quality)
npm run test:ui              # vitest, tests/*.tsx
npm run test:e2e             # Playwright, tests/e2e/
npm run test:search-quality  # Live golden queries against public/ artifacts (non-blocking in CI)
npm run update-events        # Full pipeline → public/events.json + search-index.json + status.json
npm run rebuild-index        # Rebuild public/search-index.json from the committed events.json
npm run preview              # Preview built output locally
```

Run `npm run validate` before proposing any change. It is the gate CI enforces.

## Repository operations

**`main` is protected by a repository ruleset, not classic branch protection.** This matters because `gh api repos/.../branches/main/protection` returns 404 "Branch not protected", which is misleading. The real rules live at `gh api repos/.../rules/branches/main`. Direct pushes to `main` are rejected.

Two status checks are required to merge: `validate` and `browser-e2e`. Reviews are not required, so once checks pass you can merge your own pull request. Other checks that run but do not gate: `source-contracts`, `search-quality`, Vercel preview.

Workflow: branch, push, open a pull request, wait for both required checks, merge. `gh pr merge <n> --auto --merge` works well since the checks take several minutes.

## Working alongside other agents

Do not run two agents against this working tree at the same time. This has already caused a near-miss: a second session had uncommitted work in the shared tree while another was mid-rebase, and a routine `git pull` would have destroyed it. If you are handed work that another agent started, check `git status` and the reflog before any operation that moves or discards files.

The implementation units in an active plan have real dependencies. Sequential handoff between agents is safer than parallel work across units.

## Architecture

Three layers, cleanly separated.

### 1. Data pipeline (`scripts/`)

`scripts/updateEvents.ts` is the orchestrator. It runs 12 source adapters in parallel with a 60 s timeout each (Simons gets 100 s for its full-history download, LiveWhale 90 s for its windows and group feeds), dedupes the union, projects to legacy shape, writes 3 static JSON artifacts to `public/`.

**Source priority** (used by dedupe to pick the winner when two sources have the same event):

```
livewhale (4) > cal_performances / calbears / bampfa / haas / berkeley_law / simons / luma / begin / ai_risk / brsl / cltc (3)
```

**Failure handling.** Each source has a `RecoveryPolicy` in `scripts/lib/lastGoodFallback.ts`, applied by `markRecovery`:

- On error or below `minHealthyCount`: mark degraded, optionally restore last-good events from the previous `events.json` (filtered to today and later, PT)
- Fallback age counts from each source's `last_healthy_at` in `status.json`, which carries forward while the source is degraded. A restore older than 48 hours expires
- Quiet sources (`degradeOnFailure: false`: luma, begin, ai_risk, brsl, cltc) restore too, but stay out of `degraded_sources`, the top-level reason, and `data_age_hours`
- Each source carries `consecutive_failures` in `status.json`. Three failed fetches in a row open or update a `source-contracts` issue from the daily workflow
- If every source returns 0 events: refuse to overwrite the existing file and exit non-zero
- `status.json` is always written with per-source details, degradation flags, and fallback counts

**CanonicalEvent** (`scripts/lib/schema.ts`) is the internal schema, Zod-validated. Every adapter emits `CanonicalEvent[]`. `projectToLegacy()` in `scripts/lib/normalize.ts` converts to `LegacyCalEvent` for publication.

### 2. Source adapters (`scripts/sources/`)

| File                  | Method                 | Notes                                                                                                                                                                                                |
| --------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `livewhale.ts`        | iCal (node-ical)       | Main campus feed as weekly date windows plus 70 department and student-life group feeds through one request pool, deduped by UID. Group feed URL: `/live/ical/events/group/<Name>` (case-sensitive). |
| `cal_performances.ts` | WordPress REST API     | Arts presenter                                                                                                                                                                                       |
| `calbears.ts`         | iCal                   | Athletics schedule                                                                                                                                                                                   |
| `bampfa.ts`           | HTML scraper (cheerio) | Film and art museum                                                                                                                                                                                  |
| `tribe.ts`            | Tribe/WP REST API      | Haas, Berkeley Law, BRSL, CLTC. Generic adapter, reusable for any site running The Events Calendar plugin                                                                                            |
| `simons.ts`           | JSON API               | CS theory research institute (`simons.berkeley.edu/api/events`)                                                                                                                                      |
| `luma.ts`             | Luma JSON API          | Berkeley-affiliated Luma calendars; IDs in `BERKELEY_LUMA_CALENDARS`                                                                                                                                 |
| `begin.ts`            | iCal (node-ical)       | Berkeley Gateway to Innovation (`begin.berkeley.edu/api/public/events.ics`). The site left WordPress in October 2026                                                                                 |
| `ai_risk.ts`          | JSON feed              | Berkeley AI Risk speaker series (`ai-risk.berkeley.edu/events.json`), which the site builds for its own calendar sync                                                                                |

### 3. Frontend (`App.tsx` + `utils/`)

Loads `events.json` and `search-index.json` at startup. Search is entirely client-side.

**Search flow** (`utils/searchIntent.ts` + `utils/searchEngine.ts`):

1. `buildSearchPlan(query, { topics })` detects intent in a fixed detector order: temporal, source, topic, time-of-day, modality, free, category, campus area. Topic uses the published vocabulary when the feed has loaded. Later topic phrases stay ranking text. Each detector strips its matched words from the residual query text. **Only category names such as "arts" or "sports" lock a category.** Subject words such as "seminar" or "basketball" stay ranking text, because a lock hides matches filed under another primary category. Dismissing a source, category, or topic chip searches the words that set it.
2. `searchEvents` applies plan filters as a hard pool filter, then scores against the inverted index, falls back to Fuse.js, then broadens (drop the weekend filter, then category, then topic) with an explanatory message. Callers narrow the pool to the date range first.

**Search index** (`scripts/lib/buildIndex.ts` → `public/search-index.json`): field-differentiated inverted index. Fields: `t` title (60), `g` tags (45), `o` organizer (30), `l` location (20), `d` description (10). Values are event-position integers into `ids[]`. Venue aliases are injected at build time.

**Categorization** (`scripts/lib/normalize.ts` → `deriveFrontendTags()`): weighted scoring across 6 categories. Organizer identity map (100) > source tags (40) > title keywords (10) > organizer text (8) > description (3). Student Life is the catch-all.

**`tags[0]` is the primary-category contract.** It is read as the category in `hooks/useEventBrowserState.ts`, twice in `agent/webmcpTools.ts`, in the search-events agent skill, and the whole `tags` array feeds the `g` index field at weight 45. Do not add non-category values to `tags`.

**URL state** (`utils/urlState.ts`): query, date range, category, source, and selected event ID round-trip through the URL, with allow-list validation for category and source.

**Date handling**: all comparisons use `America/Los_Angeles` via `Intl.DateTimeFormat`. Date keys refresh every 60 s so the UI stays correct across midnight.

## Agent-facing surfaces

The site exposes itself to agents, and the standing rule is parity: any action a user can take, an agent can take. When you change a user-facing filter or action, update these too.

- `agent/webmcpTools.ts` and `agent/registerWebMcp.ts` carry WebMCP tools registered from the app bundle, reusing the same ranked search engine as the UI
- `public/.well-known/mcp/server-card.json`, `public/.well-known/agent-card.json`
- `public/.well-known/agent-skills/` holds skill files plus `index.json`, which carries SHA-256 content digests that must be regenerated when a skill file changes
- `public/llms.txt`, `public/llms-full.txt`, `public/openapi.json`
- `public/webmcp-tools.js` is a thin legacy shim; the real implementation lives in `agent/`

`scripts/tests/agent-readiness.test.mjs` and `scripts/tests/webmcp-tools.test.mjs` enforce this.

## Conventions

- TypeScript for all new files. Avoid `any`; use real types.
- Modern ES module syntax.
- Prettier and ESLint are enforced by `npm run validate`. Run `npm run format:fix` rather than hand-formatting.
- Tests live in three places: `scripts/tests/*.test.mjs` (node:test, pipeline and engine), `tests/*.tsx` (vitest, UI), `tests/e2e/*.spec.ts` (Playwright).
- Keep implementations focused. This is a single-maintainer project; every abstraction is a long-term carrying cost.

### Writing style for prose

Applies to commit messages, pull request bodies, docs, and any user-facing copy.

- No banned words: delve, tapestry, pivotal, underscore, leverage, foster, robust, seamless, streamline.
- At most one em dash per document; prefer none.
- No "not just X, but also Y" constructions. No rule-of-three filler.
- Short sentences, under 25 words. Simple verbs: built, led, cut, fixed.
- Start with a specific fact, not a thesis statement.

## Publish and alerting rules

Established in `docs/brainstorms/2026-08-17-publish-vs-quality-pipeline-requirements.md` and the June cron-reliability plan. Follow them.

- A fresh snapshot publishes whenever LiveWhale, or its last-good fallback, can support a non-empty feed.
- Live corpus search-quality failures never block the data pull request. They open or update a low-priority `data-quality` issue.
- The `pipeline-failure` operator label is reserved for LiveWhale degraded without usable fallback, or a production feed older than the smoke threshold.
- The daily cron holds exactly one secret, the automation pull-request token. Adding a network dependency to that path needs a strong reason.
- **Visitors never see pipeline health.** The site shows no status or stale-data banners, and the page does not fetch `status.json`. Source failures reach the maintainer through the `pipeline-failure` and `source-contracts` issues. The `degraded` and `degraded_sources` fields still drive `checkFeedHealth` and those alerts. Never route a non-source quality problem through them.

## Recent and open work

The topic filter layer from `docs/plans/2026-09-03-001-feat-topic-filter-layer-plan.md` is on `main` (PR 173). Do not re-implement U1 through U9.

Leftover review work from `docs/code-review-2026-09-04-topic-filter-layer.md` merged in PR 174 on 2026-09-04. Successful empty assignments clear topics. Broad identity mappings are gone. The breadth cap stays 200. Public discovery versions are 1.4.0. The September audit's multi-day fields set 1.3.0, and the published `end_time` set 1.4.0.

The October 2 review of PR 174 is `docs/code-review-2026-10-02-topic-filter-fixes.md`. PRs 215, 217, 218, and 219 fixed all 15 findings on 2026-10-03. Since PR 217, BAMPFA's calendar labels and Cal Performances genres reach `assignTopics` as internal `event_types`. Lessons that apply beyond one bug are in `docs/solutions/`.

The June full-repo audit is `docs/code-review-2026-06-02.md`. It is a different pass.

The September full-repo audit is `docs/code-review-2026-09-25.md`. Every item has a status line. #8, #11, #12, and #13 are fixed in code and wait on a live run.

## Key files

| File                                                | Purpose                                                                                                                                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/updateEvents.ts`                           | Orchestrator: runs adapters, dedupes, writes public JSON                                                                                                                                                                 |
| `scripts/lib/schema.ts`                             | Zod schemas: `CanonicalEvent`, `LegacyCalEvent`, `StatusReport`                                                                                                                                                          |
| `scripts/lib/dedupe.ts`                             | Source-priority dedupe by normalized title and date                                                                                                                                                                      |
| `scripts/lib/normalize.ts`                          | `projectToLegacy`, `deriveFrontendTags`, `isoDateInPT`, `cleanTitle`                                                                                                                                                     |
| `scripts/lib/buildIndex.ts`                         | Inverted index generator with venue alias expansion                                                                                                                                                                      |
| `scripts/lib/lastGoodFallback.ts`                   | Recovery policies, `markRecovery`, and last-good restore with cancellation filtering                                                                                                                                     |
| `scripts/lib/topics.ts`                             | Topic vocabulary and deterministic assignment                                                                                                                                                                            |
| `docs/code-review-2026-09-04-topic-filter-layer.md` | Leftover topic-filter review items after PR 173                                                                                                                                                                          |
| `docs/solutions/`                                   | Documented solutions to past problems, one file each, in category folders such as `logic-errors/`. YAML frontmatter carries `module`, `tags`, and `problem_type`. Relevant when debugging or changing a documented area. |
| `api/_lib/eventPreview.ts`                          | Link-preview tags and card data for shared event URLs                                                                                                                                                                    |
| `utils/searchIntent.ts`                             | Query intent: `buildSearchPlan`, topic phrases, dismissed-key rebuild                                                                                                                                                    |
| `utils/searchEngine.ts`                             | `searchEvents`: pool filters, scoring, and fallback                                                                                                                                                                      |
| `utils/textUtils.ts`                                | Stemmer, tokenizer, `DOMAIN_SYNONYMS`, venue aliases                                                                                                                                                                     |
| `hooks/useEventBrowserState.ts`                     | Pool filtering, date bucketing, empty and fallback state                                                                                                                                                                 |
| `components/FiltersBar.tsx`                         | Desktop bar and mobile drawer, both filter variants                                                                                                                                                                      |
| `App.tsx`                                           | Top-level component: composes hooks and UI sections                                                                                                                                                                      |
| `types.ts`                                          | `CalEvent`, `SearchFilters`, `IngestionStatus`                                                                                                                                                                           |
| `public/events.json`                                | Published events, committed and served statically                                                                                                                                                                        |
| `public/status.json`                                | Per-source health and degradation flags, committed                                                                                                                                                                       |
| `.github/workflows/update-events.yml`               | Daily run: dual cron at 11:00 and 12:00 UTC, gated to 4:00 AM Pacific                                                                                                                                                    |

## Non-obvious details

**All-day events**: iCal VEVENTs with `VALUE=DATE` become `all_day: true` with a bare `YYYY-MM-DD` start. `displayTime()` returns "All day".

**Running spans**: adapters drop an event only after its last day (`endedBeforePT`). A bare all-day end is exclusive. `withSpanOccurrences` then gives a multi-day span one `dates` entry per remaining day, capped at 120, and publishes today as its `date`.

**Shared-link previews**: chat apps read Open Graph tags without running JavaScript. A `vercel.json` route sends `/?event=<id>` to `api/event-preview.ts` only when the user agent matches a known link-preview crawler. People still get the static app. That page names `api/event-image.tsx` as its `og:image`, a 1200x630 card drawn with `@vercel/og`. Both functions read the committed `public/events.json` through `includeFiles`, so previews match the last deploy. An unknown or ended event gets the site-wide preview. `@vercel/og` is pinned to 1.0.1 because 1.0.2 and 1.0.3 crash under plain Node ESM. Relative imports under `api/` need a `.js` extension for the same reason.

**LiveWhale main-feed windows**: the bare `/live/ical/events` URL silently stops at about 930 to 970 events, roughly two weeks ahead. The adapter instead fetches `/start_date/<a>/end_date/<b>` windows, a week back through eight weeks ahead. `end_date` is exclusive for timed events, so each window starts where the last ended. Some responses are cut off mid-event, just before an event whose title holds a 4-byte emoji, and retrying the same URL returns the same cut body. Every LiveWhale response must end with `END:VCALENDAR`. A cut-off window, or one at 900 or more events, is split in halves down to single days. A single day can stay cut (2026-11-21 did, intermittently). Its complete events are kept and the day is refilled from LiveWhale's JSON feed (`/live/json/events/.../response_fields/location,description,event_types`), whose IDs match the iCal UIDs. That feed wraps rows in `{meta, links, data}`, pages at 100 rows, and gives `event_types` as an array. A day the JSON feed cannot fill, or a week that stays empty after one retry, is listed as `failed_windows` on the LiveWhale status entry. Only an outright failure in the first three windows (an error page or network failure), or fewer than 50 events across them, degrades LiveWhale. Window requests, including splits and JSON refills, start ahead of queued group feeds in the shared pool, group feeds stop after 60 s, and redirect lookups get what is left of the budget, so a slow upstream cannot time out the required windows. `npm run check:livewhale-budget` (also run by the Source Contracts workflow) simulates 14 s per request and fails if the adapter overruns its budget or loses a required window. The daily workflow opens a `data-quality` issue whenever `failed_windows` or `failed_groups` is non-empty.

**LiveWhale group feeds**: the main feed misses events posted only to department calendars. Group feeds use path-based URLs, and the name must be the group's exact full name: a near miss such as "and" for "&" returns a valid empty calendar. The adapter fetches 70 groups through the same bounded pool as the windows and merges by UID, keeping every group that listed an event as topic evidence. CalLink was retired in October 2026 when CampusLabs put every page behind a login (`RETIRED_SOURCES` in `scripts/lib/schema.ts` keeps its id valid for old data). Student events now come from LiveWhale's student-life groups, including the campus-wide `Student Events: The Big "C"alendar:` and `ASUC Student Union`. A cut group feed is refilled from the JSON group feed (`/live/json/events/group/<Name>`). A failed group feed, including a 200 response that is not iCal, or one cut off without a JSON refill, lands in `failedGroups`. Its events keep only the prior topics that group can give. Group failures never mark LiveWhale degraded. `status.json` lists them on the LiveWhale entry as `failed_groups`.

**Tribe adapter reusability**: `scripts/sources/tribe.ts` exports `fetchHaas`, `fetchBerkeleyLaw`, `fetchBrsl`, and `fetchCltc` from one config-driven implementation. A new WordPress site running The Events Calendar needs only a new export.

**Stemming must stay consistent**: `buildIndex.ts` and `searchEngine.ts` both call `stem()` from `utils/textUtils.ts`. Change the stemmer, the tokenizer, or the venue aliases and run `npm run rebuild-index`. A stability test fails until the committed index matches.

**`runAdapterWithTimeout`** wraps each adapter so it resolves to a failed run rather than rejecting. The orchestrator still uses `Promise.allSettled` and maps results back to source names by index, so one timeout cannot cancel the others.

**The dual cron is a gate, not two runs**: both cron entries fire, and a step exits early unless the current UTC hour matches 4:00 AM Pacific for the active DST offset. A skipped run reports success, so a frozen site can look green. Check the run that was not skipped.
