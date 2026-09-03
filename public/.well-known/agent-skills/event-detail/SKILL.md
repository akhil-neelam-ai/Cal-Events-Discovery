# Event detail

Use this skill when a user asks for details on a specific Berkeley event, a
deep link, directions, or the official page for one event id.

## Procedure

1. Call WebMCP `get_event_by_id` with the event `id`, or fetch
   `https://cal-events.com/events.json` and find the matching object.
2. Prefer fields from the tool/feed: `title`, `date`, `time`, `location`,
   `organizer`, `description`, `url`, `tags`, `source`.
3. When present, also return:
   - `directionsUrl` (Google Maps search for physical locations)
   - `googleCalendarUrl` (Google Calendar template; may be null for multi-day gaps)
   - `permalink` (`https://cal-events.com/?event=<id>`)
4. Hand the user the official `url` for registration or tickets.

## Notes

- Do not invent times or venues. If the id is missing, say so.
- Online-only locations may have a null `directionsUrl`.
