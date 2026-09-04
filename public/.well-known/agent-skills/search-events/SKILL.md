# Search CalEvents

Use this skill when a user asks for UC Berkeley events, campus activities, lectures, performances, sports games, workshops, startup events, or student-life events.

## Preferred path (browser WebMCP)

When the CalEvents homepage is open and WebMCP is available, call
`search_berkeley_events`. It uses the same ranked engine as the UI
(`search-index.json`, synonym expansion, intent detection, fuzzy fallback).

Optional inputs: `query`, `datePreset` (`today` | `tomorrow` | `week` |
`upcoming`), `category`, `topic`, `source`, `startDate`, `endDate`, `limit`.
For `topic`, use a slug from the published `topic_vocabulary.topics` block in
`events.json`; the vocabulary is the source of truth and may change.

To show the same results in the UI, call `apply_ui_state` with matching
`q` / `date` / `category` / `source`.

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
4. Filter out events before the user's requested date window.
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
