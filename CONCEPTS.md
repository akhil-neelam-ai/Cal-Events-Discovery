# Concepts

> Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Sources and feeds

### LiveWhale

The official UC Berkeley campus calendar and the backbone source: most published events come from it, and it is the only source whose loss can block publishing.

### Group feed

A LiveWhale calendar for one department or center, fetched alongside the main campus feed to catch events posted only there; an event's group memberships are topic evidence.

Groups are addressed by their exact full name. A near-miss name returns a valid empty calendar rather than an error, so a wrong name fails silently.

### Date window

A bounded slice of the LiveWhale main feed covering consecutive days, used because the unbounded feed silently stops partway and long responses can be cut off.

The end date is exclusive for timed events, so each window starts where the previous one ended. The first windows are **required**: an outright failure there degrades LiveWhale. Later windows, and a single day whose response stays cut off, are **best-effort**: they are reported as failed windows and never degrade the source.

## Health and recovery

### Degraded source

A source whose fetch failed or returned too few events this run; it drives the pipeline health check and the maintainer alerts, while visitors see no banner.

Group-feed and best-effort window failures are reported per unit and never make a source degraded. Quiet sources can restore old events without being listed as degraded.

### Last-good fallback

The recovery in which a degraded source's events from the previous published snapshot are restored for today and later, for a limited age.

Once a critical source's fallback is older than that limit, publishing is blocked rather than serving stale data.
