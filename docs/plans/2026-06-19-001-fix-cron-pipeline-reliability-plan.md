---
title: "fix: Cron pipeline reliability — decouple data refresh from unrelated gates"
type: fix
status: active
created: 2026-06-19
plan_source: solo
---

# fix: Cron pipeline reliability — decouple data refresh from unrelated gates

## Summary

The `Update Events Daily` cron is a **data-refresh** job, but its success is gated on
three classes of conditions that have nothing to do with whether fresh event data was
produced: the repo's security-audit posture, flaky third-party feed availability, and
GitHub PR/merge plumbing. Each is time-dependent and can turn the job red with zero
code changes. The team has been applying reactive hotfixes (drop `callink` from critical,
scope `npm audit` to prod deps, fix the schedule-gate cron match) but the underlying
design keeps producing new failure modes.

This plan separates "did we produce good data?" (the job's actual purpose) from "is the
repo's security/quality posture perfect?" (a separate concern), and makes the merge path
robust against unrelated red checks.

---

## Problem Frame

### Observed failure taxonomy (last ~10 scheduled rounds)

| Date | Run | Failing step | Root cause class |
|------|-----|--------------|------------------|
| 2026-06-19 | 27830125251 | Wait for checks and merge PR | **A — security audit** |
| 2026-06-15 | 27559927657 | Wait for checks and merge PR | **A — security audit** |
| 2026-06-03 | 26894993149 | Generate events snapshot | **B — strict data-quality gate** (`callink`) |
| 2026-06-02 | 26828100224 | Generate events snapshot | **B — strict data-quality gate** (`callink`) |
| 2026-05-25 | 26404727160 | Create PR + notifier crash | **C — PR/merge plumbing** |

Note: the quick (6–16s) scheduled runs are the dual-cron `schedule-gate` skips and are
expected. Real work runs take 2–7 min; the failures are all in the long runs.

### Root cause A — security audit is a time-bomb merge gate (UNRESOLVED)

`validate.yml` runs `npm run audit:security` (`npm audit --audit-level=moderate --omit=dev`)
as a **required** check. The cron's final step runs
`gh pr checks --watch --fail-fast`, which fails the entire job if *any* check on the
automation PR is red. When a new CVE is published upstream, the audit check turns red and
every PR — including the daily data PR — can no longer merge, with no code change.

PR #113 ("Scope npm audit to production deps") did **not** fix this: `undici` is a
*production* transitive dependency (`cheerio@1.2.0 → undici@7.25.0`), so `--omit=dev`
still flags it. The 2026-06-19 failure happened *after* #113 landed.

### Root cause B — strict data-quality gate hard-fails on external fragility (PARTIALLY FIXED)

`STRICT_DATA_QUALITY=true` makes the orchestrator abort when a `CRITICAL_SOURCES` member
is "degraded without fallback." Between terms, `callink` returns zero events and has no
prior data to fall back to, so the whole publish aborts. Already mitigated by dropping
`callink` from `CRITICAL_SOURCES` (PR #102), but the same trap remains for any other
critical source whose endpoint changes or that goes sparse (e.g. `bampfa` timeouts,
`simons`, `ehub`, `luma`, `begin` between terms).

### Root cause C — PR/merge plumbing and alerting are fragile (PARTIALLY ADDRESSED)

- `peter-evans/create-pull-request@v8` hit `git exit 128` (2026-05-25).
- The `notify-failure` job itself crashed on `gh issue create` — the failure handler is
  not best-effort, so operators can get no signal precisely when the pipeline breaks.
- `gh pr checks --watch --fail-fast` blocks synchronously for up to ~6 min before failing,
  burning Actions minutes and coupling the cron's runtime to unrelated check latency.

### Common thread

External, time-dependent fragility (new CVEs, flaky feeds, transient git/API errors) is
wired into **hard-fail, all-or-nothing gates**, and the merge step fails on checks
unrelated to data correctness. A daily data refresh should publish good data whenever it
can and degrade loudly-but-gracefully otherwise.

---

## Goals / Non-Goals

**Goals**
- A new upstream CVE never blocks the daily data PR from merging.
- A single flaky or sparse third-party source never hard-fails the publish; it degrades to
  last-good data and warns.
- The merge step gates only on data-relevant checks and never hangs the job.
- Failure alerting is reliable (best-effort, never crashes) and classifies the failure.

**Non-Goals**
- Reworking the source adapters' scraping logic or adding new sources.
- Changing the dual-cron / schedule-gate Pacific-time mechanism (it works as intended).
- Removing security auditing — it stays, just off the data-publish critical path.

---

## Key Technical Decisions

1. **Security audit moves off the publish/merge critical path.** Run it as its own
   scheduled workflow that opens/updates a tracked issue; remove it as a blocking step in
   `validate.yml`. Rationale: security hygiene is real but is a *repo-maintenance* concern
   on its own cadence, not a per-data-refresh gate. Dependabot already handles upgrades.
2. **Immediate unblock via `overrides`.** Add an `npm` `overrides` entry to pull `undici`
   to a patched version under `cheerio` so today's red turns green without waiting for the
   workflow split. Cheap, reversible, removable once `cheerio` ships a fixed transitive.
3. **Merge gates on required data checks only.** Replace `gh pr checks --watch --fail-fast`
   (fails on any red check) with GitHub native auto-merge (`gh pr merge --auto`) backed by
   branch protection's required-status-checks set, or an explicit allowlist watch loop.
   Auto-merge also decouples the cron runtime from check latency.
4. **Right-size "critical" sources.** Only `livewhale` (the backbone, majority of events)
   should hard-block when degraded-without-fallback. All other sources warn and rely on
   last-good fallback. Rationale: matches the architecture note that LiveWhale is the
   backbone and others are supplementary.
5. **Alerting is best-effort.** `notifyPipelineFailure` must never throw / exit non-zero,
   and the `notify-failure` job must run for every failure class.

---

## Implementation Units

### U1. Immediate unblock: override vulnerable transitive dep

**Goal:** Turn the current red audit green today so data PRs merge while the larger
decoupling lands.
**Files:** `package.json`, `package-lock.json`
**Approach:** Add an `overrides` block pinning `undici` to the patched release advised by
the GHSA advisories (>= 7.27.3 or current patched line). Run `npm install` to update the
lockfile. Verify `npm run audit:security` exits 0.
**Test scenarios:**
- `npm audit --audit-level=moderate --omit=dev` exits 0 after the override.
- `npm run build` and `npm run test:ui` still pass (no behavior regression from the bump).
- `npm ls undici` shows the overridden version under `cheerio`.
**Verification:** Local audit is clean; a re-run of `validate` on a test branch is green.

### U2. Decouple security audit from the publish/merge path

**Goal:** A future CVE cannot block the data PR.
**Files:** `.github/workflows/validate.yml`, new `.github/workflows/security-audit.yml`,
`scripts/notifyPipelineFailure.mjs` (reuse for issue creation)
**Approach:** Remove the `Audit dependencies` step from `validate.yml` (or make it
`continue-on-error` with no effect on conclusion). Add a standalone weekly
`security-audit` workflow that runs `npm run audit:security` and, on findings, opens or
updates a `security-audit` labelled issue (reuse the notifier's dedupe pattern). Keep
`audit:security` in `package.json` for local/manual use.
**Approach note:** Confirm branch-protection required checks do not still list the audit
step under the old job name after the edit (U3 owns the required-check set).
**Test scenarios:**
- `validate.yml` no longer contains a blocking audit step; the workflow's other steps
  (lint, format, typecheck, unit tests) are unchanged.
- A simulated audit finding in the new workflow opens exactly one issue and updates it on
  the next run rather than spamming.
- `Test expectation: workflow-level` — validated by a dispatch run on a branch.
**Verification:** A red audit no longer blocks PR merge; security findings still surface
as issues.

### U3. Make the cron merge step gate only on data-relevant checks

**Goal:** The merge never fails on an unrelated red check and never hangs the job.
**Files:** `.github/workflows/update-events.yml`; repo branch-protection settings (documented
in `README.md` automation section)
**Approach:** Prefer GitHub native auto-merge: after `create-pull-request`, call
`gh pr merge --auto --merge "$pr_number"` so GitHub merges when required checks pass,
independent of the cron job's wall-clock. Define the required-status-checks set on `main`
to the data-relevant checks only (Validate's lint/typecheck/unit + Browser E2E). If native
auto-merge is not enabled for the repo, replace `--watch --fail-fast` with a bounded loop
that watches only the allowlisted check names and times out cleanly with a classified
error. Keep `concurrency` as-is.
**Approach note:** Document the required-check names and the `AUTOMATION_PR_TOKEN`
permissions in `README.md` so the gate set is discoverable.
**Test scenarios:**
- With an unrelated check red but all required checks green, the PR still auto-merges.
- With a required data check red, the PR does **not** merge and the job reports a
  classified failure.
- The merge step does not block longer than the configured timeout.
- `Test expectation: workflow-level` — validated via `workflow_dispatch` on a test PR.
**Verification:** A forced unrelated red check no longer blocks the daily merge.

### U4. Right-size the data-quality gate to the backbone source

**Goal:** Only a true backbone failure (no events to publish) hard-blocks; supplementary
sources degrade gracefully.
**Files:** `scripts/lib/feedHealthPolicy.ts`, `scripts/updateEvents.ts`,
`scripts/lib/sourceCoveragePolicy.ts`, `scripts/tests/feed-health.test.mjs`
**Approach:** Narrow `CRITICAL_SOURCES` to `livewhale` only (keep others as warn-level via
coverage policy). Retain the existing guards that already protect correctness regardless
of source criticality: total-events-zero blocks, and stale-fallback-exceeds-`MAX_FALLBACK_AGE_HOURS`
blocks. Update comments to reflect the new term-agnostic rule so the next sparse-source
event does not require another hotfix.
**Approach note:** This makes the prior `callink`-specific hotfix general. Keep the
per-source expected-minimum **warnings** (`sourceCoveragePolicy.ts`) intact for visibility.
**Test scenarios:**
- `bampfa`/`simons`/`callink` degraded without fallback → result is **warning**, publish
  proceeds (regression test for the 06-02/06-03 class).
- `livewhale` degraded without fallback → still **blocking**.
- Total events zero → blocking regardless of which sources failed.
- Fallback older than `MAX_FALLBACK_AGE_HOURS` → blocking.
- Covers the existing feed-health invariants — extend `feed-health.test.mjs`.
**Verification:** Strict-mode run with a non-backbone source down publishes successfully
with warnings.

### U5. Make failure alerting reliable and classified

**Goal:** Operators always get one actionable signal when the pipeline breaks, and the
notifier never crashes the workflow.
**Files:** `scripts/notifyPipelineFailure.mjs`, `.github/workflows/update-events.yml`
**Approach:** Ensure `notifyPipelineFailure.mjs` is fully best-effort — wrap the final
create/comment in a try/catch that logs and exits 0 (never 1). Pass a `FAILURE_CONTEXT`
that reflects the failing step (data-generation vs merge vs plumbing) so the issue body
classifies the failure. Confirm `notify-failure` triggers on `failure()` for all failure
modes (it already does via `needs: update-events`).
**Test scenarios:**
- Notifier with a forced `gh` error logs a warning and exits 0 (does not fail the job).
- Existing open `pipeline-failure` issue → comments instead of opening a duplicate.
- No open issue → opens exactly one, labelled.
- `Test expectation: none for the workflow wiring; add a unit-level guard for the
  exit-code-0 contract if feasible with the existing harness.`
**Verification:** A simulated failure produces a single updated issue and a green
`notify-failure` job.

---

## Sequencing & Dependencies

1. **U1** first (immediate unblock, independent).
2. **U2** and **U3** together define the new merge contract (U3 references the required
   checks; do U2 before finalizing U3's required-check allowlist).
3. **U4** is independent of the CI changes and can land in parallel.
4. **U5** last; hardens the safety net once the new flow is in place.

---

## Risks & Mitigations

- **Removing the audit gate lowers security pressure.** Mitigated by the standalone
  weekly audit workflow + Dependabot; findings still tracked as issues.
- **Native auto-merge requires branch protection config.** If the repo/plan can't enable
  it, U3's allowlist-watch fallback covers the same intent in-workflow.
- **Narrowing critical sources could let real coverage regressions slip.** Mitigated by
  retained zero-events and stale-fallback blocks plus per-source coverage warnings.

## Success Criteria

- 14 consecutive scheduled rounds without a non-data failure (no audit/plumbing reds).
- A deliberately injected non-backbone source outage publishes with warnings, not failure.
- A simulated CVE does not block the daily PR merge.
