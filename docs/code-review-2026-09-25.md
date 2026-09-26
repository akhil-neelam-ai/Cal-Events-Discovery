# Code review findings: full-repo audit, September 2026

**Date:** 2026-09-25
**Scope:** The whole repository at `e97f7ad` on `main`: pipeline, adapters, search, UI, agent surfaces, CI. Not a single diff.
**Verdict:** 0 P0, 2 P1, 14 P2, 19 P3. The publish guards and CI gates work. Both P1 bugs sit on the main search path, and each has a small fix.
**Baseline:** `npm run validate` passes: 229 script tests and 38 UI tests.
**Method:** One manual pass over every non-generated file, about 29k lines. The compound-engineering multi-reviewer command was not installed in this session. Findings were reproduced with the real code against the committed `public/` artifacts, stubbed `fetch`, and jsdom. Live-source claims come from the 2026-09-25 Actions log (run 36155950548) and 60 days of committed `status.json`. Berkeley endpoints were blocked from the review sandbox.

---

## How to use this document (for the coding agent)

1. Work the tiers top to bottom. #1, #7, and #8 are small and visible, so start there.
2. Each entry has `Problem`, `Fix`, and `Verify`. Follow the `Fix` unless the surrounding code says otherwise.
3. Four items need a human decision: #2, #11, #19, and #26. Ask, or take the recommended default and flag it.
4. #6 and #24 change indexing. Regenerate `public/search-index.json` in the same PR. A small script that rebuilds the index from the committed `events.json` avoids waiting for the cron.
5. Keep non-source problems out of `degraded_sources`. That field drives visitor banners (AGENTS.md). #11 and #16 must respect it.
6. Run `npm run validate` after each tier.
7. Line numbers are from `e97f7ad`. Re-locate by symbol if they drift.
8. The June audit and the topic-filter review are separate passes. Their status is near the end.

---

## Tier 1: Search and browse bugs (fix first)

### #1. Enter replaces the typed query with the first suggestion (P1)

**Status:** Fixed. No option is active until the user arrows or hovers onto one, and suggestions show only while the input is empty. Covered by `tests/searchCombobox.test.tsx`.
**Files:** `hooks/useSearchCombobox.ts:23` and `:54-56`, `components/DesktopHero.tsx:36` and `:184`, `components/MobileHeader.tsx:24` and `:138`
**Problem:** The suggestion list opens whenever the input has focus (`isSuggestionsOpen = searchFocused`). `POPULAR_SEARCHES` keeps it from ever being empty. `activeIndex` starts at 0. On Enter the hook calls `preventDefault()` and selects `suggestions[0]`. Type "robotics", press Enter, and the search becomes "AI". With search history, it becomes the last recent search instead. The headers' own Enter handlers never run. On phones the keyboard's Search key sends Enter, so this is the normal way to submit.
**Evidence:** A throwaway jsdom test typed `robotics{Enter}` into both headers. Both ended with the input reading "AI". No committed test covers Enter.
**Fix:** Start `activeIndex` at -1. Select on Enter only after the user moves with the arrow keys. Hide the recent and popular lists once the query is non-empty, as most comboboxes do.
**Verify:** Add a UI test for both headers: type a query, press Enter, and assert the input still holds it. Add a second test where ArrowDown then Enter selects the first suggestion.

### #2. Category words erase the query (P1)

**Status:** Fixed. The decision was plain search text, which differs from the default below. Only category names such as "arts" or "sports" lock a category. Subject words never do. "basketball" now returns 83 rows, and every one mentions basketball. "hackathon" shows the no-results state. A dismissed chip searches the words that set it. Covered by `scripts/tests/search-engine-runtime.test.mjs` and a golden check in `scripts/tests/search-quality.test.mjs`.
**Files:** `utils/searchIntent.ts:417-424` (strip at `:421`), `utils/searchIntent.ts:65-87`, `utils/searchIntent.ts:488-505`, `scripts/tests/search-engine-runtime.test.mjs:764` and `:843`, `AGENTS.md:83`
**Problem:** Commit `4664a0b` (2026-09-04) made the category detector strip its matched words. A subject word such as "tennis" now sets the Sports filter and leaves no keywords. `runScoring` then returns the whole category in date order. AGENTS.md:83 still says the category branch does not strip, and calls that asymmetry load-bearing.
**Evidence (2026-09-25 corpus):**

| Query | Filter set | Results | Results that mention the word |
|---|---|---|---|
| hackathon | Science & Tech | 185 | 0 |
| tennis | Sports | 319 | 46 |
| basketball | Sports | 319 | 83 |
| seminar | Academic | 461 | 113 |
| lecture | Academic | 461 | 39 |
| gallery | Arts | 212 | 4 |

"tennis" and "basketball" return the same 319 rows in the same order. "hackathon" shows 185 unrelated talks and no empty state. Dismissing the Sports chip searches the chip label "Sports", not "basketball". The test at `:764` asserts that a basketball query returns a baseball event. The golden suite checks only category membership, so it stays green. Its "basketball does not substitute baseball" check passes only because no baseball is scheduled in the fall.
**Decision needed:** Restore the documented behavior, or keep stripping and change AGENTS.md?
**Recommended default:** Restore it for subject words. Split `CATEGORY_PATTERNS` in two. Category names ("academic", "arts", "sports", "science & tech", "student life", "entrepreneurship", "athletics") set the filter and strip. Subject words ("basketball", "tennis", "seminar", "lecture", "gallery", "exhibit", "hackathon", "coding") set the filter and stay as ranking text.
**Fix:** Apply the split. Rewrite the test at `:764` for the new behavior. The test at `:843` covers a pure category name and stays valid. Make `withDismissedInterpretations` restore the user's words, not the chip label.
**Verify:** Add golden assertions on the live corpus for "tennis", "seminar", and "hackathon". Each top 5 must contain the query word, or the search must show an explained empty state.

