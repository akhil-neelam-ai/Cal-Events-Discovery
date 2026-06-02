# Code Review Findings — calevents-discovery

**Date:** 2026-06-02
**Scope:** Full-codebase audit (entire project, ~17k lines). Not a single diff.
**Verdict:** Healthy. 0 P0, 0 P1, 30 P2, 14 P3. No merge blockers.
**Method:** 11 reviewer passes (correctness, testing, maintainability, project-standards, agent-native, learnings, security, performance, api-contract, reliability, adversarial). Security found zero exploitable issues; adversarial empirically ruled out ReDoS, unicode dedup evasion, and URL-hash abuse.

---

## How to use this document (for the coding agent)

1. Work the tiers top to bottom. Tier 1 (real bugs) and Tier 2 (quick wins) first.
2. Each entry has `Problem`, `Fix`, and (where relevant) `Verify`. The `Fix` is concrete; follow it unless the surrounding code says otherwise.
3. One item needs a human decision before you act: **#12** (is `luma`/`begin` a critical source?). Ask before changing it, or default to "not critical" and flag the choice.
4. Preserve the security invariants in the last section. Do not weaken them.
5. After each tier, run `npm run validate` (tests), `npx tsc --noEmit` (types), and `npm run build`. Do not mark a tier done until those pass.
6. Line numbers are from HEAD `75051f0` on branch `feat/more-sources`. Re-locate by symbol if they have drifted.
7. The branch had uncommitted work in `scripts/lib/collapseMultiDay.ts` at review time. Keep your changes separate from that.

---

## Tier 1 — Real bugs (fix first)

