---
title: Topic search used the label, not the word the user typed
date: 2026-10-03
last_updated: 2026-10-04
category: logic-errors
module: Search intent and topic chip counts
problem_type: logic_error
component: service_object
symptoms:
  - 'On production, "club" showed 29 events while the Social and Clubs chip said 0'
  - 'A shared ?q=climate&topic=climate-energy link auto-cleared a valid topic'
  - 'An "AI" query after a Law topic auto-cleared showed the AI chip but listed every event'
  - 'WebMCP topic=law plus query=concert returned nothing'
  - Tests stayed green because they only used the AI topic, which requires one matching word
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components: [testing_framework]
tags: [search-intent, topic-chips, chip-counts, dismissed-interpretations, required-core-matches, topic-auto-clear, multi-word-labels, webmcp]
---

# Topic search used the label, not the word the user typed

## Problem

Typing "club" showed 29 events while the Social and Clubs chip said 0 and was disabled. A shared link with a valid topic could lose that topic and show an empty grid. PR 215 fixed it on 2026-10-03.

## Symptoms

- Before PR 215, "club" listed 29 events and its chip read 0. "career" listed 45 events and its chip read 2.
- `?q=climate&topic=climate-energy` showed "Topic cleared because no events match it with the other filters." Then the grid went empty.
- WebMCP `search_berkeley_events({ topic: "law", query: "concert" })` returned 0 events. Before PR 174 it returned both Law events.
- After auto-clear removed Law, a later "AI" search listed every event. The AI chip stayed on screen with no filter behind it.
- A topic-only fallback read `No "AI and Machine Learning" results for "". Showing all topics.`

## What Didn't Work

- **PR 202 fixed half of it.** Source and category chips already searched their typed words through `interpretation.text ?? interpretation.label`. Topic chips never recorded `text`, and their separate branch kept mapping to `interpretation.label`.
- **Swapping in the typed word alone.** That broke the UI test "keeps a Law hit when Fuse would otherwise cap it out". The test runs `?q=workshop&topic=law` over 101 AI workshops and one Law workshop, with no search index. With the label, the availability search sent Fuse three distinct queries, and their union happened to include the Law event. The typed word sent one query, and `limit: 100` cut the Law event. The count needed a different search, not different text.
- **PR 174's tests could not see it.** Its UI tests used "AI", "law", and "workshop". For AI, `hasAiSemanticIntent` lowers the word rule to one match. "Law" is a one-word label. The UI mock typed `searchIndex: null`, so the index path that applies the rule never ran. One engine test even pinned the bug by expecting the keywords `["ai", "machine", "learn"]`.

## Solution

PR 215 changed `utils/searchIntent.ts` and `hooks/useEventBrowserState.ts`. PR 218 fixed the message in `utils/searchEngine.ts`.

1. A topic chip records the words that set it, in `buildSearchPlan`:

```ts
interpretations.push({
  key: `topic:${firstTopic.topic.slug}`,
  label: firstTopic.topic.label,
  text: cleaned.slice(firstTopic.index, firstTopic.index + firstTopic.length),
});
```

2. One branch in `withDismissedInterpretations` puts the typed words back for source, category, and topic chips:

```ts
const dismissedText = plan.interpretations
  .filter(
    (interpretation) =>
      dismissedKeys.has(interpretation.key) &&
      /^(source|category|topic):/.test(interpretation.key),
  )
  .map((interpretation) => interpretation.text ?? interpretation.label)
  .join(" ");
```

3. A filter drops only when its exact key is dismissed. The old loop split each key on `:` and deleted the whole field.

```ts
for (const field of Object.keys(filters) as Array<keyof SearchFilter>) {
  if (dismissedKeys.has(`${field}:${String(filters[field])}`)) {
    delete filters[field];
  }
}
```