### #3. Multi-day events drop out of date views (P2)

**Status:** Fixed. `occurrenceDateKeys` and `firstOccurrenceInRange` in `utils/eventDates.ts` now drive the UI buckets, the weekend filter, recency, and the agent date bounds. Lists sort and group by the first day of the active view. The unused `filterEventsByDateRange` is gone. On the 2026-09-25 snapshot, Tomorrow gains all 12 missing exhibits. The next morning keeps all 32 multi-day events instead of 20. The agent docs for `dates` stay with #20.
**Files:** `hooks/useEventBrowserState.ts:52-75`, `utils/eventDates.ts:321-348`, `utils/searchEngine.ts:328-333`, `agent/webmcpTools.ts:174-184`
**Problem:** Every date filter reads `event.date` only. For a collapsed multi-day event, `date` is its earliest upcoming day at publish time, and `dates[]` holds the rest. So an exhibit running today and tomorrow is missing from Tomorrow. The morning is worse. From midnight until the day's publish lands, `date` is yesterday, and `partitionDateBuckets` drops the event from every view, including All Events. When the cron fails, that lasts all day. The weekend filter and the agent's date bounds have the same gap.
**Evidence:** In the 2026-09-25 snapshot, 12 of 32 multi-day events occur tomorrow but are absent from Tomorrow. One is the BAMPFA exhibition "Private Frontiers" with 80 dates. The same 12 vanish from every view on the morning of 2026-09-26 until the next publish.
**Fix:** Add one shared helper that answers "does this event occur on day K" and "does it occur in [start, end]" from `dates ?? [date]`. `hasFutureOccurrence` in `scripts/lib/lastGoodFallback.ts:52-70` already covers the upcoming case. Use the helper in all four places. Group and label each event by its first occurrence inside the active range, not by `date`.
**Verify:** A fixture with `date` set to yesterday and `dates` of yesterday, today, and tomorrow. It shows in Today, Tomorrow, This Week, and All Events. The agent returns it for `datePreset: "tomorrow"`.

### #4. In-progress multi-day events are dropped at ingest (P2)

**Status:** Fixed. All 8 adapters now drop an event only after its last day, through `endedBeforePT` in `scripts/lib/normalize.ts`. A bare all-day end is exclusive, and a timed end before 6 AM counts as the night before. `withSpanOccurrences` gives a kept span one `dates` entry per remaining day, capped at 120, with today as its `date`. Dedupe keys a span on that day too. Covered by `scripts/tests/multi-day-spans.test.mjs`, with stubbed LiveWhale and Tribe feeds.
**Files:** `scripts/sources/livewhale.ts:618-624`, the same start-date check in `tribe.ts:207-216`, `callink.ts:194-203`, `luma.ts:233-243`, `simons.ts:108-116`, `calbears.ts:163-167`, `bampfa.ts:352-356`, and `cal_performances.ts:210-214`, plus `scripts/lib/normalize.ts:451-459`
**Problem:** Adapters drop any event whose start date is before today, whatever its end date. The LiveWhale comment says in-progress multi-day events are kept, but the code drops them. A single VEVENT that spans days survives only on its first day. `projectToLegacy` sets `end_date` and `dates` only for collapsed per-day rows, so even that first day publishes as a one-day event.
**Evidence:** The real `fetchLiveWhale` with stubbed `fetch` dropped a timed conference that started yesterday and ends tomorrow. It also dropped an all-day exhibit week that started two days ago. A symposium starting today was kept with no `end_date`, so it disappears tomorrow.
**Fix:** Filter on the end date when one exists. All-day `DTEND` is exclusive, so subtract a day. For a kept span, publish `date` as the later of start and today. Set `end_date`, and fill `dates` with each day, capped at around 120. #3's helper then shows it on every day.
**Verify:** Adapter tests for the three cases above, for LiveWhale and Tribe.

### #5. Source words hide the same organizer's LiveWhale events (P2)

**Status:** Fixed. A source word now matches the feed or the LiveWhale unit name. This covers BAMPFA, Berkeley Law, Cal Performances, Cal Bears, Haas, and Simons. The chip stays. "berkeley law" returns 142 rows, all 36 LiveWhale ones included. "film bampfa" returns 13 instead of 2. The source dropdown still means feed provenance. ai_risk, brsl, and begin have no LiveWhale unit, so they are unchanged.
**Files:** `utils/searchIntent.ts:89-112` and `:346-353`, `utils/searchEngine.ts:286-292`
**Problem:** "berkeley law", "bampfa", "haas", and "simons" become hard `source:` filters. Dedupe keeps the LiveWhale copy of any cross-published event. Those rows carry `source: livewhale`, so the lock hides them.
**Evidence:**

| Query | Lock | LiveWhale rows with that organizer | Shown |
|---|---|---|---|
| berkeley law | `source:berkeley_law` | 36 | 0 |
| bampfa | `source:bampfa` | 15 | 0 |
| haas | `source:haas` | 9 | 0 |

The hero preset "A film at BAMPFA" has the same gap.
**Fix:** For institution sources (bampfa, cal_performances, haas, berkeley_law, simons, ai_risk, brsl, begin), match `source === X` or an organizer pattern for X. Keep the chip. The golden test in `search-quality.test.mjs` asserts every "berkeley law" result has `source: "berkeley_law"`, so it changes with this fix.
**Verify:** "berkeley law" includes the 36 LiveWhale Berkeley Law rows.

