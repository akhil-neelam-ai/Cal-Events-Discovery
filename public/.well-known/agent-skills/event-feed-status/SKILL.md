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
- `last_good_used`: number of cached events restored
- `data_quality_blocked`: whether the dataset should be considered materially incomplete

## Interpretation

- If `data_quality_blocked` is true, tell the user the feed may be incomplete.
- If `fallback_used` is true but `data_quality_blocked` is not true, treat the feed as usable and avoid user-facing warnings.
- If a specific source is requested, inspect its entry in `sources`.
