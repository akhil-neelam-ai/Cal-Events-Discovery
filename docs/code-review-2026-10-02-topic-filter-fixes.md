# Code review: topic filter fixes after PR 174

A max-effort review of PR 174 on 2026-10-02 verified 15 bugs. PRs 215, 217, 218, and 219 fixed all of them on 2026-10-03. Each item below has a status line, the files, the problem, the fix, and how the fix was checked.

The review read `git diff` of the PR 174 merge. PR 202, a separate September audit, merged first and touched the same files. Every finding was rechecked against `main` after PR 202 and still applied.

## How to use this document

- Check the status line before you re-investigate a symptom. Every item here is fixed.
- Lessons that apply beyond these bugs are in `docs/solutions/`.
- Numbers come from production data on the dates given. Expect them to drift.
- Nine of these follow up fixes the September 4 review marked done: its #2, #5, #6, #8, #9, #11, #17, #22, and #23. Those status lines now point here.

## Topic data

### 1. BAMPFA and Cal Performances lost their topics (P1)

**Status:** Fixed in PR 217.
**Files:** `scripts/lib/topics.ts`, `scripts/sources/bampfa.ts`, `scripts/sources/cal_performances.ts`, `scripts/lib/schema.ts`
**Problem:** PR 174 removed the source-wide topic mappings for both sources, since they tagged cafe-hours notices as Film. Nothing replaced them. BAMPFA descriptions repeated the title, so no evidence remained. On 2026-10-02, 73 of 80 BAMPFA events and 38 of 53 Cal Performances events had no topics. Film fell from 147 events to 36.
**Fix:** Both publishers label each event. The BAMPFA scraper reads the card's labels (Film, Art, Tours) and its real summary. Cal Performances records the genre from the event URL. An internal `event_types` field feeds `EVENT_TYPE_TOPICS`, mapped per source.
**Verified:** A full live pipeline run left 2 of 80 BAMPFA events and 12 of 52 Cal Performances events untagged. Film reached 96 events.

### 2. Closure notices published as events (P3)

**Status:** Fixed in the PR that adds this document. Found while checking item 1, so it is not one of the 15.
**File:** `scripts/sources/bampfa.ts`
**Problem:** BAMPFA lists "Modified Hours: BAMPFA Closed" on each closed day. The multi-day collapse turned the winter break into one event shown every day.
**Fix:** The scraper skips entries with a closure-style title and no BAMPFA label. A film called "After Hours" keeps its Film label and stays.

## Search and chips

### 3. The typed topic's chip counted label text (P1)

**Status:** Fixed in PR 215.
**Files:** `hooks/useEventBrowserState.ts`, `utils/searchIntent.ts`
**Problem:** Chip counts dismissed the inferred topic and searched its label instead. "Social and Clubs" needs both words to match. On production, "club" showed 29 events while its chip said 0. `?q=climate&topic=climate-energy` auto-cleared a valid topic and emptied the grid.
**Fix:** The selected topic and the typed topic count with the grid's own topic-first search. A dismissed topic searches the word the user typed.
**Verified:** On cal-events.com after deploy, "club" showed 17 events and its chip said 17.

### 4. Auto-clear removed a different topic (P1)

**Status:** Fixed in PR 215.
**Files:** `utils/searchIntent.ts`, `App.tsx`
**Problem:** `withDismissedInterpretations` dropped any topic filter on a `topic:` prefix. Auto-clearing Law left `topic:law`, which removed the AI topic from an "AI" query. Every event then showed under a visible AI chip.
**Fix:** A dismissed key removes a filter only when its value matches exactly.

### 5. WebMCP lost the typed word inside an explicit topic (P2)

**Status:** Fixed in PR 215.
**File:** `utils/searchIntent.ts`
**Problem:** `search_berkeley_events({ topic: "law", query: "concert" })` searched "Music and Performance" and returned nothing. Before PR 174 it returned both Law events.
**Fix:** Same as item 3. The dismissed topic searches "concert".

### 6. "tonight" left a stray keyword (P3)

**Status:** Fixed in PR 215.
**File:** `utils/searchIntent.ts`
**Problem:** A guard skipped the evening branch once "tonight" set evening. "tonight after work" then required "work".
**Fix:** The evening branch always strips its words.

### 7. "carbon-free" set the Free filter (P3)

**Status:** Fixed in PR 215.
**File:** `utils/searchIntent.ts`
**Problem:** Any bare "free" set a hard Free filter once a topic matched, including hyphenated compounds.
**Fix:** Only a standalone "free" counts. The pattern avoids lookbehind, which Safari 15 lacks.

## Date ranges and fallbacks