### #6. The stemmer splits -y and -ies forms (P2)

**Status:** Fixed. The stemmer now runs Porter step 1c, and `public/search-index.json` is rebuilt. "library" and "libraries" both return 30, and "community" and "communities" both return 91. `npm run rebuild-index` rebuilds the index from the committed feed. A stability test now fails when the committed index is stale. One gap is left in the topic layer. "movie" is a Film topic synonym and "movies" is not, so they still return 27 and 2.
**File:** `utils/textUtils.ts:127-166`
**Problem:** "-ies" becomes "-i", but a final "-y" is kept. "library" stems to `library` and "libraries" to `librari`. "movie" stays `movie` while "movies" becomes `movi`. Singular and plural queries hit different postings.
**Evidence:**

| Singular | Results | Plural | Results | Overlap |
|---|---|---|---|---|
| library | 27 | libraries | 4 | 1 |
| movie | 27 | movies | 1 | 1 |
| community | 81 | communities | 17 | 7 |

**Fix:** Add Porter step 1c: a final "y" after a consonant becomes "i". Also map a final "ie" to "i". Regenerate `search-index.json` in the same PR (see note 4). The index and the query must use the same stemmer.
**Verify:** A test that each pair returns the same id set. Re-run `npm run test:search-quality`.

### #7. Recreation rows fill Student Life (P2)

**Status:** Fixed. `ORG_UNIT_MAP` now labels the "recsports" slug "Recreational Sports", which scores as Sports. The Wellness organizer pattern drops that name, so those rows gain no topic. The published feed changes on the next daily run. On today's snapshot, 204 rows move to Sports and Student Life drops from 269 to 65. "cal games" and "bears game" now mean the Cal Bears source, so lap swim and building hours cannot bury the games.
**Files:** `scripts/sources/livewhale.ts:90-177`, `scripts/lib/normalize.ts:52-55`, `scripts/lib/topics.ts:380`
**Problem:** 236 LiveWhale rows have the organizer "Recsports", the prettified URL slug. `ORG_UNIT_MAP` has no entry for it. The category map only knows "recreational sports" and "rec sports". So "Building Hours - RSF", "Lap Swim", and "Bouldering" score no Sports signal. 204 of the 236 fall to Student Life, which is 76% of that category (204 of 269). Recsports rows fill 21% to 39% of each day's list over the next nine days.
**Fix:** Add `recsports: "Recreational Sports"` to `ORG_UNIT_MAP`. In the same change, drop "recreational sports" from the Wellness organizer pattern at `topics.ts:380`. Otherwise all 236 rows gain the Wellness topic and break the 200 breadth cap.
**Verify:** After a regen, those rows are primary Sports, and Wellness stays near today's 9 events. Add a categorization test for a Recsports row.

---

## Tier 2: Coverage and pipeline correctness

### #8. CalLink keeps 10 of 30 public events (P2)

**Status:** Fixed in code, pending a live run. The adapter now pages with `take` and `skip`, sorted by `endsOn`, until it reaches `@odata.count` or 200. It stops early on an empty page or a page with no new ids, then warns. The parameter names follow the Engage events page but could not be tried from the review sandbox. The CalLink contract now fails when `take=25` returns fewer rows than the count.
**Files:** `scripts/sources/callink.ts:131-135`, header comment at `:6-9`, `scripts/lib/sourceContracts.mjs:51`
**Problem:** The 2026-09-25 log reads `[callink] API returned 10 items (odata.count: 30)`. CalLink has returned exactly 10 events every day since at least 2026-07-24. The adapter sends OData `$top=200`, and the Engage endpoint ignores it. The header comment says the platform caps results near 16 whatever `$top` says. The count the API reports contradicts that.
**Fix:** Page with Engage's `take` and `skip` until `value` reaches `@odata.count` or `MAX_EVENTS`. Confirm the parameter names with one request first. Log a warning when fewer rows arrive than the count. Make the CalLink contract compare `value.length` with the count.
**Verify:** A stubbed-fetch test that serves pages of 10 with a count of 30 yields 30 events.

### #9. Last-good restore publishes duplicates (P2)

**Status:** Fixed. After all restores, `dedupeRestoredEvents` in `scripts/lib/dedupe.ts` runs the title-and-date key again with source priority. It only touches groups that hold a restored row, so a normal day is unchanged. The restored LiveWhale row now wins and keeps yesterday's id. A restored multi-day row is keyed on its next day. The repro is a publish-guard test, with edge cases in `dedupe.test.mjs`.
**Files:** `scripts/updateEvents.ts:299-305`, `scripts/lib/lastGoodFallback.ts:97-110`
**Problem:** Restored rows are appended after cross-source dedupe and checked by id only. When LiveWhale fails, a lower-priority copy of a cross-published event survives that day's dedupe. Yesterday's LiveWhale copy then comes back through the restore. Both publish.
**Evidence:** Reproduced with the real `dedupeEvents`, `projectToLegacy`, and `appendLastGoodEvents` in orchestrator order. Day N publishes `livewhale_123@events.berkeley.edu`. On day N+1, with LiveWhale down, both `haas_987` and the LiveWhale row publish with the same title and date.
**Fix:** After all restores, run a title-and-date pass with the dedupe key and priority. The restored LiveWhale row should beat the fresh Haas row. That keeps yesterday's id, so `?event=` links keep working.
**Verify:** Turn the repro into a publish-guard test.

### #10. Chained fallback resets its own age (P2)

