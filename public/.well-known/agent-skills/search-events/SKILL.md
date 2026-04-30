# Search CalEvents

Use this skill when a user asks for UC Berkeley events, campus activities, lectures, performances, sports games, workshops, startup events, or student-life events.

## Data Source

Fetch the normalized event feed:

```http
GET https://cal-events.com/events.json
Accept: application/json
```

## Procedure

1. Read the top-level `events` array.
2. Treat `date` as an America/Los_Angeles calendar date in `YYYY-MM-DD`.
3. Filter out events before the user's requested date window.
4. For category filtering, prefer the first value in `tags` because it is the primary displayed category.
5. Search across `title`, `description`, `organizer`, `location`, `tags`, and `source`.
6. Return concise results with title, date, time, location, organizer, and the official `url`.

## Supported Categories

- Academic
- Arts
- Sports
- Science & Tech
- Student Life
- Entrepreneurship

## Notes

- Prefer official `url` links from events over internal CalEvents links when handing off to a user.
- Use `https://cal-events.com/status.json` if you need to explain feed freshness.
- Do not surface recovered fallback source details to users unless `data_quality_blocked` is true.
