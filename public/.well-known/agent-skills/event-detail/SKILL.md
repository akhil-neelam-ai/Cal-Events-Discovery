# Event detail

Use this skill when a user asks for details on a specific Berkeley event, a
deep link, directions, or the official page for one event id.

## Procedure

1. Call WebMCP `get_event_by_id` with the event `id`, or fetch
   `https://cal-events.com/events.json` and find the matching object.
2. Prefer fields from the tool/feed: `title`, `date`, `time`, `location`,
   `organizer`, `description`, `url`, `tags`, `source`.
3. When present, also return:
   - `directionsUrl` (Google Maps search for physical locations). WebMCP
     `get_event_directions` returns it for an id, or for raw location text.
   - `googleCalendarUrl` (Google Calendar template; may be null for multi-day gaps)
   - `permalink` (`https://cal-events.com/?event=<id>`)
   - `end_date` and `dates` for a multi-day event, so the user sees every day
   - `end_time` for a single-day timed event, so the user sees when it ends
4. Hand the user the official `url` for registration or tickets.

## Notes

- Do not invent times or venues. If the id is missing, say so.
- Online-only locations may have a null `directionsUrl`.
- To open the event on the page, call `apply_ui_state` with `mode: "merge"` and
  `event=<id>`. An unknown id returns `applied: false`. Pass `event: null` to
  close the panel. A conflict error means the visitor changed the page during
  the call. Call `get_ui_state`, then retry.