**Status:** Fixed. Each source in `status.json` now carries `last_healthy_at`. A healthy run stamps its fetch time, and a degraded run carries the old stamp forward. Fallback age counts from that stamp, so three LiveWhale failures in a row read 24, 48, and 72 hours. The third one expires the fallback and blocks the publish. Before the first stamp exists, the previous publish time stands in.
**File:** `scripts/updateEvents.ts:244-250` and `:287`
**Problem:** Fallback age is `now - existing.lastUpdated`, the age of the previous `events.json`. It is not the age of the source's data. During a multi-day LiveWhale outage, each run restores rows that an earlier run restored. The age reads about 24 h every day. `MAX_FALLBACK_AGE_HOURS` (48) never trips, and `data_age_hours` understates the real age. AGENTS.md reserves `pipeline-failure` for LiveWhale without usable fallback, so that alert never fires either.
**Fix:** Persist a per-source `last_healthy_at` in `status.json` and compute fallback age from it. The existing stale-fallback block then fires on day three.
**Verify:** Simulate three LiveWhale failures in a row. On the third run, `livewhale` is in `stale_fallback_sources` and the publish is blocked.

### #11. Four sources can never restore, and ai_risk has been down since 2026-09-15 (P2)

**Status:** Partly fixed. The decision was quiet restore. luma, begin, ai_risk, and brsl now restore last-good events under the 48 h cap. They set `degraded` and `fallback_used` on their own status entry. They stay out of `degraded_sources`, the top-level reason, and `data_age_hours`, so no banner appears. The recovery code moved to `scripts/lib/lastGoodFallback.ts` so publish-guard tests can run it. Still open: `speaker-series.js` returns 404, and the review sandbox could not reach ai-risk.berkeley.edu to find the new path.
**Files:** `scripts/updateEvents.ts:173-176` and `:267-269`, `scripts/sources/ai_risk.ts:20`
**Problem:** `luma`, `begin`, `ai_risk`, and `brsl` set `allowLastGood: true` with `degradeOnFailure: false`. `markRecovery` returns at line 267, before the last-good branch, so they never restore. No test covers that pair. `speaker-series.js` has returned 404 on every run since 2026-09-15. The AI Risk talks have been missing for 11 days, and `status.json` still says `degraded: false`. Issue #195 has been open since 2026-09-21.
**Decision needed:** Should supplementary sources restore quietly?
**Recommended default:** Yes. Restore under the 48 h cap from #10, set `fallback_used` on the source status, and keep the source out of `degraded_sources` so no banner appears. If the answer is no, set `allowLastGood: false` so the config matches the code.
**Fix:** Apply the decision. Find the new schedule path on ai-risk.berkeley.edu and update `SCRIPT_URL` and its contract.
**Verify:** A publish-guard test where `ai_risk` fails, yesterday's upcoming talks stay, and `degraded_sources` is empty.

### #12. Simons and Cal Performances are drifting toward the 60 s timeout (P2)

**Status:** Fixed in code, pending live runs. Simons now gets a 45 s attempt, two attempts, and a 100 s adapter budget that `simons.ts` exports. Cal Performances reads `X-WP-TotalPages` from page 1 and fetches the other pages in parallel. The date-filter check on `/api/events` is still open, because the review sandbox cannot reach simons.berkeley.edu.
**Files:** `scripts/sources/simons.ts:25` and `:71-86`, `scripts/sources/cal_performances.ts:175-185`, `scripts/updateEvents.ts:74`
**Problem:** Both adapters download their full history on every run. Simons fetches 2,556 events to keep 32. Its run time rose from about 14 s in July to 15 to 26 s in September. On 2026-09-25 the first 30 s attempt timed out, and the run took 36.9 s. Cal Performances pages through 384 posts to keep 56. It took 21 to 26 s in July and 24 to 31 s over the last ten days. A Simons timeout marks it degraded, and that shows the visitor banner.
**Fix:** Check whether `/api/events` accepts a date filter. If not, give Simons its own adapter budget and a 45 s attempt timeout. For Cal Performances, read `X-WP-TotalPages` from page 1 and fetch the rest in parallel.
**Verify:** Adapter durations in `status.json` stay under 30 s for a week.

### #13. Same-day repeat sessions can collapse into one (P3, needs a live check)

**Status:** Fixed in code, pending a live check. Dedupe now keeps a source's same-day rows when their start times differ, so both games of a doubleheader publish. The restore pass from #9 follows the same rule. BAMPFA keys a showing on its URL and start time. A later showing that day gets an `@HHMM` id suffix, and the first keeps its id. Collapse groups later showings by time slot, so a daily second session is one card. Cal Performances reads every performance and publishes a run over its remaining days.
**Files:** `scripts/sources/bampfa.ts:358-368`, `scripts/sources/cal_performances.ts:115`, `scripts/lib/dedupe.ts:146-154`
**Problem:** Three places identify an event without its start time. BAMPFA dedupes on `url::date`, so a second showing of a film that day is dropped. On 2026-09-25 it skipped 16 rows this way (148 raw, 125 kept, 7 invalid), some of them month-page overlaps. Cal Performances reads only the first `span.start` in a production's post. A multi-performance run can then vanish once its first show passes. Cross-source dedupe keys on title and PT date only.
**Fix:** Add the start time to BAMPFA's key and to the second showing's `source_id`, and keep the first id stable. Parse every `span.start`. In dedupe, do not merge two rows from one source whose start times differ.
**Verify:** Fixtures with two BAMPFA showtimes on one day and a Cal Performances post with three performances.

---

## Tier 3: CI, alerting, and security hardening

### #14. The topic-quality gate fails every day by construction (P2)

