# Share event

Use this skill when a user wants a shareable CalEvents link or to show the same
filters in the UI.

## URL schema

Shared workspace query params on `https://cal-events.com/`:

| Param      | Meaning                                               |
| ---------- | ----------------------------------------------------- |
| `q`        | Search query                                          |
| `date`     | `today` \| `tomorrow` \| `week` \| `upcoming`         |
| `category` | Primary category (e.g. `Arts`)                        |
| `topic`    | Topic slug from `events.json.topic_vocabulary.topics` |
| `source`   | Source id (e.g. `bampfa`)                             |
| `event`    | Selected event id                                     |

Defaults omit params (default date bucket is This Week).

## Procedure

1. For a single event, use `build_calevents_url` with `event=<id>`, or
   `https://cal-events.com/?event=<id>`.
2. To mirror a search the user can open, pass `q` / `date` / `category` /
   `topic` / `source` into `build_calevents_url`. Read valid topic slugs from
   `events.json.topic_vocabulary.topics`.
3. On an open CalEvents tab with WebMCP, call `apply_ui_state` so the UI updates
   to that workspace.
4. Prefer the official event `url` when handing off to tickets or RSVP.

## Notes

- Copy-link in the UI uses the same `?event=` permalink pattern.
- There is no private share graph; links are public.
