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
3. To share what the user sees now, call `get_ui_state`. Pass its `filters`
   and `selectedEventId` to `build_calevents_url`. Its `view` shows what the
   page displays, such as `effectiveDateRange` and `visibleEventIds`.
4. On an open CalEvents tab with WebMCP, call `apply_ui_state` so the UI updates
   to that workspace. It replaces the whole view unless you pass
   `mode: "merge"`. A `date` you pass stays in the URL. If a merge returns a
   conflict error, the visitor changed the page during the call. Call
   `get_ui_state`, then retry. Afterward, read `get_ui_state` again while
   `view.pending` is true.
5. Prefer the official event `url` when handing off to tickets or RSVP.

## Notes

- Copy-link in the UI uses the same `?event=` permalink pattern.
- There is no private share graph; links are public.
- Valid categories, sources, and topics come from `list_filter_options`. An
  unknown value returns an error instead of a link.