**Status:** Fixed. Each of the 56 references now stores its title, description, organizer, and source, frozen from the 2026-09-03 snapshot in commit `0a87587`. The suite runs `assignTopics` on those copies and no longer checks corpus membership. It passes today at 51 of 51. It fails when "ai" leaves the AI synonyms, at 35 of 51. Removing "machine learning" alone still passes at 49 of 51, so that verify step does not hold. Close #184 once this reaches `main`.
**Files:** `scripts/tests/topic-quality.test.mjs:44-67`, `scripts/tests/fixtures/topic-reference-sets.json`
**Problem:** The test looks up the 56 frozen AI references by event id in the live corpus and needs 40 to remain. Events age out daily. The 2026-09-25 run reports `Only 23/56 frozen references remain in the current corpus`. The suite has failed on every run since 2026-09-12. Issue #184 has 13 identical comments, so a real topic regression would now go unseen.
**Fix:** Store each reference's title, description, organizer, source, and groups in the fixture. Run `assignTopics` over those copies and drop the corpus-membership assertion. Then close #184.
**Verify:** The suite passes today. It fails if "machine learning" is removed from the AI synonyms.

### #15. The automation token reaches every workflow step (P2)

**Status:** Fixed. The workflow-level `env` is gone. Only the token check, create-PR, and merge steps receive `secrets.AUTOMATION_PR_TOKEN`. The final fail step reads a new `present` output from the token check. A publish-guard test fails if the secret moves back into a shared `env`. The run-log check needs the next scheduled run.
**File:** `.github/workflows/update-events.yml:19-20` and `:326`
**Problem:** `AUTOMATION_PR_TOKEN` is set in workflow-level `env`. The run log shows it in the environment of every step, including `npm ci` and `npm run update-events`. `npm ci` runs dependency install scripts. `update-events` parses untrusted upstream data. The token has contents and pull-request write, and this repo merges PRs once checks pass, with no review.
**Fix:** Remove the workflow-level `env`. Pass the secret only to the token check, create-PR, and merge steps. Replace the `env.AUTOMATION_PR_TOKEN != ''` condition at line 326 with a `present` output from the token check.
**Verify:** The run log no longer lists the token under the install, generate, validate, or test steps.

### #16. A dead supplementary source raises no daily alert (P3)

**Status:** Fixed. Each source in `status.json` now carries `consecutive_failures`, read from the previous committed copy. Only a failed fetch counts, since some sources are empty between terms. After three in a row, the daily workflow opens or updates a `source-contracts` issue. The counter never touches `degraded_sources`.
**Files:** `scripts/lib/feedHealthPolicy.ts:111-118`, `.github/workflows/source-contracts.yml`
**Problem:** A failed supplementary source becomes one `::warning::` annotation on a green run. That was the only daily signal for ai_risk. The weekly contract check opened #195 six days after the first 404.
**Fix:** Carry `consecutive_failures` per source in `status.json`, read from the committed previous copy. After three failed runs, open or update a `source-contracts` issue from the daily workflow. Keep it out of `degraded_sources`.
**Verify:** A unit test for the counter across three fixtures.

### #17. Pin third-party actions and narrow workflow permissions (P3)

**Status:** Fixed. `peter-evans/create-pull-request` is pinned to `5f6978f` (v8.1.1), and Dependabot bumps it. `update-events.yml` sets `permissions: {}` at the top, and only the update-events job asks for write scopes. Validate, E2E, Security Audit, and Source Contracts now default to read-only contents. Production Smoke grants nothing at the top. A publish-guard test fails on an unpinned third-party action.
**Files:** `.github/workflows/*.yml`
**Problem:** `peter-evans/create-pull-request@v8` receives the automation PAT and sits on a movable tag. `update-events.yml` grants contents, pull-request, and issue write to every job. That includes `schedule-gate`, which needs none.
**Fix:** Pin third-party actions to commit SHAs. Dependabot already tracks `github-actions`, so it will bump them. Set `permissions: {}` at the top and grant per job.

### #18. Clear stale operator issues and the Dependabot queue (P3)

**Status:** Fixed on 2026-09-26. #145 and #156 are closed with a comment each. The production audit found 0 vulnerabilities. #177, #178, and #141 were brought up to date with `main` and merged after both required checks passed. #130 is closed, because Node 26 types do not match the Node 22 runtime. #195 stays open until the ai_risk path from #11 is found. Before merging, this branch's full gate passed against both dependency groups.
**Problem:** #145 (`pipeline-failure`, 2026-07-27) is still open, though runs have been green since 2026-09-02. The notifier comments on the open issue with that label, so the next failure lands in that old thread. #156 (`security-audit`, 2026-08-10) is stale because `npm audit --omit=dev` is clean today. Dependabot PRs #130 (2026-06-29), #141 (2026-07-20), #177, and #178 (2026-09-07) are unmerged. The dev audit reports 10 advisories, 4 high, in PostCSS source-map handling. #178 probably clears them.
**Fix:** Close #145 and #156. Keep #195 open until #11 lands. Merge or close the four Dependabot PRs.

---

## Tier 4: Agent contract and parity

### #19. The agent week is 7 days and the UI week is 8 (P2)

**Status:** Fixed. The decision was 7 days. `weekEndKey` in `utils/eventDates.ts` returns today plus six days. The UI bucket, the "N dates this week" label, the weekday labels, and the agent's week preset all use it. Tests pin the same boundary in the UI, the label, and `search_berkeley_events`.
**Files:** `agent/webmcpTools.ts:93-94`, `hooks/usePacificDateKeys.ts:34` and `:47`, `utils/eventDates.ts:215`
**Problem:** `resolveDatePreset("week")` ends at today+6. The UI's `nextWeekKey` is today+7 and its bucket is inclusive, so This Week spans 8 days. On 2026-09-25 the UI week holds 428 events and the agent week 384. The "N dates this week" label uses today+6, so the UI also disagrees with itself. AGENTS.md requires parity between user and agent actions.
**Decision needed:** 7 or 8 days?
**Recommended default:** 7 days, today through today+6.
**Fix:** One `weekEndKey(todayKey)` helper, used by the hook, the label, and the agent.
**Verify:** One fixture gives the same count through the UI bucket and `search_berkeley_events`.

