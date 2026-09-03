# Calendar export

Use this skill when a user wants to add a Berkeley event to a calendar.

## Procedure

1. Resolve the event with WebMCP `get_event_by_id` or `events.json`.
2. Prefer WebMCP `generate_event_ics` for a portable `.ics` payload
   (`America/Los_Angeles` times).
3. If `googleCalendarUrl` is present on the event or ICS tool result, offer that
   for Google Calendar. If it is null (gappy multi-day runs), stick to `.ics`.
4. Filename convention from the tool: `event-<id>.ics`.

## Notes

- CalEvents does not create or store calendar accounts. Export is read-only.
- Multi-occurrence events may only round-trip fully via `.ics`.