### 8. Today did not widen to the week for searches (P2)

**Status:** Fixed in PR 218.
**File:** `hooks/useEventBrowserState.ts`
**Problem:** The widen check looked at the unsearched pool, which had events today. "AI today" with the only AI event tomorrow showed an unrelated event. The message read `results for ""`.
**Fix:** The hook runs the query over the week first and widens only on real matches. Messages drop `for ""` when only a topic was typed.

### 9. The fallback dropped the other words and filters (P2)

**Status:** Fixed in PR 218.
**File:** `hooks/useEventBrowserState.ts`
**Problem:** A hook-level fallback listed every event in range when the inferred topic had no match. "AI zzqx" listed everything. WebMCP returned nothing for the same query.
**Fix:** The hook fallback is gone. `searchEvents` already drops the topic and keeps the rest, for both surfaces.

### 10. Auto-clear ran before the search index loaded (P2)

**Status:** Fixed in PRs 215 and 218.
**Files:** `hooks/useEventBrowserState.ts`, `hooks/useEventFeed.ts`
**Problem:** Without the index, Fuse keeps 100 hits and misses late words. A shared topic link could lose its topic in that window.
**Fix:** PR 215 counts the selected topic with a topic-first search, so the cap cannot drop it. PR 218 waits for `searchIndexSettled` before trusting a search's counts.

### 11. A failed load stripped the URL topic (P2)

**Status:** Fixed in PR 218.
**File:** `App.tsx`
**Problem:** A failed feed load counted as finished. URL validation then removed `?topic=`, and Retry could not restore it.
**Fix:** Only a successful load counts as finished.

## Pipeline

### 12. A partial group-feed outage wiped topics (P2)

**Status:** Fixed in PR 219.
**Files:** `scripts/sources/livewhale.ts`, `scripts/lib/topicAssignmentResilience.ts`, `scripts/updateEvents.ts`
**Problem:** Group-feed health tripped only when all 40 feeds failed. One rate-limited feed cleared that group's topics, and status still said ok. A 200 HTML page counted as a healthy empty feed.
**Fix:** The adapter reports `failedGroups`. LiveWhale events keep any prior topic only those groups can give. A non-iCal 200 counts as failed.

### 13. A total group-feed outage froze every source (P2)

**Status:** Fixed in PR 219.
**File:** `scripts/lib/topicAssignmentResilience.ts`
**Problem:** `forceError` carried prior topics for all 13 sources. A new Berkeley Law event published with no topics.
**Fix:** Only LiveWhale events carry group topics. Other sources assign as usual, and the stage still reports an error.

### 14. The AI overlap check could block the daily publish (P2)

**Status:** Fixed in PR 219.
**File:** `scripts/tests/search-engine-runtime.test.mjs`
**Problem:** The check ran on the live feed inside `npm run validate` and required `Math.min(50, references left)`. On 2026-10-02 that meant 18 of 18. It would turn vacuous once every reference passed.
**Fix:** It searches the frozen reference text, asserts no fallback fired, and requires 90% recall. It finds 51 of 51.

### 15. carried_forward_count ignored restored rows (P3)

**Status:** Fixed in PR 219.
**File:** `scripts/lib/topicAssignmentResilience.ts`
**Problem:** The ok path reported 0 even when last-good rows kept their topics.
**Fix:** The count includes restored rows and group carries, as the published status contract says.

### 16. A test compared two literals (P3)

**Status:** Fixed in PR 219.
**File:** `scripts/tests/publish-guards.test.mjs`
**Problem:** The "without source banners" test asserted that one object literal equals another, so it could never fail.
**Fix:** It now runs `markRecovery`, `buildStatusBanner`, and `shouldShowStaleDataBanner` on a healthy LiveWhale run with a topic error.

## Checked and left alone

- The category detector strips its word from the unmasked text, so "AI visual arts gallery" ranks on "visual gallery". This predates PR 174.
- Popstate shows the new topic against the old query for 140 ms. This predates PR 174.
- An empty synonym would hang the topic scanner. The publish schema rejects empty synonyms.
- PR 202 already fixed WebMCP's source and category dismissal and its 7-day week.

## Related

- PR 216 added the Center for Long-Term Cybersecurity as source 13. It had sat on a local branch since September 4.
- Open: PR 207 (Sentry 11 removes `sendDefaultPii`, a privacy call) and PR 204 (TypeScript 7, blocked until typescript-eslint supports it).
- Issue 184 tracks the advisory topic-quality suite, which failed daily on live-corpus decay. PR 202 froze its reference text on 2026-10-03, so the 2026-10-04 run should pass and close it.