### #20. Agent docs and OpenAPI omit the multi-day fields (P2)

**Status:** Fixed. The OpenAPI `Event` schema now lists `end_date` and `dates`, and `source` is required. llms.txt, llms-full.txt, and the search and detail skills document both fields. They tell agents to match date windows on `dates`. `summarizeEvent` returns both fields. The skill digests are regenerated, and the three discovery versions are 1.3.0. Agent-readiness tests assert each change.
**Files:** `public/openapi.json` (`components.schemas.Event`), `public/llms.txt`, `public/llms-full.txt`, `public/.well-known/agent-skills/search-events/SKILL.md`, `agent/webmcpTools.ts:55-71`
**Problem:** `LegacyCalEventSchema` publishes `end_date` and `dates` on multi-day events, 32 of them today. The OpenAPI `Event` schema lists neither. It also leaves `source` optional, though Zod requires it. llms.txt, llms-full.txt, and every skill are silent on both fields. The search skill tells HTTP agents to filter on `date`, which repeats #3 for them. `summarizeEvent` drops both fields from search results.
**Fix:** Add `end_date` and `dates` to OpenAPI, llms.txt, llms-full.txt, and the search skill. Mark `source` required. Tell agents to match on `dates` when present. Return both fields from `summarizeEvent`. Regenerate the skill digests and bump the three discovery versions together to 1.3.0.
**Verify:** Agent-readiness assertions for both fields in OpenAPI, llms.txt, and the search skill.

### #21. Agent search with no date bound returns past events (P3)

**Status:** Fixed. `search_berkeley_events` now starts at today's Pacific date when neither `datePreset` nor `startDate` sets a lower bound. A lone past `endDate` gets a clear error. The tool schema and the search skill say so, and a WebMCP test covers a yesterday row.
**File:** `agent/webmcpTools.ts:174-184`
**Problem:** With no `datePreset` or `startDate`, the pool has no lower bound. Before each morning's publish, yesterday's rows are still in `events.json`, and they sort first. The UI drops them.
**Fix:** Default `startDate` to today's Pacific key.
**Verify:** A WebMCP test with a yesterday row and no date input.

### #22. Explicit category overrides diverge between UI and agent (P3)

**Status:** Fixed. `dismissedKeysForExplicitFilters` in `utils/searchIntent.ts` replaces the topic-only helper. An explicit topic, category, or source dismisses a different one the query implies, and the UI hook and `search_berkeley_events` both call it. After #2, "basketball" no longer implies Sports, so the test uses Arts plus "sports". Both paths return the one Arts event that mentions sports.
**Files:** `agent/webmcpTools.ts:388-392`, `hooks/useEventBrowserState.ts:264-291`
**Problem:** The UI dismisses an inferred category or source that conflicts with the explicit one. The agent does this for topic only. With `category: "Arts"` and the query "basketball", the UI returns 1 result. The agent drops the inferred category in its fallback and returns the whole Arts pool in date order.
**Fix:** Move the explicit-versus-inferred dismissal for category, source, and topic into one shared helper, and call it from both paths. #2 improves both results.
**Verify:** The UI hook and `search_berkeley_events` return the same ids for that input.

---

## Tier 5: Smaller bugs

### #23. The desktop detail panel shows one date for multi-day events (P3)

**Status:** Fixed. The desktop panel now uses `detailWhenPrimary` and `detailWhenSecondary`, like the mobile sheet. A UI test opens a three-day exhibit and reads "Through Apr 24" and "Daily · all day".
**File:** `components/EventDetailOverlay.tsx:629-632` (desktop) versus `:436-441` (mobile)
**Problem:** The mobile sheet uses `detailWhenPrimary` and `detailWhenSecondary` ("Through Dec 31", "Daily · all day"). The desktop panel prints `formatEventDate(event.date)` and `event.time`. An 80-date exhibition reads as a single day on desktop.
**Fix:** Use the same two helpers in the desktop panel.

### #24. Venue aliases match substrings (P3)

**Status:** Fixed. `venueAliasExpansions` in `utils/textUtils.ts` matches aliases as whole words and skips "haas pavilion". The index builder and query expansion both use it. "management" now returns 63 results with no Haas Pavilion rows. Bakersfield rows no longer match "fitness" or "gym".

**Files:** `scripts/lib/buildIndex.ts:202-212`, `utils/searchIntent.ts:265-269`, `utils/textUtils.ts:248-268`
**Problem:** Aliases apply through `includes()`. The `haas` alias adds "business school management haas" to every "Haas Pavilion" row. All 57 such rows carry those tokens. They are basketball and volleyball games and practices. A search for "management" returns 120 results, and 57 are Haas Pavilion rows. "soda" and "wheeler" can collide the same way.
**Fix:** Match aliases on word boundaries and skip known collisions such as "haas pavilion". Regenerate the index.
**Verify:** "management" returns no Haas Pavilion practices.

### #25. Location and organizer text skip sanitization (P3)

**Status:** Fixed. `projectToLegacy` runs `sanitizePlainText` over each venue part, the address, the organizer, and the organizer unit. A part that cleans to nothing falls through. The three affected rows in the committed feed clear on the next pipeline run.

