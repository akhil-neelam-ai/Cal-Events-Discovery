# Code Review Findings — topic filter layer

**Date:** 2026-09-04
**Scope:** `feat/topic-filter-layer` vs `main`, merged as [PR 173](https://github.com/akhil-neelam-ai/Cal-Events-Discovery/pull/173).
**Verdict:** Ready with fixes. 0 P0. 12 findings fixed in PR 173 (F1–F12). Leftover #1–#23 implemented on `feat/topic-filter-review-fixes`. Decisions used: successful empty assignments are authoritative; broad identity mappings dropped; breadth cap stays 200; discovery versions bumped to 1.2.0.
**Method:** 12 reviewer passes (correctness, testing, maintainability, project-standards, agent-native, learnings, security, performance, api-contract, reliability, adversarial, frontend-races). Security found nothing exploitable.
**HEAD at review close:** `b3db627` on `main`. Re-locate by symbol if line numbers drift.

---

## How to use this document (for the coding agent)

1. **F1–F12** already landed in PR 173. Do not redo them. They are here so the review is complete.
2. Work leftover **#1–#23** top to bottom. Do not re-implement the topic layer. It is already on `main`.
3. Each item has `Problem`, `Fix`, and `Verify`. Follow the `Fix` unless the surrounding code says otherwise.
4. Four leftover items need a human decision: **#5** (empty assignment carry-forward), **#6** (identity mappings), **#18** (breadth cap), **#21** (API version bump). Ask, or follow the recommended default and flag the choice.
5. After each leftover tier, run `npm run validate`. Do not mark a tier done until that passes.
6. Topic-quality checks stay outside `npm run validate`. Run `npm run test:topic-quality` only as an advisory suite.
7. Do not route topic failures through `degraded_sources`. That flag drives visitor banners.
8. The June full-repo audit is a different document: `docs/code-review-2026-06-02.md`.

---

## Fixed in PR 173

### F1 — Topic-quality checks blocked the daily publish (P1)
**Files:** `package.json:20`, `scripts/tests/publish-guards.test.mjs:152`
**Status:** Fixed.
**Problem:** `test:scripts` excluded only `search-quality.test.mjs`. `runScriptTests.mjs` then ran `topic-quality.test.mjs` inside `npm run validate`. The daily workflow treats `validate` as a hard gate before a second topic-quality step marked `continue-on-error`. A seasonal count or frozen-AI-reference miss would abort the artifact PR and open `pipeline-failure`. The August publish-first policy forbids that for corpus quality.
**Fix:** Add `--exclude=topic-quality.test.mjs` to `test:scripts`. Keep `npm run test:topic-quality` as the advisory command. Guard both live-corpus suites from `validate`.
**Verify:** `scripts/tests/publish-guards.test.mjs` asserts `topic-quality.test.mjs` is not reachable through `validate` / `test:scripts`. `npm run validate` stays green if topic-quality would fail.

### F2 — No-index searches skipped empty-topic fallback (P2)
**File:** `utils/searchEngine.ts` (former early return near line 999)
**Status:** Fixed.
**Problem:** A pure topic query strips to zero residual tokens. When `search-index.json` was still loading or missing, an early return exited before the empty-pool fallback. Users saw an unexplained empty list. The same query broadened once the index arrived.
**Fix:** Delete the early return. Let `runScoring` handle a zero-token plan, then run the common fallback block.
**Verify:** `scripts/tests/search-engine-runtime.test.mjs` has `pure-topic empty pools broaden without a search index`.

### F3 — Popstate rejected valid topics while the vocabulary loaded (P3)
**File:** `hooks/useUrlStateSync.ts:103`
**Status:** Fixed.
**Problem:** Initial URL parse treated `allowedTopics === null` as provisional. The popstate handler passed `allowedTopicSlugs ?? []`, which rejects every topic. Back or Forward during a slow feed load cleared a valid topic and rewrote the URL.
**Fix:** Pass `allowedTopicSlugs` through as null. Rely on the post-load validation effect.
**Verify:** `tests/App.ui.test.tsx` covers popstate with a delayed feed and a valid topic.

### F4 — Topic auto-clear closed an open event detail (P2)
**File:** `App.tsx:211`
**Status:** Fixed.
**Problem:** Category, source, and date changes leave an open detail alone. Automatic topic cleanup called `setSelectedEventId(null)`, so a filter change that also zeroed the topic closed the overlay a tick later.
**Fix:** Clear only `filters.topic`. Keep detail visibility tied to dataset membership.
**Verify:** `tests/App.ui.test.tsx` keeps an open detail through topic auto-clear.

### F5 — Published agent guidance omitted topic from shared URL state (P2)
**Files:** `public/.well-known/agent-skills/search-events/SKILL.md`, `public/.well-known/agent-skills/share-event/SKILL.md`, `public/for-agents.html`, `public/.well-known/agent-card.json`, `agent/webmcpTools.ts` descriptions
**Status:** Fixed.
**Problem:** Runtime tools accepted `topic`. Search, share, apply, and for-agents copy still listed only q/date/category/source. An agent following those docs opened a broader UI than the result set it just returned.
**Fix:** Add `topic` to apply/share instructions. Point slugs at `events.json.topic_vocabulary.topics`. Regenerate changed skill digests.
**Verify:** `scripts/tests/agent-readiness.test.mjs` asserts topic on the search skill, share skill, agent card, for-agents page, and WebMCP descriptions.

### F6 — `theatre` locked the Arts category (P2)
**Files:** `utils/searchEngine.ts` Arts pattern, `scripts/lib/topics.ts:123`
**Status:** Fixed.
**Problem:** American `theater` was removed from category intent. British `theatre` stayed in the Arts pattern and was missing from search synonyms. `buildSearchPlan("theatre")` returned the whole Arts category (hundreds of events) instead of Theater and Dance.
**Fix:** Move `theatre` into the Theater and Dance synonym list. Remove it from the Arts category pattern.
**Verify:** Runtime test: `theatre` resolves to Theater and Dance, not Arts.

### F7 — OpenAPI left `topic_vocabulary` optional (P2)
**File:** `public/openapi.json:25`
**Status:** Fixed.
**Problem:** `PublishedEventsPayloadSchema` requires `topic_vocabulary`. The public OpenAPI response required only `events`, `sources`, and `lastUpdated`. Generated clients modeled the slug source of truth as optional.
**Fix:** Add `topic_vocabulary` to the `/events.json` required array. Keep per-event `topics` optional for cached pre-topic rows.
**Verify:** Agent-readiness asserts `eventsSchema.required` includes `topic_vocabulary`.

### F8 — Status contract hid topic-assignment health (P2)
**Files:** `public/openapi.json:80`, `public/.well-known/agent-skills/event-feed-status/SKILL.md`, `public/.well-known/mcp/server-card.json`
**Status:** Fixed.
**Problem:** `status.json` has a required `topics` block (`outcome`, counts, optional `error`). OpenAPI and the feed-health skill omitted it. A client could call the feed healthy while topic data was carried forward after an assignment error.
**Fix:** Add `TopicAssignmentStatus` to OpenAPI. Require `topics` on `/status.json`. Document that topic errors are not source degradation.
**Verify:** Agent-readiness asserts `topics.outcome`, `topics.carried_forward_count`, and the source-health split.

### F9 — `llms-full.txt` example omitted `topic_vocabulary` and topic status (P2)
**File:** `public/llms-full.txt`
**Status:** Fixed.
**Problem:** The expanded events example stopped at `lastUpdated`. Status guidance listed source health only. Agents following that file would miss the required vocabulary block and would not report `topics.outcome`.
**Fix:** Add `topic_vocabulary` to the events example. Document `topics.outcome`, counts, and `topics.error`. Say a topic error does not degrade a source.
**Verify:** Agent-readiness matches `topics.outcome`, `topics.carried_forward_count`, and `"topic_vocabulary"` next to `lastUpdated` in `llms-full.txt`.

### F10 — Topic-free WebMCP state calls loaded the full event corpus (P2)
**File:** `agent/webmcpTools.ts` (`allowedTopicsIfNeeded`)
**Status:** Fixed.
**Problem:** `get_ui_state`, `build_calevents_url`, and `apply_ui_state` always fetched `events.json` (~1.7MB) to read 20 slugs. Topic-free URL work paid that cost on every call.
**Fix:** Fetch the corpus only when the current URL or input has a topic. Pass an empty allow-list otherwise.
**Verify:** `scripts/tests/webmcp-tools.test.mjs`: topic-free get/build/apply make zero `/events.json` fetches. A later build with a topic fetches once.

### F11 — Published topic-presence assertion was vacuous (P2)
**File:** `scripts/tests/topic-quality.test.mjs:130`
**Status:** Fixed.
**Problem:** The check used `event.topics ?? []`, then asserted `Array.isArray`. A publish that omitted `topics` on every event still passed.
**Fix:** Assert `Object.hasOwn(event, "topics")` and `Array.isArray(event.topics)` on the generated artifact.
**Verify:** The presence assertion is in `published topic assignments are valid, bounded, and represented`.

### F12 — Agent-readiness did not lock topic filter parity (P2)
**File:** `scripts/tests/agent-readiness.test.mjs`
**Status:** Fixed.
**Problem:** Tests checked that discovery files existed. They did not check that search, share, apply, OpenAPI, and status docs all expose topic the same way. Docs could drift again.
**Fix:** Add assertions for topic in apply/share copy, required `topic_vocabulary`, required status `topics`, and `llms-full.txt` status fields.
**Verify:** `npm run validate` runs those agent-readiness tests.

---

## Leftover

Implementation note (2026-09-04): leftover #1–#23 are implemented on `feat/topic-filter-review-fixes`.

## Tier 1 — Real bugs (fix first)

### #1 — Explicit WebMCP topic intersects a different inferred topic (P1)
**Status:** Fixed.
**File:** `agent/webmcpTools.ts:371`
**Problem:** `search_berkeley_events` prefilters by `input.topic`, then calls `searchEvents` with the raw query. If the query infers a different topic, both filters apply. The UI dismisses the inferred topic when a chip is selected (`hooks/useEventBrowserState.ts:164-175`). `topic=law` plus `query=AI` therefore returns only Law+AI co-tags for agents, while the page returns Law events ranked by AI text.
**Fix:** Build the query plan first. When a validated explicit topic differs from the inferred topic, pass `topic:<inferred-slug>` in `dismissedKeys`, matching the UI.
**Verify:** Indexed and no-index WebMCP tests: `topic=law`, `query=AI` must match the UI result IDs and fallback flag.

### #2 — Missing search index plus Fuse cap auto-clears a valid topic (P1)
**Status:** Fixed.
**File:** `hooks/useEventBrowserState.ts:298`
**Problem:** An explicit `filters.topic` is applied after `searchEvents` ranks the category/source pool. Without an index, Fuse keeps 100 hits. If 101 stronger non-Law matches precede a Law match, Law counts as zero and auto-clear removes a valid URL topic.
**Fix:** Apply the explicit topic to the search pool before scoring and Fuse truncation. Compute availability from a separate pre-topic pool.
**Verify:** UI test with 101 equal non-Law hits and one Law hit, `searchIndex === null`, `topic=law`. The Law event stays and the topic is not cleared.

### #3 — Popstate auto-clear races the query debounce (P1)
**Status:** Fixed.
**Files:** `hooks/useEventBrowserState.ts:309` and `App.tsx:167`
**Problem:** History writes query and topic at once. The browser hook still sees the previous query for 140ms. Auto-clear runs on a zero-delay timer and can drop a valid restored topic against that stale query.
**Fix:** Skip topic auto-clear while `debouncedSearchQuery !== filters.searchQuery`, or set the debounced query immediately on history apply.
**Verify:** App test that popstates from `?q=AI` to `?q=law&topic=law` and keeps Law.

### #4 — Invalid assignment arrays escape the recovery boundary (P1)
**Status:** Fixed.
**File:** `scripts/lib/topicAssignmentResilience.ts:70`
**Problem:** Only thrown assigners are caught. A return of four slugs, duplicates, or an unknown slug is stored as `outcome: ok`. `PublishedEventsPayloadSchema.parse` later rejects the payload and the daily job exits with no topic error status.
**Fix:** Validate each assigner result inside the try block: array of 0 to 3 unique known slugs. Treat any violation as a stage error and carry prior topics.
**Verify:** Publish-guard tests for four-slug, duplicate, unknown-slug, and non-array returns. Each must set `topics.outcome` to `error` and still produce a publishable snapshot.

### #5 — Successful empty assignment keeps yesterday's topic (P1)
**Status:** Fixed.
**File:** `scripts/lib/topicAssignmentResilience.ts:87`
**Decision needed:** R2 says an unconfident event carries no topic. R5 limits carry-forward to assignment failure or timeout. The current code copies prior topics whenever the assigner returns `[]` and still reports `outcome: ok`. The plan text broadened this; the requirements did not.
**Recommended default:** A successful `[]` is authoritative. Carry prior topics only on the caught failure path.
**Problem:** After a rule fix, a formerly mistagged event can never drop the old slug. Status stays `ok`, so nothing alerts.
**Fix:** If the recommended default is accepted, publish `[]` on success and delete the successful-empty carry-forward test that locks the old behavior. If sticky topics stay, add an expiry or version rule and a data-quality alert. Do not silently keep `ok`.
**Verify:** A fixture event with yesterday's `ai-machine-learning` and a successful `[]` today publishes `topics: []` (default) or a documented stale outcome (alternate).

### #6 — Container identity assigns topics without event evidence (P1)
**Status:** Fixed.
**File:** `scripts/lib/topics.ts:360`
**Decision needed:** Which organizers, groups, and sources are homogeneous enough to assign a topic with no title or description match?
**Recommended default:** Drop broad mappings. Keep identity weights only for containers that are one subject (for example Berkeley AI Risk → AI). Require title, source-category, or other event-level evidence for Chemistry, BAMPFA, Cal Performances, Haas, Library, and broad Engineering units.
**Problem:** Organizer weight 50, source weight 70, and group weight 100 all clear the floor of 20. The shipped artifact tags Chemistry seminars as `biology-life-sciences`, Haas hikes as `startups`, and BAMPFA cafe-hour notices as Film and Visual Arts. That fails R4 (nine in ten clearly relevant).
**Fix:** Remove or raise the floor for the broad mappings. Regenerate `public/events.json`. Add independent negative samples (Haas hike, cafe hours, Organic Chemistry Seminar) that must not receive those slugs.
**Verify:** `npm run test:topic-quality` after new labeled negatives. Spot-check the three examples above in the regenerated artifact.

### #7 — Last-good restore recomputes topics from a stripped legacy row (P1)
**Status:** Fixed.
**File:** `scripts/updateEvents.ts:577`
**Problem:** `assignmentSources` is filled only for fresh canonical events, before last-good rows are appended. A restored LiveWhale event falls through to the legacy row, which has no `livewhale_groups`. A partial text assignment then overwrites yesterday's topic set while `topics.outcome` stays `ok`.
**Fix:** Track fallback-restored IDs and keep their existing `topics` arrays. Do not reassign those rows from the legacy projection.
**Verify:** Publish-guard test: a last-good LiveWhale event with group-derived topics keeps that exact array when the live adapter fails.

---

## Tier 2 — Search and UI mismatches

### #8 — Auto-clear leaves the query-inferred topic on (P2)
**Status:** Fixed.
**File:** `App.tsx:211`
**Problem:** `clearUnavailableTopic` clears only `filters.topic`. If the query still infers that topic, the next render reapplies the hard filter while the notice says the topic was cleared.
**Fix:** Also add `topic:<slug>` to `dismissedInterpretationKeys` in the auto-clear path.
**Verify:** App test for `?q=AI&topic=ai-machine-learning` plus a category or source with no AI-topic events. After auto-clear, the inferred AI filter is gone and AI is ranking text only.

### #9 — UI date buckets run after topic fallback (P2)
**Status:** Fixed.
**File:** `hooks/useEventBrowserState.ts:200`
**Problem:** `searchEvents` sees every date. A future AI event keeps the topic pool non-empty. The later Today bucket can then be empty, with no fallback and no auto-clear for a typed topic.
**Fix:** Evaluate inferred-topic emptiness against the active date/source/category pool, or run topic fallback after the date partition.
**Verify:** Typed `AI` with an AI event next month and only non-AI events today. Today must broaden or explain, not show a silent empty list.

### #10 — WebMCP date bounds run after topic fallback (P2)
**Status:** Fixed.
**File:** `agent/webmcpTools.ts:398`
**Problem:** Same order bug as #9 on the agent path. `query=AI` plus `datePreset=today` can return zero when the only AI event is tomorrow.
**Fix:** Apply explicit date bounds to the candidate pool before topic fallback, and keep the existing date-intent broadening rules.
**Verify:** Shared UI and WebMCP fixture: AI tomorrow, Law today, `query=AI`, `datePreset=today`.

### #11 — Inferred-topic counts disable replacement chips (P2)
**Status:** Fixed.
**File:** `hooks/useEventBrowserState.ts:288`
**Problem:** R10 and R12 say a clicked topic replaces typed topic intent. Counts are taken from results that already have the inferred topic applied. A Law event that matches AI as text but is not tagged AI shows count 0, so the Law chip is disabled.
**Fix:** Count availability from a search with the inferred topic dismissed and restored as ranking text. Keep date, source, category, and residual query.
**Verify:** App test: query `AI`, a Law-only event with AI in the description. Law stays enabled and selecting it overrides AI.

### #12 — Dismissing a topic interpretation does not clear an explicit topic (P2)
**Status:** Fixed.
**File:** `hooks/useEventBrowserActions.ts:93`
**Problem:** R14 says the interpretation dismiss is the same clear as clicking the active chip. `handleDismissChip` only records a dismissed key. `filters.topic` and the URL stay set.
**Fix:** Route `topic:<slug>` dismissal through the same state transition as `handleTopicChange` when that slug is the active topic.
**Verify:** App test for `q=AI&topic=ai-machine-learning`. Dismissing the interpretation chip clears the chip, the URL topic, and the hard filter together.

### #13 — `free lunch` never becomes Free Food (P2)
**Status:** Fixed. Free Food is no longer a topic. Search may still match “free lunch” / “free food” as text or the Free filter; those queries must not set a category chip.
**File:** `utils/searchEngine.ts:324`
**Problem:** Afternoon detection strips `lunch` before topic detection. `buildSearchPlan("free lunch")` yields `timeOfDay: afternoon` and no topic, even though `free lunch` is a published Free Food synonym. Topic stripping also drops standalone `free` from `free concert` / `free workshop` / `free screening`.
**Fix:** Claim multiword topic phrases before `RE_AFTERNOON`, or exempt `lunch` when it is part of `free lunch`. After topic strip, recognize leftover `free` unless the topic is already Free Food.
**Verify:** Search-plan tests: `free lunch` is not a topic; `free concert` keeps free plus the concert topic; neither sets `filters.category`.

### #14 — Topic word order changes hard filters (P2)
**Status:** Fixed.
**File:** `utils/searchEngine.ts:389`
**Problem:** Only the first topic span is stripped. `AI free food` becomes AI plus a free filter. `free food AI` becomes Free Food with AI as ranking text. R12 says first topic wins and later topic words stay ranking text.
**Fix:** Protect unselected topic-synonym spans from later detectors, and leave those spans in the ranking text.
**Verify:** Both orders set the first topic only. The other phrase is ranking text, not a second hard filter.

### #15 — Auto-clear flashes an empty grid (P3)
**Status:** Fixed.
**File:** `hooks/useEventBrowserState.ts:298`
**Problem:** The first render applies a topic already known to have count zero. A later timer clears it. The grid records an empty ID set and replays card animation on recovery.
**Fix:** Derive an effective render topic that is empty as soon as availability is ready and the count is zero. Use the effect only to persist the clear and show the notice.
**Verify:** UI test that a doomed topic never produces an empty intermediate result list.

---

## Tier 3 — Quality gates and docs

### #16 — Precision test compares the assigner with itself (P1, quality)
**Status:** Fixed.
**File:** `scripts/tests/topic-quality.test.mjs:169`
**Problem:** The test named precision samples every 97th event and compares published topics to `assignTopics(event)`. Systematic false positives pass. This is determinism, not R4.
**Fix:** Add frozen, independently labeled positive and negative samples for every topic. Assert at least 90% precision without calling `assignTopics` to build the expected labels.
**Verify:** A Haas hike labeled "not startups" fails the suite if the assigner still tags it.

### #17 — Live AI search asserts 50 hits, not reference overlap (P1, quality)
**Status:** Fixed.
**File:** `scripts/tests/search-engine-runtime.test.mjs:524`
**Problem:** AE1 is written as 50 of the 56 AI reference events. The test only checks `results.length >= 50`. Homonyms can pad the count.
**Fix:** Assert the intersection of result IDs with the 56-item reference set meets the stated floor. Move known homonyms to explicit negatives.
**Verify:** A 51-result run that overlaps only 43 reference IDs fails.

### #18 — Breadth cap is 200, written target is about 150 (P2)
**Status:** Fixed.
**File:** `scripts/tests/topic-quality.test.mjs:156`
**Decision needed:** Keep 200, or enforce ~150 and split or retune Law and Economics and Policy (181 and 170 in the review artifact).
**Recommended default:** Keep 200 until identity mappings in #6 shrink the fat chips. Then set the cap to the number you actually mean and tune to it.
**Fix:** Put the chosen cap in the test and in the requirements doc so they match.
**Verify:** The test fails when any topic exceeds the chosen cap.

### #19 — Search planning ignores the published vocabulary (P2)
**Status:** Fixed.
**File:** `utils/searchEngine.ts:17`
**Problem:** R17 says `events.json.topic_vocabulary` is the one list every surface reads. `buildSearchPlan` imports bundled `TOPICS`. URL and WebMCP validation read the fetched block. A mixed deploy can infer a slug the page will not accept.
**Fix:** Pass the loaded topic definitions into search-plan construction for the UI and WebMCP. Check `topic_vocabulary.version` against the bundle if you keep a compile-time fallback.
**Verify:** A fixture vocabulary that drops a synonym stops the UI and WebMCP from inferring that slug.

### #20 — `searchEngine.ts` is past 1,000 lines (P2, maintainability)
**Status:** Fixed.
**File:** `utils/searchEngine.ts:214`
**Problem:** Topic intent tables and `buildSearchPlan` landed in the same file as scoring and fallback. The file is hard to change without collisions.
**Fix:** Move intent patterns, `buildSearchPlan`, and dismissed-key rebuild into a search-intent module. Keep pool filtering, scoring, and fallback behind the current `searchEvents` API.
**Verify:** Existing search-engine runtime tests stay green with no public API change.

### #21 — Public discovery versions still say 1.1.0 (P2)
**Status:** Fixed.
**Files:** `public/openapi.json:5`, `public/.well-known/mcp/server-card.json`, `public/.well-known/agent-card.json`
**Decision needed:** Bump the three documents together to 1.2.0 for the additive topic contract?
**Recommended default:** Yes. The last additive WebMCP set went 1.0.0 → 1.1.0 in the same three files.
**Fix:** Set all three to 1.2.0. Add an agent-readiness check that they stay equal.
**Verify:** Agent-readiness fails if any one of the three versions drifts.

### #22 — Legacy payload without vocabulary leaves a topic link stuck (P2)
**Status:** Fixed.
**File:** `App.tsx:100`
**Problem:** A successful load with no `topic_vocabulary` leaves `allowedTopicSlugs` null, which is the same sentinel as "still loading." A `?topic=law` link stays provisional. Legacy events have no `topics`, so the page stays empty.
**Fix:** Distinguish "feed still loading" from "loaded, no vocabulary." After a successful load, reject topic links against an empty allow-list or fall back to text search.
**Verify:** UI test that loads a pre-topic `events.json` with `?topic=law` and does not keep an empty hard filter.

### #23 — LiveWhale group-feed failures drop assignment provenance (P2)
**Status:** Fixed.
**File:** `scripts/sources/livewhale.ts:397`
**Problem:** `fetchGroupFeed` swallows every error and returns `{}`. If the main feed succeeds and every department feed fails, LiveWhale still looks healthy. Assignment then runs without `livewhale_groups`, can replace group-derived topics, and reports `topics.outcome: ok`.
**Fix:** Return group-fetch health. When that input is degraded, mark the topic stage as error and carry prior topic sets. Do not set visitor-facing degraded-source flags.
**Verify:** Adapter or publish-guard test: main feed ok, all group feeds fail → topic status error, prior topics kept, `degraded_sources` unchanged.

---

## Residual risks (no ticket in this document)

- The browser never compares `topic_vocabulary.version` with the bundle's `TOPICS` version.
- `collapseMultiDay` keeps only the earliest row's `livewhale_groups`.
- Assignment is synchronous in the orchestrator. A hang is not converted into carry-forward.
- `loadExistingEvents` turns any read or parse error into an empty prior snapshot, so a paired assignment failure loses all carry-forward topics.

---

## Suggested fix order

1. #5 decision, then #4 and #7 (publish stays safe when assignment misbehaves).
2. #6 decision, then regenerate the artifact and land #16 / #17 / #18.
3. #1, #8, #11, #12 (one effective-topic policy for UI and WebMCP).
4. #2, #3, #9, #10, #15 (order and timing).
5. #13, #14, #19, #20 (search intent).
6. #21, #22, #23 (docs and provenance).
