# Cal Events Discovery

UC Berkeley campus events in one searchable feed. The site ships a static snapshot (~900+ upcoming events) built from 11 Berkeley sources, updated daily by GitHub Actions, hosted on Vercel at [cal-events.com](https://cal-events.com).

## Quick start

**Requirements:** Node 22+, npm 10+

```bash
git clone https://github.com/akhil-neelam-ai/Cal-Events-Discovery.git
cd Cal-Events-Discovery
npm ci
npm run dev          # http://localhost:5173
```

The app reads committed artifacts in `public/`. To refresh them locally:

```bash
npm run update-events
```

## Commands

| Command | What it does |
|---------|--------------|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build → `dist/` |
| `npm run typecheck` | `tsc --noEmit` only |
| `npm run validate` | Lint, format, typecheck, publish-critical script tests, UI tests |
| `npm run test:search-quality` | Live corpus golden queries (non-blocking on the daily publish path) |
| `npm run update-events` | Full ingestion pipeline → `public/*.json` |
| `npm run test:e2e` | Build + Playwright |
| `vercel --prod` | Deploy to Vercel |

## How it works

```
Berkeley sources (iCal, REST, HTML scrapers)
        ↓
scripts/updateEvents.ts  (parallel adapters, dedupe, fallback)
        ↓
public/events.json       (~1 MB, published events)
public/search-index.json (~370 KB, inverted index)
public/status.json       (per-source health)
        ↓
React app loads JSON client-side, search runs in-browser
        ↓
Vercel CDN → cal-events.com
```

1. **Ingestion** — `scripts/updateEvents.ts` runs 12 source adapters in parallel (60s timeout each), dedupes, writes three JSON files.
2. **Automation** — Daily cron opens a PR on `automation/update-events` with updated artifacts.
3. **Merge** — PR runs validate + E2E, auto-merges to `main` if green.
4. **Deploy** — Vercel deploys `main`. Production smoke test hits live URLs.

Deep architecture: see [ARCHITECTURE.md](./ARCHITECTURE.md). Agent/adapter details: see [CLAUDE.md](./CLAUDE.md).

## CI/CD workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| **Validate** | PR + push to `main` (ignores artifact-only commits) | Lint, format, typecheck, 94+ tests |
| **Browser E2E** | PR + push to `main` (ignores artifacts) | Playwright against production build |
| **Update Events Daily** | 4:00 AM Pacific (cron) + manual | Fetch sources, health check, publish-critical validate, open automation PR; corpus search-quality is non-blocking |
| **Security Audit** | Weekly Monday + manual | `npm audit` (prod deps); opens a `security-audit` issue on findings |
| **Source Contracts** | Weekly Monday + manual | Live HTTP checks against all 9 Berkeley endpoints |
| **Production Smoke** | Every push to `main` | Verify `cal-events.com` serves fresh events + status |

The daily merge gates on the **data-relevant** checks only (`validate` and
`browser-e2e`). Dependency auditing is deliberately *not* a merge gate: a newly
published upstream CVE surfaces as a tracked issue via the Security Audit
workflow instead of blocking the daily data PR.

```mermaid
flowchart LR
  subgraph daily [Daily pipeline]
    A[update-events cron] --> B[checkFeedHealth]
    B --> C[validate artifacts]
    C --> D[automation PR]
    D --> E[validate + E2E on PR]
    E --> F[auto-merge main]
  end
  F --> G[Vercel deploy]
  G --> H[production-smoke]
```

## GitHub secrets

Set these in **Settings → Secrets and variables → Actions**:

| Secret | Required | Purpose |
|--------|----------|---------|
| `AUTOMATION_PR_TOKEN` | **Yes for cron** | PAT with `contents` + `pull_requests` write. Lets the automation PR trigger downstream E2E and auto-merge. Scheduled runs fail without it. |

`workflow_dispatch` runs work without `AUTOMATION_PR_TOKEN`, but the PR won't auto-merge.

### Rotating `AUTOMATION_PR_TOKEN`

**PATs expire.** When this one does, the pipeline still fetches, validates, and
commits a perfectly good snapshot — it just cannot push it. Set a calendar
reminder for the expiry date you choose.

The `Check automation token` step validates the token before the run does any
work and prints the remediation. An expired token no longer loses the day's
data: the snapshot PR is opened with `GITHUB_TOKEN` instead, so the events are
one manual merge away, and the run is marked failed so an issue is filed.

To rotate: regenerate the PAT (Contents + Pull requests write on this repo),
update the `AUTOMATION_PR_TOKEN` secret, then re-run **Actions → Update Events
Daily → Run workflow**.

## Reading `status.json`

After every pipeline run, check `public/status.json` (or `https://cal-events.com/status.json`):

```json
{
  "generated_at": "2026-05-23T18:54:15.982Z",
  "total_events": 942,
  "degraded": false,
  "fallback_used": false,
  "sources": [{ "name": "livewhale", "ok": true, "count": 1296, ... }]
}
```

| Field | Meaning |
|-------|---------|
| `degraded` | At least one source failed or fell below its health threshold |
| `fallback_used` | Stale events from the previous snapshot were restored for a failing source |
| `fallback_age_hours` | How old the fallback data is |
| `data_quality_blocked` | Pipeline refused to publish (strict mode in CI) |

**Thin coverage warnings** (non-blocking): CalLink returning 1 event when ≥5 is expected, etc. Surfaced as `::warning::` in CI via `scripts/lib/sourceCoveragePolicy.ts`.

## Troubleshooting

### Daily cron failed

1. Open the failed run in **Actions → Update Events Daily**.
2. Check for an open issue labeled **`pipeline-failure`** (auto-created on publish-path failure: LiveWhale/backbone or merge breakage).
3. Corpus/search golden-query mismatches open **`data-quality`** instead and do **not** block the snapshot.
4. Common causes:
   - Missing `AUTOMATION_PR_TOKEN` on scheduled runs
   - **Expired or revoked `AUTOMATION_PR_TOKEN`.** The pipeline is healthy and
     every check passes, then the run dies at `Create artifact update pull
     request` with `fatal: could not read Username for 'https://github.com'`.
     That git message means the token was rejected, not that a username is
     missing — see [Rotating `AUTOMATION_PR_TOKEN`](#rotating-automation_pr_token).
   - LiveWhale (the backbone source) down with no fallback (`checkFeedHealth`
     blocks). Supplementary sources degrade to last-good data and only warn.
   - A required PR check (`validate` or `browser-e2e`) failed on the automation PR

Re-run manually: **Actions → Update Events Daily → Run workflow**.

### Production data looks stale

1. Hit `https://cal-events.com/status.json` — check `generated_at`.
2. Check if an open `automation/update-events` PR is stuck unmerged. When the
   automation token is unusable the snapshot lands there instead of on `main`,
   and merging it publishes the data.
3. **Production Smoke** fails if status is >36h old. It runs on every push to
   `main` _and_ daily at 20:00 UTC — the daily run is the one that catches
   publishing having stopped, since a push-triggered check only ever sees data
   that was just published. On failure it files a `pipeline-failure` issue.

### A source broke (Berkeley changed their site)

1. **Source Contracts** workflow (weekly) catches this early.
2. Run locally: `node scripts/runSourceContracts.mjs`
3. Fix the adapter in `scripts/sources/`, add a parser test in `scripts/tests/`.

### Local health check

```bash
npx tsx scripts/checkFeedHealth.ts        # exits 1 on blocking issues
node scripts/runSourceContracts.mjs       # live endpoint smoke
npm run validate                            # publish-critical suite
npm run test:search-quality                 # live corpus golden queries
```

## Sources

| Source | Adapter | Method |
|--------|---------|--------|
| LiveWhale (campus calendar) | `livewhale.ts` | iCal + 35 department group feeds |
| CalLink (student orgs) | `callink.ts` | CampusGroups JSON API (~16 event cap) |
| Cal Performances | `cal_performances.ts` | WordPress REST |
| Cal Bears athletics | `calbears.ts` | iCal |
| BAMPFA | `bampfa.ts` | HTML scraper |
| Berkeley Haas / Law / BEGIN | `tribe.ts` | Tribe Events Calendar REST |
| Simons Institute | `simons.ts` | JSON API |
| Luma (Berkeley calendars) | `luma.ts` | Luma JSON API |
| Berkeley AI Risk | `ai_risk.ts` | JS schedule scrape |

## Deploy

Vercel auto-deploys `main`. Manual deploy:

```bash
npm run build
vercel --prod
```

Post-deploy verification runs automatically via **Production Smoke** on every `main` push.

## Notes

- `services/eventsLoader.ts` only loads static JSON in the browser.
- GA4 in `utils/analytics.ts` sends search terms to analytics. The measurement ID is public; tune retention in GA4 if needed.
- Pipeline deps (`cheerio`, `node-ical`, etc.) are in `dependencies` for CI script runs but are not bundled into the frontend.