**File:** `scripts/lib/normalize.ts:429-441`
**Problem:** `projectToLegacy` sanitizes the title and description but not the location or organizer. One Simons row publishes a location with a literal `&nbsp;`, and another has a raw newline. React escapes text, so the UI shows `&nbsp;` as typed.
**Fix:** Run `sanitizePlainText` over location and organizer in `projectToLegacy`.
**Verify:** A normalize test with an entity and a newline in the venue.

### #26. CalLink's comparison-preserving cleaner has no effect (P3)

**Files:** `scripts/sources/callink.ts:24-40`, `scripts/lib/normalize.ts:445`, `scripts/tests/source-adapters.test.mjs:162-173`
**Problem:** The CalLink `stripHtml` keeps "GPA > 3.0". `projectToLegacy` then runs `sanitizePlainText`, which strips every `<` and `>`. The published text reads "GPA 3.0". The test checks only the adapter output. June #23 asked to remove this cleaner.
**Decision needed:** Keep the `<` and `>` strip in `sanitizePlainText`, a June security invariant, or relax it after tag removal?
**Recommended default:** Keep the strip. Delete the CalLink cleaner, use `sanitizePlainText`, and make the test assert the published text.

### #27. Three topic rules misfire (P3)

**Status:** Fixed. `ASSIGNMENT_EXCLUSIONS` in `scripts/lib/topics.ts` blanks "language model" and "natural language" for History and Humanities, "job talk" for Career and Jobs, and adjective uses of "social" for Social and Clubs. "Social" still counts at the end of a title or before "hour", "night", "event", or a preposition, so "Boba Social" and "Social Hour" keep the topic. Across the current feed, 20 rows lose a wrong topic. One public health talk then gains Workshops and Skills from "training" inside a URL, a separate gap. The three examples are labeled negatives in `topic-labeled-samples.json`. Search intent still reads bare "social" as the topic.

**File:** `scripts/lib/topics.ts:105`, `:138`, and `:226`
**Problem:** "language" in the History and Humanities terms tags "Scaling Diffusion Language Models" as humanities. The "social" synonym tags "Defending Democracy Online Through Social Media" as Social and Clubs, its only topic. "job" tags two academic "Job Talk" events as Career and Jobs.
**Fix:** Skip "language" when "model" follows. Drop bare "social" from title matching, and keep "social hour" and "mixer". Exclude "job talk". Add all three as labeled negatives in `topic-labeled-samples.json`.

### #28. The search index gets 3 seconds and no retry (P3)

**Status:** Fixed. The index fetch now gets 10 s. `useEventFeed` takes a `needsSearchIndex` flag, which `App.tsx` sets once the query reaches two characters. A failed load then gets one more try per feed load. A late response from an older request no longer overwrites a newer one. Tests in `tests/useEventFeed.test.tsx` cover the slow index, the retry, and the one-retry cap.

**File:** `hooks/useEventFeed.ts:28-50`
**Problem:** `search-index.json` is 141 KB brotli or 181 KB gzip. It must arrive within 3 s, and a timeout is never retried. On a slow phone link the whole session falls back to Fuse-only search. That path caps each fuzzy query at 100 hits and ignores field weights.
**Fix:** Allow 10 s, and retry once when the user first types two characters.
**Verify:** A UI test with a delayed index.

### #29. ICS export gaps (P3)

**Status:** Fixed. `escapeIcsText` turns CR and CRLF into an escaped line break. A file with a timed event now carries one Los Angeles `VTIMEZONE` block with the US rules since 2007. All-day files leave it out. The object URL is revoked after 40 s. `node-ical` reads the output at the right UTC instant on both sides of the 2026 and 2027 DST switches. The mobile path still downloads the `.ics` by design, since iOS and Android hand it to the device calendar.

**File:** `utils/icsExport.ts:6-12`, `:87-88`, and `:158-168`
**Problem:** `escapeIcsText` does not handle `\r`, which matters until #25 lands. Timed events use `TZID=America/Los_Angeles` with no `VTIMEZONE` block. RFC 5545 requires one per TZID, and strict clients reject files without it. `URL.revokeObjectURL` runs right after `click()`, which can cancel the download in some mobile browsers. The mobile path always downloads the `.ics`.
**Fix:** Strip or escape CR. Add a Los Angeles `VTIMEZONE`, or emit UTC times. Revoke the object URL in a `setTimeout`.
**Verify:** Extend `ics-export.test.mjs` for CR and the `VTIMEZONE` block.

### #30. Regex lookbehind blanks the page on Safari before 16.4 (P3)

**Status:** Fixed. The #2 change removed the only lookbehind. `vite.config.ts` now targets `safari15`. That also restores the `-webkit-backdrop-filter` and `-webkit-user-select` prefixes, which the `esnext` build stripped. A `no-restricted-syntax` rule in `eslint.config.js` rejects lookbehind in regex literals and in `RegExp` calls. It uses core ESLint, so no new dependency.
**Files:** `utils/searchIntent.ts:77`, `vite.config.ts`
**Problem:** The Science & Tech pattern uses lookbehind (`(?<!data )`). Safari added lookbehind in 16.4. The build targets `esnext`, so nothing rewrites it. On older iPhones the bundle fails to parse and the page stays blank. The error boundary cannot catch a parse error.
**Fix:** Rewrite the pattern without lookbehind. Set an explicit build target such as `safari15`.
**Verify:** `grep -rn "(?<" utils` returns nothing. Add `es-x/no-regexp-lookbehind-assertions` to ESLint so it stays out.

### #31. The date fallback in `searchEvents` is mostly dead (P3)

**Status:** Fixed. The branch now drops only the weekend filter, and its copy says "this weekend". The dead today, tomorrow, and week relaxation is gone. The UI and the WebMCP tool both narrow the pool by date before they search, and neither reads the relaxed date range. `AGENTS.md` describes the new cascade.

