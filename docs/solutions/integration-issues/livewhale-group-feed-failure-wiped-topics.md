---
title: All-or-nothing group feed health let one failed feed wipe its topics silently
date: 2026-10-03
category: integration-issues
module: LiveWhale group feeds and topic carry-forward
problem_type: integration_issue
component: background_job
symptoms:
  - One failed LiveWhale group feed cleared every topic that group gave while topic status said ok
  - A group feed that served an HTML page with status 200 counted as a healthy empty calendar
  - When every group feed failed, topics froze for all 13 sources and new events published with none
  - carried_forward_count was hard-coded to 0 on the ok path and undercounted carried rows
root_cause: logic_error
resolution_type: code_fix
severity: medium
related_components: [service_object]
tags: [livewhale, group-feeds, partial-failure, failed-groups, topic-carry-forward, silent-failure, html-200, daily-pipeline]
---

# All-or-nothing group feed health let one failed feed wipe its topics silently

## Problem

When one of the 40 LiveWhale department feeds failed, its events lost that group's topics while the topic stage reported `ok`. When all 40 failed, new events from healthy sources published with no topics. PR 219 fixed both on 2026-10-03.

## Symptoms

The October 2 review found these in the code, and PR 219's tests reproduce them.

- A failed group's topics vanished while `status.json` showed `topics.outcome: "ok"` and `carried_forward_count: 0`.
- The cron opens its topic issue only on `outcome: "error"`, so a partial failure opened nothing.
- A group feed that served an HTML page with status 200 counted as a healthy, empty calendar.
- With every group down, a brand-new Berkeley Law event published with no topics instead of Law.

## What Didn't Work

- **One health bit for 40 feeds.** `groupFeedsAreDegraded` in `scripts/sources/livewhale.ts` is true only when every feed fails. The comment above `fetchAllGroupFeeds` names 429 rate limiting as the likely failure, which usually hits some feeds, not all.
- **An unscoped rule that empty is final.** PR 174 let a successful empty assignment clear topics. That was right for stale tags. Next to the health bit above, a missing group's evidence read as "this event has no topic".
- **Freezing everything when all groups fail.** `forceError` skipped assignment and copied yesterday's topics onto every event from all 13 sources. Events new today had no yesterday, so they got none.
- **Trusting status 200.** Group feeds call `fetchFeed` with `minEvents` of 0, which returned whatever parsed. An HTML page parses to an empty calendar.
- **A test that could not fail.** The group-feed banner test ended by asserting that one object literal equals an identical literal. The same test also pinned the freeze-all behavior as correct. Tests like this pin assumptions, not reality (auto memory [claude]).

## Solution

PR 219 tracks failure per group and carries only the topics a failed group could have given.

1. In `fetchFeed`, a body without `BEGIN:VCALENDAR` counts as failed, and a group feed stops at once:

```ts
const ics = await res.text();
if (!ics.includes("BEGIN:VCALENDAR")) {
  lastErr = "response is not an iCal calendar";
  // A group feed gives up at once, so one broken group cannot spend
  // the adapter's time budget on retries.
  if (minEvents === 0) break;
}
```

2. `fetchLiveWhale` returns `failedGroups`, the names of the feeds that failed.
3. `groupTopicSlugs(groups)` in `scripts/lib/topics.ts` returns the topics in those groups' `GROUP_TOPICS` entries.
4. `assignTopicsResiliently` assigns every event fresh, then adds back only those group topics, and only on LiveWhale events:

```ts
const carried =
  event.source === "livewhale" && missingGroupTopics.size > 0
    ? validPreviousTopics(previousById.get(event.id)).filter(
        (slug) =>
          missingGroupTopics.has(slug) && !assignedTopics.includes(slug),
      )
    : [];
event.topics = [...assignedTopics, ...carried].slice(0, 3);
```

5. `scripts/updateEvents.ts` passes `missingGroups: failedGroups`, plus a `provenanceError` when every group failed. That keeps `outcome: "error"` for the all-down case.
6. `carried_forward_count` now counts carried rows and restored last-good rows.
7. The banner test now runs `markRecovery`, `buildStatusBanner`, and `shouldShowStaleDataBanner` on a healthy LiveWhale run with a topic error.

Five new or updated tests failed on `main` and passed after. A full live `npm run update-events` reported 13 of 13 sources ok and topics `ok`. No group feed failed in that run.

## Why This Works

- One health bit covered 40 feeds, but topic loss happens per group.
- A failed group can only remove the topics in its own `GROUP_TOPICS` entry. Only those carry over, and only on LiveWhale events. Everything else comes from fresh evidence, so stale topics still clear.
- With the physics feed down, a colloquium keeps yesterday's `physics-math-quantum` next to a fresh `law`. A reception's stale `history-humanities` stays gone.
- Assignment always runs now, so a new Berkeley Law event gets Law even when every group fails.
- Group failures never touch `degradedSources`, so visitors see no banner. AGENTS.md forbids routing non-source problems through those fields.
- The `break` skips the retry loop, so one broken group cannot use up the 60 s adapter budget.

Limits remain:

- A partial failure still reports `outcome: "ok"`. Its only traces are a warning line and a nonzero `carried_forward_count`.
- The fix keeps topics, not events. An event posted only to a failed group's feed is still missing that day.
- So far only unit tests cover the partial path.

## Prevention

- **Report failure per unit.** A fan-out fetch should return the list of failed units, not one boolean. Test one failure among many, not only all failing.
- **Check the body, not only the status.** A 200 can carry an error page. Look for the format marker before parsing.
- **Scope carry-forward to the missing evidence.** When empty output clears data, carry only what the failed input could have given.
- **Test each failure shape.** Cover one group failing, every group failing, and a group returning HTML with status 200. From PR 219:

```js
assert.deepEqual(result.failedGroups, ["physics"]);
assert.equal(result.groupFeedsDegraded, false);
```

- **Make every assertion read a value the code produced.** Reject `assert.deepEqual(literal, literal)` in review, and never hard-code a status counter.
- **Watch the quiet signals.** After a cron run, search the log for `group feed(s) failed` and read `jq '.topics' public/status.json`. A nonzero `carried_forward_count` means some rows kept yesterday's topics.

## Related Issues

- Fixed in PR 219. Review record: `docs/code-review-2026-10-02-topic-filter-fixes.md`, items 12, 13, 15, and 16.
- Origin: `docs/code-review-2026-09-04-topic-filter-layer.md` item #23 asked to mark the stage as an error and carry prior topics. Its all-or-nothing version is what PR 219 replaced.
- Logged earlier without a ticket: `docs/code-review-2026-09-25.md` residual risk on partial group-feed outages.
- Possible follow-up: write `failedGroups` into `status.json`, so a partial outage is visible without reading logs.
