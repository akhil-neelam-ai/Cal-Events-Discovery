# Architecture

This project is built around static published artifacts and a client-side search UI.

## Data Flow

1. `scripts/updateEvents.ts` runs the ingestion pipeline.
2. Each source adapter returns validated canonical events.
3. The orchestrator dedupes the union, projects it to the legacy public event shape, and writes:
   - `public/events.json`
   - `public/status.json`
   - `public/search-index.json`
4. The frontend loads those static files and filters locally.

## Source Of Truth

- `scripts/lib/schema.ts` defines the canonical pipeline schema and published status shape.
- `types.ts` re-exports the published status types for the frontend so the client and pipeline stay aligned.
- `services/geminiService.ts` is a legacy name. It loads static artifacts only; it does not call Gemini in the browser.

## Robustness Model

- Each source runs independently.
- A failing source is marked degraded in `status.json` instead of failing the whole build.
- The orchestrator refuses to replace a healthy dataset with an empty one.
- Last-good fallback is used for supported sources when that preserves coverage.
- Canonical events are Zod-validated before publication.

## Search And Runtime

- Search is client-side and uses `public/search-index.json`.
- The index is built with field weights for title, tags, organizer, location, and description.
- The client also receives `public/status.json` for freshness/degradation UI.

## Operational Expectations

- `@google/genai` is used only in `scripts/sources/gemini.ts` during Node-based ingestion.
- The GA4 measurement ID in `utils/analytics.ts` is public and not secret.
- Search terms are sent to analytics events, so retention and privacy policy should match that behavior.
- The published JSON artifacts are intended to be committed and deployed together.

## Why This Holds Up

- The architecture keeps the browser fast by shipping static JSON instead of live API calls.
- Source adapters can evolve independently without changing the frontend contract.
- The published status file makes degradation visible instead of silent.
- Shared type aliases reduce drift between the pipeline and the client.