**File:** `utils/searchEngine.ts:552-585`
**Problem:** `applyPoolFilters` never reads `dateRange`. The date-broadening branch only changes the result when `weekend` is set. Its message then says "this week" for a weekend query.
**Fix:** Keep a weekend-only relaxation with the right copy, and delete the rest of the branch.

### #32. Event cards nest a link inside a button (P3)

**File:** `components/EventGrid.tsx:62` and `:102`
**Problem:** Each card is an `<article role="button">` that contains an `<a>`. Screen readers handle nested interactive controls poorly. The card's `aria-label` is the title alone, so the date and place are not announced.
**Fix:** Make the title the button, or a stretched link, and keep the external link as a sibling. Drop the `aria-label` so the card content is read.

---

## Tier 6: Docs and drift

### #33. AGENTS.md contradicts the code in three places (P3)

**Status:** Partly fixed. The #2 change rewrote the search-flow line at `:83`. The domain and in-flight lines are still open.
**File:** `AGENTS.md:7`, `:83`, and `:140`
**Problem:** It says the site deploys at `calevents-discovery.vercel.app`. The smoke test and all 61 URL references elsewhere in the repo use `cal-events.com`. It says the category branch does not strip, which #2 shows has been false since `4664a0b`. It lists the leftover topic work as in flight on `feat/topic-filter-review-fixes`, but PR 174 merged it on 2026-09-04.
**Fix:** Update all three after the #2 decision.

### #34. README, workflow comments, and PROGRESS.md carry stale numbers (P3)

**Problem:** README says "~900+ upcoming events" (1,487 today), "~1 MB" for `events.json` (1.5 MB), and "all 9 Berkeley endpoints" for Source Contracts (12 contracts). `validate.yml:43-47` says `events.json` is ~576 KB with ~7x headroom. It is 1.50 MB, peaked at 1.69 MB this month, and sits about 2.5x under the 4 MiB budget. `PROGRESS.md` stops at 2026-04-22. The `updateEvents.ts` header lists 6 of the 12 sources.
**Fix:** Refresh the numbers or drop them.

### #35. Small hygiene items (P3)

- `format:check` misses `index.tsx`, `vite.config.ts`, and `postcss.config.js`, and none of them is formatted.
- `appConfig.ts:93` says "Updates everyday". It should read "Updates every day".
- `App.tsx:116-119` calls `addRecentSearch` inside a `setFilters` updater, which runs twice under StrictMode.
- `calbears.ts:144` still double-casts to `VEvent`, left over from June #26.

---

## Status of earlier reviews

**June full-repo audit (`docs/code-review-2026-06-02.md`):** closed except for four partial items.

- #23: the CalLink cleaner is still there. See #26 above.
- #26: `calbears.ts:144` still double-casts.
- #31: `formatMultiDayWhen` still reads the wall clock, not the synced day key.
- #36: Zod now requires `source`, but OpenAPI does not. See #20 above.

Everything else from Tiers 1 to 8 is in the code, including the privacy footer and the mobile filter scrollbar.

**Topic-filter review (`docs/code-review-2026-09-04-topic-filter-layer.md`):** F1 to F12 landed in PR 173, and leftover #1 to #23 landed in PR 174. #14 above is a new problem in the frozen reference check.

---

## Security posture

Nothing exploitable turned up, and the June invariants still hold.

- Every adapter validates with `CanonicalEventSchema.safeParse`. `HttpUrlSchema` rejects `javascript:` and `data:`, with a test at `source-adapters.test.mjs:175`.
- There is no `dangerouslySetInnerHTML`. Every `target="_blank"` link has `rel="noopener noreferrer"`.
- `vercel.json` sets a strict CSP with `frame-ancestors 'none'`, plus HSTS and `nosniff`.
- `npm audit --omit=dev` is clean. The 10 dev-only advisories are build-time PostCSS issues (#18).

The one new item is the token exposure in CI (#15).

---

## Residual risks (no ticket)

- GitHub starts the 11:00 UTC cron four to six hours late. The "4:00 AM Pacific" publish lands between about 08:15 and 09:45 PT, which widens the #3 morning gap.
- Cal Bears publishes away games: 61 of 243 rows, such as "California Field Hockey at VCU" in Richmond, VA. They carry an Away badge. This is a product call.
- LiveWhale publishes 4 to 5 "Building Hours" rows a day. Revisit them once #7 lands.
- One missed publish never trips the 36 h smoke threshold, since the 20:00 UTC run sees about 28 h.
- Canceled LiveWhale rows count as `invalid` in `status.json` (`livewhale.ts:627-637`).
- A partial LiveWhale group-feed outage is invisible. Only an all-feeds failure is flagged (`livewhale.ts:402-406`).
- Luma ignores `has_more` and `next_cursor` (`luma.ts:159-163`).
- Simons `end` values have no zone and get `Z` appended (`simons.ts:52-56`). Nothing downstream reads `end_at` for single events today.
- PT offset helpers are copied in `bampfa.ts` and `ai_risk.ts`, and `cal_performances.ts` has a third variant.
- `MAX_EVENTS_PER_SOURCE` truncates in adapter order, not by date (`updateEvents.ts:381-396`).

---

## Suggested fix order

1. #1, then #7 and #8. Each is small and restores visible behavior.
2. The #2 decision, then #2 and #5 together with their golden tests.
3. #3 and #4 with one shared occurrence helper, then #19, #20, and #23.
4. #9, #10, and the #11 decision, so outages report honestly.
5. #14 and #15, then #16 to #18.
6. #6 and #24 in one PR with a regenerated index.
7. The rest as time allows. Run `npm run validate` after each step.
