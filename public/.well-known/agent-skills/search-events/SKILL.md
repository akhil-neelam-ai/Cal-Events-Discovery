# Search CalEvents

Use this skill when a user asks for UC Berkeley events, campus activities, lectures, performances, sports games, workshops, startup events, or student-life events.

## Preferred path (browser WebMCP)

When the CalEvents homepage is open and WebMCP is available, call
`search_berkeley_events`. It uses the same ranked engine as the UI
(`search-index.json`, synonym expansion, intent detection, fuzzy fallback).

Optional inputs: `query`, `datePreset` (`today` | `tomorrow` | `week` |
`upcoming`), `category`, `topic`, `source`, `startDate`, `endDate`, `dismiss`,
`limit` (1 to 50), `offset`.
Call `list_filter_options` first for valid categories, active sources, date
presets, and topics. An unknown or retired value is an error, and so is a
`startDate` or `endDate` that is not `YYYY-MM-DD`. Matching ignores case, and
`"All"` clears a category or source. For `topic`, use
a slug from the published `topic_vocabulary.topics` block in `events.json`;
the vocabulary is the source of truth and may change.

Dates follow the UI. With no date input, date words in the query set the
range, so "concerts tomorrow" searches tomorrow only. With no date at all, the
search covers every upcoming day. A query's today or tomorrow widens to the
week when that day has no match. A `datePreset`, `startDate`, or `endDate` you
pass is a hard bound and never widens. `effectiveDateRange` says which range
ran, with `basis`, `requested`, and `widened`.

Read these outputs on every call:

- `relaxed` and `fallbackMessage`: when nothing matched, the engine drops the
  weekend, category, or topic filter and says so. Tell the user which filter
  was dropped. Do not present the results as exact matches.
- `interpretations`: chips the query set, each with a `key` and `label`. To
  undo one, call again with its key in `dismiss`, like the chip's "x" in the UI.
  Dismissal is search-only. `apply_ui_state` has no dismiss field, and the
  page clears dismissed chips whenever its URL changes.
- `total`, `offset`, `limit`: page with `offset += limit` while
  `offset < total`.

To show a similar view in the UI, call `apply_ui_state` with matching
`q` / `date` / `category` / `topic` / `source`. The URL has no form for
`startDate`, `endDate`, `limit`, `offset`, or `dismiss`, so the page can show a
different set. Call `get_ui_state` afterward and compare its `view`
(`effectiveDateRange`, `activeChips`, `resultCount`, `visibleEventIds`) with
your result before telling the user the page matches. Read it again while
`view.pending` is true. Right after `apply_ui_state`, the page may not have
rendered the new URL yet.

## Data Source (HTTP)

Fetch the normalized event feed:

```http
GET https://cal-events.com/events.json
Accept: application/json
```

For ranked offline search, also load `https://cal-events.com/search-index.json`.

## Procedure

1. Prefer WebMCP `search_berkeley_events` when available.
2. Otherwise read the top-level `events` array from `events.json`.
3. Treat `date` as an America/Los_Angeles calendar date in `YYYY-MM-DD`.
   A multi-day event also has `end_date` and `dates`, and `date` is only its
   first upcoming day.
4. Keep an event when any day in `dates` falls in the user's date window. Use
   `date` when `dates` is absent.
   A single-day timed event may also have `end_time`, in the same format as
   `time`. For a window that starts today, drop an event dated today once its
   `end_time` has passed on the Pacific clock. The UI does the same.
5. For category filtering, prefer the first value in `tags` because it is the primary displayed category.
6. For topic filtering, match the event's published `topics` slugs. Topics are independent of `tags`.
7. Return concise results with title, date, time, location, organizer, topics, and the official `url`.

## Supported Categories

- Academic
- Arts
- Sports
- Science & Tech
- Student Life
- Entrepreneurship

Topic slugs and labels are published in `events.json.topic_vocabulary.topics`.

## Notes

- Prefer official `url` links from events over internal CalEvents links when handing off to a user.
- Use `https://cal-events.com/status.json` if you need to explain feed freshness.
- Do not surface recovered fallback source details to users unless `data_quality_blocked` is true.
- Outcomes like "what's on tonight" live in MCP prompts / skills, not hardcoded tool workflows.
- Recent searches stay in the visitor's browser. No tool exposes them, on purpose.
