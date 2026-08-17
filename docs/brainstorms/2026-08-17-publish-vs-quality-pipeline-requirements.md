---
date: 2026-08-17
topic: publish-vs-quality-pipeline
---

# Publish-first daily pipeline

## Summary

Keep the campus event feed fresh by default. Only LiveWhale-down-without-fallback and a stale production feed count as true operator alerts. Corpus quality mismatches still publish, then open a low-priority data-quality issue.

---

## Problem Frame

Repeated “workflow failed” signals mixed real outages with false hard-fails: live golden search tests (e.g. Moffitt vs Doe library tours), seasonal threshold drift, and dependency CVEs. The daily job treated all of those like “stop shipping events,” so production stayed stale for days while nothing was wrong with the backbone feed.

---

## Requirements

- **R1.** The daily update must publish a fresh snapshot whenever LiveWhale (or last-good LiveWhale fallback) can support a non-empty healthy feed.
- **R2.** Live corpus search-quality failures must not block generating, opening, or merging the data PR.
- **R3.** When search-quality fails against a newly generated corpus, open or update a low-priority `data-quality` issue; do not open a `pipeline-failure` issue for that alone.
- **R4.** Operator alerts (`pipeline-failure`) are reserved for: LiveWhale degraded without usable fallback on the publish path, or production feed age beyond the smoke threshold after a refresh should have landed.
- **R5.** Security audit and non-critical source-contract findings must not use the `pipeline-failure` operator label.
- **R6.** Code-change validation may still surface search-quality results for visibility, but automation merge gates stay limited to publish-relevant checks.

## Acceptance Examples

- **AE1.** When a new LiveWhale tour mentions Moffitt while located at Doe Library, search-quality fails → snapshot still merges; a `data-quality` issue is opened or updated. Covers: R2, R3
- **AE2.** When LiveWhale is down and no last-good fallback remains, the daily job fails and a `pipeline-failure` issue is opened or updated. Covers: R1, R4
- **AE3.** When production `status.json` is older than the smoke threshold, Production Smoke fails with a `pipeline-failure` issue. Covers: R4
- **AE4.** When `npm audit` finds a CVE, Security Audit opens/updates `security-audit`, and the data PR still merges. Covers: R5

## Success Criteria

- A corpus-sensitive golden-test failure cannot leave production older than one missed daily refresh for that reason alone.
- Operator-facing `pipeline-failure` issues correspond only to backbone outage or stale production.
- Quality regressions remain visible via `data-quality` issues without paging urgency.

## Scope Boundaries

- In scope: daily update gate split; alert label policy; search-quality non-blocking path; source-contracts label quieting.
- Deferred: auto-close issues on recovery; automatic summer/fall cadence switching; ops dashboard.
- Out of scope: new sources; adapter rewrites; changing dual-cron Pacific schedule-gate mechanics.

## Key Decisions

- Approach: two-track gate on the daily job (publish-critical vs corpus quality).
- MVP is policy only — no auto-close, no seasonal automation, no dashboard.