4. The selected topic and the typed topic count with the grid's own search. `selectedTopicCounts` runs `searchEvents` on the grid's topic-filtered `datePool`, with the keys the grid would use once that topic is chosen. It overrides those two chips:

```ts
const keys = new Set(searchDismissedKeys);
if (slug === inferredTopicSlug) keys.delete(`topic:${slug}`); // count it as if chosen
const pool = datePool.filter((event) => eventHasTopic(event, slug));
counts.set(slug, searchEvents(pool, query, searchIndex, keys, planOptions).results.length);
```

5. PR 218 drops the empty quotes with a `forKeywords(plan)` helper that returns nothing when no words are left.

Ten new or updated tests failed on `main` and passed after PR 215. After deploy, cal-events.com showed the "club" chip at 17 with 17 results.

## Why This Works

- `requiredCoreMatches` in `utils/searchEngine.ts` returns `Math.min(2, coreCount)`. Only AI intent lowers it to 1, and it runs on the index path only.
- Topic inference strips the typed synonym from the query. Dismissing the topic then put the label back as text. "Social and Clubs" tokenizes to `social` and `club`, so an event needed both words when the user typed one.
- The availability search always dismissed the inferred topic. So the typed topic's chip counted label text, while the grid used the topic as a hard filter. Two searches produced the two numbers.
- Now both topics count with the grid's own call, so the chip and the grid agree by construction. The topic-first pool is small, so Fuse's 100-hit cap no longer decides auto-clear.
- Auto-clear adds `topic:law` to the dismissed keys. With exact matching, that key can no longer remove the AI topic an "AI" query implies.

## Prevention

- **Loop over every topic, not only AI.** PR 223 added this check to `scripts/tests/search-engine-runtime.test.mjs`. Putting back the label re-injection fails 11 of 19 topics. A simplified version:

```js
test("a dismissed topic still finds an event that names only the typed word", () => {
  const misses = TOPICS.filter((topic) => {
    const word = topic.synonyms[0];
    const events = [
      { ...base, id: "typed-word", title: `Weekly ${word}` },
      // Gives the label's words real index postings, so Fuse does not step in.
      { ...base, id: "label-words", title: `Panel on ${topic.label}` },
    ];
    const dismissed = new Set([`topic:${topic.slug}`]);
    const { results } = searchEvents(events, word, buildSearchIndex(events), dismissed);
    return !results.some((event) => event.id === "typed-word");
  });
  assert.deepEqual(misses.map((topic) => topic.slug), []);
});
```

  `base` is a plain event with an empty description and no topics. No field may hold a label word. A "Student Life" tag would let the "Biology and Life Sciences" search match the typed-word event and hide the bug. Collecting the misses reports every failing topic at once.
- **Count from the list's own function.** A chip that describes a result list should use the list's function, pool, and keys. Assert both numbers in one UI test, as PR 215 does with "Climate and Energy, 3 events".
- **Run search UI tests on a real index.** Pass `searchIndex: buildSearchIndex(events)`. The Fuse-only path never applies `requiredCoreMatches`.
- **Match dismissed keys exactly.** Keep the test "a dismissed key for another topic keeps the query's own topic".
- **Check live chips after a search change.** Compare a few chip numbers with result counts on cal-events.com. The October 2 review found this bug in production numbers, not in the test suite. In another project, every real bug likewise came from live output, never from the tests (auto memory [claude]).

## Related Issues

- Fixed in PR 215, with the message fix and an index wait in PR 218.
- Review record: `docs/code-review-2026-10-02-topic-filter-fixes.md`, items 3 to 5.
- Earlier precedent: `docs/code-review-2026-09-25.md` item #2 restored typed words for source and category chips only.
- The September 4 review items #8 and #11 added the code paths that exposed this bug.
- Same blind spot, different checks: `docs/solutions/best-practices/publish-gate-recall-checks-need-frozen-fixtures.md` and `docs/solutions/logic-errors/precision-fix-left-arts-events-untagged.md`.
