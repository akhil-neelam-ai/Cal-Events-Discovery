---
title: Run publish-gate recall checks on frozen fixtures, not a shrinking live corpus
date: 2026-10-03
category: best-practices
module: Daily publish gate search tests
problem_type: best_practice
component: testing_framework
severity: medium
applies_when:
  - A blocking gate such as npm run validate asserts recall or overlap against live data
  - A reference set loses members over time as past events leave the feed
  - 'A threshold is written as Math.min(N, remaining) over a set that can shrink'
  - A fallback can return every event and pass a recall check for the wrong reason
symptoms:
  - The live AI overlap check demanded 18 of 18 remaining references on 2026-10-02
  - The same check would pass vacuously once every reference event had passed
  - One upstream edit to a reference event could have blocked the daily publish
root_cause: test_isolation
resolution_type: test_fix
related_components: [background_job, service_object]
tags: [publish-gate, live-corpus, frozen-fixtures, recall-threshold, vacuous-assertion, search-fallback, test-design, validate]
---

# Run publish-gate recall checks on frozen fixtures, not a shrinking live corpus

## Context

The daily cron runs `npm run validate` in its "Validate published artifacts" step, before it opens the data pull request. `scripts/tests/search-engine-runtime.test.mjs` runs inside that step. AGENTS.md says live-corpus quality failures never block the data pull request.

PR 174 still added one there. It looked up 56 AI reference events in `public/events.json` and asserted `overlap >= Math.min(50, referenceIds.length)`. Events leave the feed once they pass, so the set shrank every day.

## Guidance

- **Test code on frozen inputs inside the gate.** Build events from fixture text, run the real `assignTopics`, and build a fresh index.
- **Read the live feed in the gate only for rules every valid snapshot meets.** Schema and sort order qualify. Recall does not.
- **Put live golden queries in the advisory suites.** `test:search-quality` and `test:topic-quality` run with `continue-on-error` and open a `data-quality` issue on failure.
- **Ask what each threshold does as its set shrinks to zero.** A floor over a shrinking set turns strict, then empty.
- **Assert the code path as well as the count.** A topic search that falls back returns every event and clears any recall floor.
- **Pin the sample size next to the threshold,** as `topic-quality.test.mjs` does with `assert.ok(labeled.samples.length >= 10)`.

## Why This Matters

`Math.min(50, referenceIds.length)` demanded 100% recall from the first day. At PR 174's merge, 42 references were in the feed, so it needed 42 of 42. On 2026-10-02 it needed 18 of 18. One upstream edit to one reference event could have failed validate and frozen the site on old data. Once every reference aged out, it would assert `0 >= 0` and pass on nothing.

The advisory suite shows the other failure mode. Its live reference check failed every day from 2026-09-12 to 2026-10-03, which kept issue 184 open through 22 reports. PR 202 froze that suite's reference text. A red check that stays red stops being read.

A frozen site can also look green. One of the two daily cron runs skips itself and still reports success, so check the run that was not skipped (auto memory [claude]).

## When to Apply

- A test in `test:scripts` reads data files under `public/`. Today that means `search-engine-runtime.test.mjs` and `stability.test.mjs`.
- A threshold is computed from a live count, such as `Math.min(50, n)`.
- A recall or precision check could pass through a fallback.

## Examples

Before, in PR 174:

```js
const publishedIds = new Set(published.events.map((event) => event.id));
const referenceIds = aiReferenceSet.references
  .map((reference) => reference.id)
  .filter((id) => publishedIds.has(id) && !knownNonAiHomonyms.has(id));

const output = searchEvents(published.events, "AI", publishedSearchIndex);
const resultIds = new Set(output.results.map((event) => event.id));
const overlap = referenceIds.filter((id) => resultIds.has(id)).length;
assert.ok(overlap >= Math.min(50, referenceIds.length));
```

After, in PR 219, simplified from the test `"AI" finds the frozen AI reference events`:

```js
const events = aiReferenceSet.references
  .filter((reference) => !knownNonAiHomonyms.has(reference.id))
  .map(fromFixture)
  .map((event) => ({ ...event, topics: assignTopics(event) }));

const output = searchEvents(events, "AI", buildSearchIndex(events));

// A fallback would return every event and pass for the wrong reason.
assert.equal(output.fallbackUsed, false);
assert.ok(
  output.results.length >= Math.ceil(aiReferenceSet.minimumRecall * events.length),
  `AI search found ${output.results.length}/${events.length} frozen reference events`,
);
```

`fromFixture` stands in for the test's inline mapping from fixture fields to an event. Every result comes from the frozen set, so the result count is the overlap. The fixture holds 56 references. Dropping 5 known homonyms leaves 51, and all 51 match against a floor of 46.

The fallback assert matters. Run on frozen text with no topics assigned, "AI" sets a topic filter that no event passes. The topic drop then returns all 51 events with `fallbackUsed: true`, which would pass the count.

One live check remains in the gate. It asks only that AI results span two or more categories, which any healthy snapshot meets.

## Related

- Fixed in PR 219. Review record: `docs/code-review-2026-10-02-topic-filter-fixes.md`, item 14.
- First occurrence: `docs/code-review-2026-09-25.md` item #14, the advisory suite's version of the same decay, fixed in PR 202.
- Origin: `docs/code-review-2026-09-04-topic-filter-layer.md` item #17 asked for reference overlap and got a live-feed check.
- Same blind spot, different checks: `docs/solutions/logic-errors/topic-label-reinjection-broke-chip-counts.md` and `docs/solutions/logic-errors/precision-fix-left-arts-events-untagged.md`.
