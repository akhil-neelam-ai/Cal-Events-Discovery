# Inspect CalEvents Feed Status

Use this skill when a user asks whether CalEvents is fresh, whether the daily update worked, or whether source coverage is healthy.

## Data Source

Fetch the status report:

```http
GET https://cal-events.com/status.json
Accept: application/json
```

## Fields To Check

- `generated_at`: when the snapshot was generated
- `total_events`: number of published events
- `sources`: per-source health, count, duration, and errors
- `fallback_used`: whether cached source data was reused
- `fallback_sources`: sources whose cached events were reused
- `stale_fallback_sources`: sources whose cached events were too old and were dropped
- `last_good_used`: number of cached events restored
- `data_quality_blocked`: whether the dataset should be considered materially incomplete
- `topics.outcome`: whether topic assignment completed or returned an error
- `topics.assigned_count`: events assigned topics in this run
- `topics.carried_forward_count`: events that kept topics from the prior snapshot
- `topics.error`: optional topic assignment error

## Interpretation

- Report topic assignment separately from source health. A topic assignment error does not make an event source degraded.
- If `topics.outcome` is `error`, report `topics.carried_forward_count` and `topics.error`. Carried-forward topics can keep the snapshot usable.
- If `data_quality_blocked` is true, tell the user the feed may be incomplete.
- If `fallback_used` is true but `data_quality_blocked` is not true, treat the feed as usable and avoid user-facing warnings.
- If `stale_fallback_sources` includes `livewhale`, treat the feed as materially incomplete.
- If `stale_fallback_sources` includes only supplementary sources, explain that those sources were dropped but the rest of the feed can still be used.
- If a specific source is requested, inspect its entry in `sources`.
