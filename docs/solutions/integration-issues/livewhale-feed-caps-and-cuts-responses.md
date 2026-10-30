---
title: LiveWhale's iCal feed silently caps and cuts responses mid-event
date: 2026-10-29
last_updated: 2026-10-30
category: integration-issues
module: LiveWhale main feed and source contract
problem_type: integration_issue
component: background_job
symptoms:
  - "The pre-fix LiveWhale fetch threw `empty/short feed (0 VEVENTs, need ≥ 50)` while curl showed 113 events in the body"
  - The bare feed returned the same 237,127-byte body on every request, ending at `SUMMARY:` with no END:VCALENDAR
  - Published LiveWhale events thinned out about two weeks ahead, with near zero per day after that
  - The weekly LiveWhale source contract stayed green against the cut body
root_cause: wrong_api
resolution_type: code_fix
severity: high
related_components: [testing_framework]
tags:
  [
    livewhale,
    ical,
    node-ical,
    truncation,
    silent-cap,
    date-windows,
    source-contracts,
    partial-failure,
    daily-pipeline,
  ]
retire_when: "LiveWhale serves the bare /live/ical/events feed past two weeks and never ends a body without END:VCALENDAR; check by fetching a 60-day window and several one-day windows"
---

# LiveWhale's iCal feed silently caps and cuts responses mid-event

## Problem

The LiveWhale adapter read one URL, `https://events.berkeley.edu/live/ical/events`. Late on 2026-10-29 PT (2026-10-30 UTC) that URL started returning a body cut off mid-event, and node-ical read it as an empty calendar, so LiveWhale (the only source whose failure blocks publishing) failed. The same URL had also been silently stopping at about two weeks of events all along.

## Symptoms

- The pre-fix `fetchLiveWhale` threw `LiveWhale fetch failed after 3 attempts: empty/short feed (0 VEVENTs, need ≥ 50)`.
- `curl` of the same URL showed 113 `BEGIN:VEVENT` lines. The body was always 237,127 bytes and ended at `SUMMARY:` with no `END:VCALENDAR`.
- In `public/events.json`, LiveWhale rows ran 25 to 91 a day through 2026-11-11, then 0 to 9 a day.
- The `livewhale` source contract passed, because it checked only for `BEGIN:VCALENDAR` and a body over 10,000 bytes.

## What Didn't Work

- **Reading the event count as the health signal.** A cut body parses without error to zero events, so the old `fetchFeed` reported "short feed" and retried. Retrying the same URL returned the same cut body every time.
- **Cache-busting.** A random query string fixed the bare URL once, but not date windows: a cut window came back cut, byte for byte, with or without `?cb=`. The cut is tied to response content, not to a stale cache entry.
- **`/max/N` and `/paginate/N`.** `/max/1000` changed nothing. `/paginate/1000` returned 1,898 well-formed events through 2027 but silently left out 491 of 873 events in one test window.
- **One long date window.** `start_date/<a>/end_date/<b>` windows longer than about two weeks stop at 926 to 968 events with no sign they stopped.
- **Assuming one-day windows always render.** Splitting a cut week into smaller windows usually recovers it, but the one-day window for 2026-11-21 came back cut on some requests (17 of 31 events) and complete on others.

## Solution

The fix landed on branch `fix/livewhale-windowed-feed` (PR pending as of this writing). See `scripts/sources/livewhale.ts`:

1. **Weekly windows.** `liveWhaleWindowKeys` (`livewhale.ts:553`) builds PT date keys from a week back to eight weeks ahead in 7-day steps. Consecutive keys form one window each through `liveWhaleWindowUrl` (`livewhale.ts:569`).
2. **A complete calendar or nothing.** `calendarProblem` (`livewhale.ts:454`) rejects a body without `BEGIN:VCALENDAR`, and treats one that does not end with `END:VCALENDAR` as cut.
3. **Split, then salvage.** `fetchWindow` (`livewhale.ts:593`) refetches a cut window, or one at `WINDOW_SPLIT_THRESHOLD` (900, `livewhale.ts:50`) or more events, as two halves down to single days. A single day that stays cut keeps every complete event before the cut through `salvageCutCalendar` (`livewhale.ts:441`):

```ts
const lastEnd = body.lastIndexOf("END:VEVENT");
if (lastEnd === -1) return {};
return ical.sync.parseICS(
  `${body.slice(0, lastEnd + "END:VEVENT".length)}\r\nEND:VCALENDAR\r\n`,
);
```

4. **Required versus best-effort.** `fetchMainWindows` (`livewhale.ts:695`) throws only when one of the first `REQUIRED_WINDOW_COUNT` (3) windows fails outright with an error page or a network failure, or when those windows hold fewer than 50 events. A cut day, or any later window that fails, is listed in `failed_windows` on the LiveWhale entry in `status.json` and never degrades the source.
5. **Group feeds** take the same completeness check with one attempt, so a cut group feed lands in `failed_groups` and its topics carry forward.
6. **Source contract.** The `livewhale` entry in `scripts/lib/sourceContracts.mjs` now probes today's one-day window (built at `sourceContracts.mjs:36`) and requires `END:VCALENDAR`.

## Why This Works

The upstream fault is in how LiveWhale renders some responses. Every observed cut stopped at `SUMMARY:` just before an event whose title holds a 4-byte emoji ("🏈 Chapters Watch Party"). The same event renders fine in other windows, so size or position matters too, and the exact trigger is unknown. Checking for `END:VCALENDAR` turns a silent empty calendar into a visible failure. Smaller windows change the response, which usually avoids the cut, and salvage bounds the loss when it does not. Weekly windows also stay far below the silent ~950-event cap. The busiest week seen held 526 events.

LiveWhale's `end_date` is exclusive for timed events but includes the all-day events of the end day. Windows therefore share keys (`[a,b)`, then `[b,c)`), and the all-day rows that appear in both merge by UID. Building each window as `start..start+6` would drop every timed event on every seventh day, with no error anywhere.

## Prevention

- Treat `END:VCALENDAR` as the health check for any LiveWhale iCal body, including group feeds. Never use the parsed event count alone.
- Never fetch an unbounded or multi-week LiveWhale window. Stay under 900 events per request.
- Group feed URLs need the group's exact LiveWhale full name. A near miss, such as "and" for "&", returns a valid empty calendar. Check that a new group returns more than 0 events before adding it.
- When adding a LiveWhale endpoint, probe it twice and compare byte counts. An identical size that ends mid-line is the cut, not a timeout.
- `scripts/tests/livewhale-windows.test.mjs` pins the window keys across DST, the boundary day, splitting, salvage, the near-cap split (its stub caps windows wider than one day), and the health floor.
- A cut day is refilled from LiveWhale's JSON endpoint (`/live/json/events/start_date/<d>/end_date/<d+1>/response_fields/location,description,event_types`), which returned all 31 events for 2026-11-21 while the iCal window was cut. Its IDs and UTC start times rebuild the iCal UID, so group-feed copies still merge. Without `response_fields`, the JSON omits location and description.
- A failed, unfilled, or empty window lands in `failed_windows`, and the daily workflow opens a `data-quality` issue for it. Nothing about a partial day degrades the source.

## Related

- `docs/solutions/integration-issues/livewhale-group-feed-failure-wiped-topics.md`: per-group failure and topic carry-forward, which this change keeps.
