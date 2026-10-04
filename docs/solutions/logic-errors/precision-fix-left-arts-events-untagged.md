---
title: Precision fix removed the only topic evidence for BAMPFA and Cal Performances
date: 2026-10-03
category: logic-errors
module: Pipeline topic assignment
problem_type: logic_error
component: service_object
symptoms:
  - 73 of 80 BAMPFA events and 38 of 53 Cal Performances events published with no topics
  - The Film topic fell from 147 events to 36, and Music from 105 to 50
  - The per-topic quality floor (count >= 1) passed while Film lost three quarters of its events
  - BAMPFA descriptions repeated the event title, so text rules had nothing to match
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components: [background_job, testing_framework]
tags: [topic-assignment, bampfa, cal-performances, event-types, source-identity, precision-recall, quality-floor, regression]
---

# Precision fix removed the only topic evidence for BAMPFA and Cal Performances

## Problem

On 2026-10-02, 73 of 80 BAMPFA events and 38 of 53 Cal Performances events had no topics. The Film chip fell from 147 events to 36, and Music and Performance fell from 105 to 50. PR 217 fixed it on 2026-10-03.

## Symptoms

- Film and Music lost most of their arts events once the daily cron rebuilt the feed with PR 174's rules.
- BAMPFA rows carried no text evidence. All 79 BAMPFA rows in the 2026-10-03 snapshot have a description equal to the title.
- No check flagged it. The per-topic floor asks only for `count >= 1`, and Film still had 36 events.

## What Didn't Work

- **Deleting the broad mappings.** PR 174 removed `bampfa: ["film", "visual-arts-exhibitions"]` and `cal_performances: ["music-performance"]` from `SOURCE_TOPICS`, plus the matching organizer patterns. That stopped cafe-hours notices from showing as Film. It also removed the only Film evidence most BAMPFA rows had.
- **Titles as fallback text.** The BAMPFA scraper read only the Google Calendar link, whose details held boilerplate. It fell back to the title, and "Band of Outsiders" never says "film".
- **A hand-patched feed.** The September 4 review said "Regenerate `public/events.json`." PR 174 hand-edited the file instead, so the shipped feed kept the old topics and the PR looked fine. The drop surfaced on the next cron.
- **A positive sample unlike real rows.** The labeled-samples fixture holds one BAMPFA film, "Film Screening: New Voices", with a real description. Real BAMPFA rows name only the film, so the precision suite stayed green.
- **An advisory suite that stayed red.** `test:topic-quality` failed every day from 2026-09-12 to 2026-10-03 on reference decay (issue 184). Its per-topic floor passed the whole time. Once red is normal, a new failure reads as more of the same.

## Solution

PR 217 reads the labels each publisher already prints and treats them as event-level evidence.

BAMPFA cards list labels in `ul.calendar_filter` and hold a summary in `.event-summary`. `scripts/sources/bampfa.ts` now reads both from the card around each calendar link:

```ts
const popup = $(el).closest(".popupboxthing");
const popupId = popup.attr("data-popup");
const eventTypes = popupId
  ? $(`[data-id="${popupId}"]`)
      .first()
      .closest(".event-content")
      .find("ul.calendar_filter li")
      .map((_j, item) => $(item).text().trim())
      .get()
      .filter(Boolean)
  : [];
```

`scripts/sources/cal_performances.ts` already parsed a genre slug from the URL path. It now passes it on as `event_types: genreSlug ? [genreSlug] : undefined`.

`scripts/lib/schema.ts` adds `event_types` to `CanonicalEvent`. The field is internal and never published. `scripts/lib/topics.ts` maps labels per publisher at weight 70:

```ts
const EVENT_TYPE_TOPICS = {
  bampfa: {
    film: ["film"],
    art: ["visual-arts-exhibitions"],
    workshop: ["workshops-skills"],
    performance: ["music-performance"],
  },
  cal_performances: {
    recital: ["music-performance"],
    dance: ["theater-dance"],
    "theater-opera": ["theater-dance", "music-performance"],
    // ...plus theater and the other music genres
  },
};
```

Labels with no subject, such as Tours, Free, family, and speakers, map to nothing.

A live adapter check cut untagged BAMPFA events from 96 to 14 of 122, and Cal Performances from 39 to 14 of 54. A full local `npm run update-events` left 2 of 80 BAMPFA and 12 of 52 Cal Performances events untagged, with Film at 96. The 2026-10-03 production snapshot was cut before PR 217 merged, so production shows the change from the 2026-10-04 run on.

## Why This Works

- PR 174 removed evidence and added none. The source name was the only sign that a BAMPFA row was a film.
- A source name tags every row, cafe hours included. A label belongs to one event. "Cafe Hours" carries no Film label, so it stays untagged, and PR 174's precision gain holds.
- `EVENT_TYPE_TOPICS` is keyed by source, so a "Film" label from another publisher assigns nothing.
- Weight 70 clears the confidence floor of 20 on its own, so a labeled film needs no title words.

## Prevention

- **Replace evidence before removing it.** Before deleting a mapping, count per source the events that depend on it. PR 217 ran `assignTopics` on a live fetch with and without labels.
- **Regenerate when assignment rules change.** Run `npm run update-events` and compare per-source untagged counts and per-topic totals with the committed snapshot. Discard the regenerated files and let the cron publish.
- **Pair each negative with a positive shaped like real rows.** PR 217's helper sets the description to the title, as the adapter does:

```js
const bampfa = (title, eventTypes) =>
  assignTopics(
    baseEvent({ source: "bampfa", title, description: title, event_types: eventTypes }),
  );
assert.deepEqual(bampfa("Band of Outsiders", ["Film"]), ["film"]);
assert.deepEqual(bampfa("Cafe Hours", ["Free"]), []);
```

- **Bound coverage per source, not only per topic.** A sketch for the advisory suite, not in the repo yet. It fails on the 2026-10-03 snapshot and passes on the fixed local run:

```js
for (const source of ["bampfa", "cal_performances"]) {
  const rows = published.events.filter((event) => event.source === source);
  assert.ok(rows.length > 0, `${source}: no rows`); // an empty set would pass vacuously
  const untagged = rows.filter((event) => event.topics.length === 0).length;
  assert.ok(untagged <= rows.length / 2, `${source}: ${untagged}/${rows.length} untagged`);
}
```

- **Keep advisory suites green.** Fix or freeze a decaying check right away, or the next real failure hides behind it.
- **Read the counts yourself.** A count of the production snapshot found this drop, not a test. In another project, every real bug likewise came from live output (auto memory [claude]).

## Related Issues

- Fixed in PR 217. Review record: `docs/code-review-2026-10-02-topic-filter-fixes.md`, item 1.
- Origin: `docs/code-review-2026-09-04-topic-filter-layer.md` item #6 asked for two halves, dropping the broad mappings and requiring event-level evidence. Only the first landed in PR 174.
- Not covered yet: PR 174 also removed the Haas mapping to Startups. Startups fell from 49 events to 9. Haas hikes were false positives, so part of that drop is intended, but nobody has measured the rest.
- Same blind spot, different checks: `docs/solutions/logic-errors/topic-label-reinjection-broke-chip-counts.md` and `docs/solutions/best-practices/publish-gate-recall-checks-need-frozen-fixtures.md`.