### #1 — `recencyBonus` zeroes today's events (P2)
**File:** `utils/searchEngine.ts:423`
**Problem:** `recencyBonus` does `new Date(dateStr).getTime() - Date.now()`. A date-only string (`YYYY-MM-DD`) parses as UTC midnight. In Pacific time, the current instant is ahead of today's UTC midnight, so the diff is negative, `days < 0`, and the function returns 0. Result: events happening today get no recency bonus while future events keep it. Ranking is backwards for the freshest events.
**Fix:** Compare Pacific day keys, not raw timestamps. Use `getCurrentPacificDateKey()` and a PT day key derived from the event date, take the integer day difference so today is `0`. Keep the `0..30` day window and the `W.recency` weighting.
**Verify:** Add a fixed-clock test in `scripts/tests/search-engine-runtime.test.mjs`: an event dated today must outscore a semantically identical event dated ~25 days out. Existing synthetic events are all past-dated, so today the bonus is always 0 in tests (see #4 in Tier 7).

### #16 — ICS export emits invalid `DTEND:...T240000` (P2)
**File:** `utils/icsExport.ts:56`
**Problem:** `timeWindow()` sets `endHour = hour + 1` with no rollover. An 11 PM event gives `endHour = 24`, so `pad(24)` produces `T240000`. RFC 5545 hours are `00`-`23`; many calendar clients reject or mishandle this, and the date does not advance. "Add to Calendar" breaks for late-evening events.
**Fix:** In `timeWindow()`, when `endHour >= 24`, roll the date forward one day (use `addDaysToDateKey` on the date key) and set the end hour to `endHour - 24`. Make sure `DTEND` carries the next day's date.
**Verify:** Add a case to `scripts/tests/ics-export.test.mjs` for an `11:00 PM` event asserting `DTEND` is `date+1` at `T000000`.

### #12 — `CRITICAL_SOURCES` desync between publish gate and CI health check (P2)
**Files:** `scripts/updateEvents.ts:87` and `scripts/lib/feedHealthPolicy.mjs:7`
**Problem:** `updateEvents.ts` sets `CRITICAL_SOURCES = new Set(ALL_SOURCE_NAMES)` (all 11 sources). `feedHealthPolicy.mjs` lists only 9 (no `luma`, no `begin`). The two gates disagree on whether `luma`/`begin` degradation is critical. `parseMaxFallbackAgeHours` is also duplicated verbatim in both files.
**Decision needed:** Are `luma` and `begin` critical sources? They sit at dedupe priority 3 and are treated as thin-coverage. Recommended answer: **not critical** (use the 9-source set). Confirm with the maintainer before changing.
**Fix:** Pick one authoritative definition. Export `CRITICAL_SOURCES` and `parseMaxFallbackAgeHours` from a single module and import it in the other. `feedHealthPolicy.mjs` already exports `parseMaxFallbackAgeHours`; import that into `updateEvents.ts` and delete the local copy. Align `CRITICAL_SOURCES` to the chosen set.
**Verify:** Add a test that both gates evaluate the same `status.json` fixture identically for a `luma`/`begin` degradation.

---

## Tier 2 — Quick wins (low-risk, mostly mechanical)

### #17 — webmcp `source` description omits `luma` and `begin` (P2, safe)
**File:** `public/webmcp-tools.js:103` (description string around 103-115)
**Problem:** The `source` parameter description lists 9 of 11 valid source IDs. Agents will not discover `luma` or `begin` filters. The filter code already handles them; only the docs are short.
**Fix:** Add `luma` and `begin` to the description string. Confirm against `SourceNameSchema` in `scripts/lib/schema.ts` and `ALL_SOURCES` in `appConfig.ts`.

### #40 — Dead exports `parseQuery` and `expandTokens` (P3, safe)
**File:** `utils/searchEngine.ts:945`
**Problem:** `parseQuery` is `@deprecated` and `expandTokens` is exported, both with zero importers.
**Fix:** Grep the repo to confirm no imports, then delete both exports.

### #10 — `fetchWithRetry` has no jitter (P2, safe)
**File:** `scripts/lib/fetchWithRetry.ts:63`
**Problem:** Backoff is `retryDelayMs * attempt` (linear, no jitter). With 11 adapters retrying together, failures synchronize into retry storms.
**Fix:** Use exponential backoff with jitter: `Math.floor(retryDelayMs * 2 ** (attempt - 1) * (0.8 + Math.random() * 0.4))`.

### #11 — `notifyPipelineFailure` gh calls outside try/catch (P2, safe)
**File:** `scripts/notifyPipelineFailure.mjs:96`
**Problem:** The `gh issue comment` and `gh issue create` calls (lines 96-115) are not wrapped, unlike the label-ensure (66-70) and list (90-94) steps. If the alert call throws, the operator notification is lost and the exit is misattributed.
**Fix:** Wrap lines 96-115 in try/catch matching the label-ensure pattern. Log the error, then `process.exit(1)` with a message that names this script as the failure point.

### #5 — `scored.find()` O(n) scan in Fuse merge (P2, safe)
**File:** `utils/searchEngine.ts:781`
**Problem:** Merging Fuse results uses a `scored` array plus `.find()`, up to ~270k string comparisons per query.
**Fix:** Build a `Map<eventId, { event, score }>` in Phase 1, use `map.get(item.id)` in the Fuse merge loop, and convert to an array only for the final sort.

### #7 — `filteredEventsSignature` join/split per render (P2, safe)
**File:** `hooks/useEventGridState.ts:29`
**Problem:** Up to 900 event IDs are joined into a string and then re-split on every render.
**Fix:** Drop the join/split. `filteredEvents` is already reference-memoized in `useEventBrowserState`; use reference equality as the change signal and build a `Set` directly when the subset check needs one.

### #18 — `openapi.json` envelope missing fields (P2, safe)
**File:** `public/openapi.json:25`
**Problem:** The events envelope schema omits `data_age_hours` and `degraded_sources`, both always written by `updateEvents.ts` and read by `services/eventsLoader.ts`.
**Fix:** Add `data_age_hours` (number) and `degraded_sources` (array of string) to the envelope schema.

### #35 — `openapi.json` `SourceStatus` missing fields (P3, safe)
**File:** `public/openapi.json:127`
**Fix:** Add `fallback_count`, `fallback_age_hours`, and `degraded_reason` to the `SourceStatus` schema, mirroring `scripts/lib/schema.ts`.

### #42 / #43 / #44 — Doc drift in `CLAUDE.md` (P3, safe)
- **#42 `CLAUDE.md:77`:** Says App.tsx is "~1,700 lines". It is ~329. Update or drop the count.
- **#43 `CLAUDE.md:22`:** Source count says 11; `README.md` says 10; there are 9 `.ts` adapters in `scripts/sources/`. Reconcile to one number across `CLAUDE.md`, `README.md`, and `~/CLAUDE.md`.
- **#44 `CLAUDE.md:82`:** Cron says "11:25 UTC". The workflow runs a dual-cron at 11:00 and 12:00 UTC with a schedule-gate that picks 4 AM Pacific for the current DST offset. Update the text.

---

## Tier 3 — Search performance cluster (`utils/searchEngine.ts`)

One focused change here is the biggest user-felt win. The 140ms debounce currently masks these; they bite if the corpus grows or the debounce shrinks. The fixes are independent but touch the same hot path, so do them together.

### #2 — `Array.includes` O(n) posting-list scan per token per event (P2)
**File:** `utils/searchEngine.ts:553`
**Fix:** Build a per-token `Set<number>` from posting lists once at the top of `runScoring` (before the candidate loop), then replace the five `.includes(pos)` calls in `scoreEvent` with `.has(pos)`.

### #3 — `tokenFrequencyMultiplier` rebuilds a `Set` per (token, candidate) (P2)
**File:** `utils/searchEngine.ts:456`
**Problem:** The multiplier depends only on the token and the index, never the candidate, yet it rebuilds a `Set` over all 5 fields for every pair (up to ~27k constructions per query).
**Fix:** Hoist into `runScoring`: compute `Map<token, multiplier>` once before the candidate loop.

### #4 — Per-event re-tokenization in the Fuse fallback (P2)
**File:** `utils/searchEngine.ts:499`
**Problem:** `eventHasAnyExpandedToken` re-tokenizes each event inside the Fuse fallback loop.
**Fix:** Precompute `Map<eventId, Set<token>>` once for the fuzzy pool before `fuse.search`, then pass it in instead of re-tokenizing.

### #6 — Four filter+sort passes when one bucket is shown (P2)
**File:** `hooks/useEventBrowserState.ts:176`
**Fix:** Partition `baseFilteredEvents` into the four date buckets in a single pass. Derive `effectiveDateRange` first, then sort and return only the active bucket.

### #8 — 215KB index blocks first paint (P2)
**File:** `hooks/useEventFeed.ts:70`
**Problem:** `search-index.json` is fetched in parallel with `events.json`, so first render waits on both. The index is only needed once a query reaches 2+ chars.
**Fix:** Fetch `events.json` first and call `setAllEvents` when it resolves so the list renders. Fetch `search-index.json` in a follow-up and call `setSearchIndex` when it arrives.

---

## Tier 4 — Pipeline hardening (`scripts/`)

### #9 — Fallback-age guard only fires under `STRICT_DATA_QUALITY` (P2)
**File:** `scripts/updateEvents.ts:401`
**Problem:** `STRICT_DATA_QUALITY` is unset by default, so the max-fallback-age check is effectively disabled. Days-old fallback data can publish and the pipeline exits 0.
**Fix:** Either set `STRICT_DATA_QUALITY=1` in the GitHub Actions workflow env, or move the fallback-age check outside the `STRICT_DATA_QUALITY` gate so stale fallback always blocks. Prefer moving the check out so the default deployment is safe.

### #14 — No length bounds on schema string fields (P2)
**File:** `scripts/lib/schema.ts:57`
**Problem:** `title`, `description`, and `source_id` have no `.max()`. A broken or hostile feed can emit a multi-megabyte field that passes `safeParse` and bloats committed `events.json` and `search-index.json` (description is indexed as full text).
**Fix:** Add bounds to `CanonicalEventSchema`: `title.max(300)`, `description.max(20000)`, `source_id.max(512)`, and `organizer`/`venue`/`address`/`location` `.max(500)`. Per-adapter `safeParse` already skips invalid events, so oversized entries drop cleanly.

### #13 — Adapter timeout does not abort the in-flight fetch (P2)
**File:** `scripts/updateEvents.ts:375`
**Problem:** The 60s timeout via `Promise.race` resolves a fallback, but the underlying fetch keeps running.
**Fix:** Pass `controller.signal` into the adapter. Have the `setTimeout` call `controller.abort()` and resolve a fallback `AdapterRun`. Clear the timeout when the adapter finishes.

### #15 — No per-source event ceiling (P2, advisory)
**File:** `scripts/updateEvents.ts:501`
**Problem:** One source flooding (for example `scripts/sources/simons.ts:103` ingests the full API array with no cap) can starve `search-index.json` and balloon the committed artifacts.
**Fix:** Add a per-source cap in the orchestrator (truncate `AdapterRun.events` and set a degraded flag), or a slice/`MAX_PAGES` in the uncapped JSON adapters. Verify the cap does not drop legitimate large feeds (livewhale).

### #33 — Unreachable `?? "ehub"` fallback misattributes failures (P3)
**File:** `scripts/updateEvents.ts:480`
**Problem:** `adapterRuns[index]?.name ?? "ehub"` cannot actually fire (`settledRuns` is 1:1 with `adapterRuns`), but if it ever did it would silently attribute a rejection to `ehub` and corrupt the status report.
**Fix:** Replace with a hard throw or assertion so the impossible case fails loudly instead of mislabeling.

### #32 — `atomicWrite` leaks tmp file on rename failure (P3)
**File:** `scripts/lib/atomicWrite.ts:15`
**Problem:** If `renameSync` throws (for example EXDEV on a cross-device mount), the temp file is left behind and accumulates across cron failures.
**Fix:** Wrap `renameSync` in try/finally. On failure, `fs.unlinkSync(tmpPath)` (swallow unlink errors) and re-throw.

---

## Tier 5 — Data and agent contracts

### #19 — Agent search tool uses substring match, not ranked search (P2)
**File:** `public/webmcp-tools.js:35`
**Problem:** `search_berkeley_events` does a plain `.includes()` across fields. The UI runs `buildSearchPlan` + `searchEvents` (intent detection, synonym expansion, per-field weights, Fuse fallback, date broadening). Agents get materially worse results than users.
**Fix:** Inline the ranked pipeline into `webmcp-tools.js` (fetch `search-index.json`, run the same scoring), or, as a minimum, document the limitation in the tool description so agents know they get raw substring results.

### #20 — No `get_event_by_id` agent tool (P2)
**File:** `public/webmcp-tools.js:200`
**Problem:** The UI supports `?event=<id>` deep links. Agents holding an event ID cannot fetch its detail without an unscoped search.
**Fix:** Add `get_event_by_id(id)` that fetches `events.json` and returns the single matching event.

### #37 — ICS export is UI-only, no agent tool (P3)
**File:** `utils/icsExport.ts:140`
**Fix:** Add a `generate_event_ics(id)` tool returning `buildEventIcs()` output as a string. `buildEventIcs` is already a pure function with no browser dependency.

### #38 — Agent tool has no `datePreset` shorthand (P3, advisory)
**File:** `public/webmcp-tools.js:124`
**Fix:** Add a `datePreset` param (`today` | `tomorrow` | `week` | `upcoming`) that resolves Pacific-time bounds inside `execute()`, matching the FiltersBar presets.

### #36 — `LegacyCalEvent.source` optional but always set (P3, advisory)
**File:** `scripts/lib/schema.ts:116`
**Problem:** The field is TS-optional, yet `projectToLegacy` always sets it. The fallback-restore path bypasses `projectToLegacy` and could emit source-less events, silently breaking the webmcp source filter.
**Fix:** Confirm every path that produces `LegacyCalEvent` sets `source` (including fallback restore in `updateEvents.ts`), then promote `source` to required.

---

## Tier 6 — Structure and duplication

### #21 — `todayPT()` duplicated across 10 files (P2)
**Files:** `scripts/sources/*.ts` and `scripts/updateEvents.ts` (canonical helper exists in `scripts/lib/normalize.ts`)
**Fix:** Export `todayPT()` from `normalize.ts` (or a new `scripts/lib/dateUtils.ts` next to `isoDateInPT`). Delete the 10 private copies: `tribe.ts`, `bampfa.ts`, `cal_performances.ts`, `callink.ts`, `luma.ts`, `livewhale.ts`, `ehub.ts`, `simons.ts`, `calbears.ts`, `updateEvents.ts`.

### #22 — `FetchResult` interface duplicated across 9 adapters (P2)
**File:** `scripts/sources/callink.ts:27` and 8 others
**Fix:** Move `FetchResult` into `scripts/lib/schema.ts` and import it in all 9 adapters.

### #23 — Dead/duplicate `stripHtml` and `eventDateInPT` in callink (P2)
**File:** `scripts/sources/callink.ts:63` and `:116`
**Problem:** `stripHtml` duplicates `sanitizePlainText`, and `eventDateInPT` re-implements `isoDateInPT`. Both are exported with no external consumers.
**Fix:** Remove both exports. Use `sanitizePlainText` and `isoDateInPT` from `normalize.ts`.

### #24 — `useEventBrowserState` returns 5 unused values (P2)
**File:** `hooks/useEventBrowserState.ts:38`
**Problem:** `todayEvents`, `tomorrowEvents`, `weekEvents`, `upcomingEvents`, and `derivedDateRange` are returned but no caller (including `App.tsx`) destructures them. They are only needed internally.
**Fix:** Remove the 5 fields from `UseEventBrowserStateResult` and stop returning them.

### #25 — `historyModeRef` threading couples three layers (P2)
**File:** `App.tsx:86`
**Problem:** `historyModeRef` and `isApplyingHistoryRef` are allocated in `App.tsx` and threaded through two hooks via a shared mutable ref. `HistoryMode` is re-declared in each hook.
**Fix:** Move both refs into `useUrlStateSync`. Give `useEventBrowserActions` an `onHistoryIntent(mode)` callback instead of the raw ref. Remove `App.tsx` as a wiring layer and the duplicated `HistoryMode` type.

### #26 — `as unknown as VEvent` double-casts (P2)
**Files:** `scripts/sources/livewhale.ts:490` (9 sites), `scripts/sources/calbears.ts` (3 sites)
**Problem:** Load-bearing double-casts work around node-ical's untyped shape and violate the "avoid any" standard.
**Fix:** Define `interface ExtendedVEvent extends VEvent { uid?: string; datetype?: string; status?: unknown; categories?: string[] | string; 'x-livewhale-id'?: string }` and cast once to it. Apply the same pattern in `calbears.ts`.

### #34 — Accidental `.mjs` vs `.ts` split in `scripts/lib` (P3)
**File:** `scripts/lib/feedHealthPolicy.mjs:1` (and `sourceCoveragePolicy.mjs`)
**Problem:** The policy files bypass TypeScript and duplicate type-significant constants with no `SourceName` constraints.
**Fix:** Convert both to `.ts` with type annotations. The `*.test.mjs` files import them via tsx and will keep working.

---

## Tier 7 — Test coverage

### #27 — `dedupe.test.mjs` only covers 2 cases (P2)
**File:** `scripts/tests/dedupe.test.mjs:34`
**Fix:** Add tests for (1) two same-priority sources for the same event, asserting deterministic winner; (2) same title on different dates not deduped; (3) `normalizeForDedupe` stopword behavior.

### #28 — `ics-export.test.mjs` has no escaping assertion (P2)
**File:** `scripts/tests/ics-export.test.mjs:26`
**Fix:** Add a test with semicolons, commas, backslashes, and newlines in the title/description, asserting `escapeIcsText` emits `\;` `\,` `\n` and no raw newlines break the property line.

### #29 — `search-quality.test.mjs` inlines its own stemmer (P2)
**File:** `scripts/tests/search-quality.test.mjs:36`
**Problem:** The test re-implements `stem`/`tokenize` (lines 36-97), so it can silently diverge from production. The stemmer must stay consistent between `buildIndex.ts` and `searchEngine.ts`.
**Fix:** Import `stem`/`tokenize` from `utils/textUtils.ts` instead of inlining them.

### #30 — `stability.test.mjs` uses `typeof`-only checks (P2)
**File:** `scripts/tests/stability.test.mjs:97`
**Fix:** Strengthen the per-event loop: assert `id.length > 0`, `title.length >= 2`, `url` starts with `http`, `source` is a known `SourceName`, and `tags[0]` is one of the six frontend categories.

### #39 — `categorization.test.mjs` skips the catch-all branch (P3)
**File:** `scripts/tests/categorization.test.mjs:86`
**Fix:** Add a test for the zero-score "Student Life" fallback (generic title, generic organizer, no categories) guarding `normalize.ts`.

### Security test gap (add even though security found no bug)
**File:** `scripts/lib/schema.ts:34` (`HttpUrlSchema`)
**Problem:** The entire client XSS posture rests on `HttpUrlSchema` rejecting non-`http(s)` schemes, but nothing tests it.
**Fix:** Add a test asserting `HttpUrlSchema` rejects `javascript:`, `data:`, and `vbscript:`. Optionally add an ingest-to-publish test feeding a malicious payload and asserting the published entry is clean.

---

## Tier 8 — Lower-priority, UX, and docs

### #31 — Date labels compute "today" independently of the synced key (P3)
**File:** `utils/eventDates.ts:256`
**Fix:** Thread the synced `todayKey` from `usePacificDateKeys` into `dateGroupLabel` / `formatRelativeEventDate` so rendered labels agree with the date-range filter that selected the events.

### #41 — `StaleDataBanner` has no dismiss (P3)
**File:** `components/StaleDataBanner.tsx`
**Problem:** The degradation banner is undismissable, unlike `StatusBanner` (which got a dismiss + sessionStorage in UX-audit fix L4).
**Fix:** Add an `onDismiss` prop and persist dismissal to `sessionStorage`, keyed by banner content, matching `StatusBanner`.

### Still-open UX-audit items (from `docs/ux-audit-2026-04-21.md`)
- **H6:** Mobile filter bar uses `no-scrollbar` (`components/FiltersBar.tsx:117`). On a narrow phone the rightmost pills can be cut off with no affordance. Desktop got `scrollbar-thin`; mobile did not.
- **M5:** "Upcoming" filter label is ambiguous. Consider a tooltip or clearer copy.
- **L3:** Footer "I'm Akhil" framing may reduce perceived trust for a public utility.

### Privacy note (documented, no in-app disclosure)
The GA4 measurement ID is public, and raw search queries are sent to GA4 (`utils/analytics.ts:143`). This is expected for the feature. If the site is a public student utility, add a one-line footer disclosure so behavior and policy match.

---

## Security posture to preserve (do not weaken)

Security review found no exploitable issues. These controls are load-bearing. Keep them intact when changing adapters or rendering:

1. **Every adapter must call `CanonicalEventSchema.safeParse` and push only `validated.data`.** A new adapter that skips this reopens the XSS path.
2. **`HttpUrlSchema` (`scripts/lib/schema.ts:34`) is the XSS linchpin.** It rejects non-`http(s)` URLs, so `javascript:` cannot reach the `href={event.url}` sinks React does not block (`components/EventGrid.tsx:100`, `components/EventDetailOverlay.tsx:99` and `:199`).
3. **External text renders through `sanitizePlainText`** and as React children (auto-escaped). There is no `dangerouslySetInnerHTML` anywhere. Keep it that way.
4. **`escapeIcsText`** neutralizes ICS control characters in SUMMARY/DESCRIPTION/LOCATION. The `URL:` line is unescaped but safe only because the value is always a schema-validated `http(s)` URL. If event URLs ever come from user input, escape that line too.

---

## Suggested execution order

1. Tier 1 bugs: #1, #16, #12 (ask about #12 first).
2. Tier 2 quick wins: #17, #40, #10, #11, #5, #7, #18, #35, #42-44.
3. Tier 3 search perf: #2, #3, #4 together, then #6, #8.
4. Tier 4 pipeline: #9, #14, #13, then #33, #32, #15.
5. Tiers 5-8 as capacity allows.

Run `npm run validate`, `npx tsc --noEmit`, and `npm run build` after each tier. Add the test from each `Verify` line in the same change as its fix.
