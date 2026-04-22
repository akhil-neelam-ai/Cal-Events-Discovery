# Progress Log

This file tracks the implementation progress, the sequence of steps taken, and the current recommended next steps for `Cal-Events-Discovery`.

## Current Status

As of `2026-04-22`, the latest pushed app commit is:

- `d199ab1` - `Move artifact updates to PR workflow`

Current state:

- `App.tsx` has been reduced from a large monolith to a thin composition shell.
- Search/runtime bugs found during audit were fixed before the refactor.
- Validation now includes:
  - lint
  - format check
  - Node-based data/search tests
  - UI regression tests with `vitest + jsdom + testing-library`
- Browser E2E runs in GitHub Actions as a separate workflow.
- The daily artifact updater now opens or updates an automation PR instead of pushing directly to `main`.
- A branch ruleset on `main` was switched to active manually in GitHub.
- The current blocker is a GitHub Actions repository/org setting: workflows are still not allowed to create pull requests, so `update-events` cannot yet open the automation PR.

## Progress Timeline

### 1. UX and reliability audit

Initial review identified issues in:

- temporal search behavior
- campus-area interpretation
- URL state handling
- event date handling
- UI empty states
- mobile filter discoverability
- card/panel interaction clarity

### 2. Search and state correctness fixes

Implemented and verified:

- intent-only temporal queries no longer collapse search results incorrectly
- `tomorrow` is preserved in URL state
- campus-area interpretation became a real filter
- dismissed interpretation chips properly broaden results
- date filtering uses stable date-string logic instead of broken UTC parsing assumptions

### 3. Artifact and validation hardening

Added or improved:

- broader lint coverage
- formatting gates
- runtime search tests
- URL-state regression tests
- safer validation path in CI/workflow

### 4. App shell refactor

Refactored `App.tsx` incrementally into hooks and components rather than rewriting it in one pass.

New major hooks:

- `hooks/useEventFeed.ts`
- `hooks/useUrlStateSync.ts`
- `hooks/useEventBrowserState.ts`
- `hooks/useEventBrowserActions.ts`
- `hooks/useEventGridState.ts`
- `hooks/useBackToTopVisibility.ts`
- `hooks/usePacificDateKeys.ts`
- `hooks/useIsMobile.ts`
- `hooks/useDialogAccessibility.ts`
- `hooks/usePrefersReducedMotion.ts`

New major UI components:

- `components/AppHeaderShell.tsx`
- `components/DesktopHero.tsx`
- `components/FiltersBar.tsx`
- `components/MobileHeader.tsx`
- `components/EventsResultsSection.tsx`
- `components/EventGrid.tsx`
- `components/EventDetailOverlay.tsx`
- `components/StatusBanner.tsx`
- `components/EmptyStateCard.tsx`
- `components/AppFooter.tsx`
- `components/BackToTopButton.tsx`

### 5. UI regression layer

Added:

- `vitest.config.ts`
- `tests/setup.ts`
- `tests/App.ui.test.tsx`

Current UI coverage includes:

- restoring search/filter state from URL
- `today -> this week` fallback behavior
- dismissing interpreted campus-area chips
- opening event details and syncing `event=` into the URL

### 6. Commit and push

Committed and pushed:

- `0e81757` - `Refactor app shell and strengthen validation`

### 7. CI deploy compatibility fix

Identified and patched a production workflow failure caused by an outdated pinned Vercel CLI in GitHub Actions.

- Root cause: the workflow deploy step was still pinned to `vercel@47.0.5`, which rejected the Vercel project's `24.x` Node setting during `vercel pull`.
- Fix: updated the workflow to use a current pinned Vercel CLI version that supports the project's Node runtime setting.

### 8. CI artifact push race fix

Identified and patched a second production workflow failure caused by the scheduled job trying to push from a stale checkout after `main` had advanced.

- Root cause: the workflow generated and committed fresh artifacts successfully, but its final `git push` assumed the checked-out branch tip was still current.
- Fix: switched to full-history checkout, added workflow concurrency control, and rebased the artifact commit onto the latest remote branch before pushing.

### 9. Event card interaction fix

Cleaned up the event card interaction model so cards no longer rely on an implicitly clickable article wrapper.

- Root cause: the card container itself was handling clicks while also containing a source link and a nested detail button, which created ambiguous interaction semantics.
- Fix: moved detail opening to explicit buttons, kept source navigation as a normal anchor, and replaced JS-driven hover/touch state mutations with CSS-based motion and shadow transitions.
- Verification: lint, build, full validation, UI regression tests, and a live browser snapshot against the local app all confirmed the new card structure.

### 10. Standardized browser automation and NL search coverage

Added a first-class Playwright path to the repo and widened runtime search coverage with stable natural-language cases.

- Added `@playwright/test`, `playwright.config.ts`, `install:browsers`, `test:e2e`, and `test:e2e:headed`.
- Added a deterministic browser spec that mocks `events.json`, `status.json`, and `search-index.json` so the E2E flow does not depend on the live published corpus.
- Added runtime natural-language search assertions for:
  - `film screening at bampfa`
  - `free events near northside`
  - `founder talks tomorrow`
- Tightened tokenization by treating low-signal query words like `event/events` and `near` as stop words so natural-language retrieval is less noisy.

### 11. Browser E2E promoted into CI

Added a dedicated GitHub Actions workflow for browser E2E so real browser coverage runs automatically on code changes.

- Workflow: `.github/workflows/e2e.yml`
- Trigger model: push / pull request / manual dispatch, with generated artifact-only commits ignored so the daily `update-events` pipeline stays separate.
- Runtime: installs Chromium with Playwright on GitHub-hosted Ubuntu and uploads Playwright artifacts on failure.

### 12. Update pipeline moved to PR-based artifact delivery

Changed the scheduled `update-events` workflow so it no longer pushes directly to `main`.

- Root cause: branch-protection enforcement and required checks are incompatible with a workflow that commits straight to the protected branch.
- Fix: the updater now validates generated artifacts, opens or updates an automation PR branch, and relies on normal PR checks before merge.
- Supporting change: the browser E2E workflow still ignores artifact-only pushes to `main`, but now runs on all pull requests so automation PRs can satisfy the required `browser-e2e` check.

### 13. Branch protection activated and remaining GitHub setting identified

Activated the `main` ruleset in GitHub after moving the artifact pipeline away from direct pushes.

- Manual GitHub change: the branch ruleset now targets `main`, is active, and includes the `browser-e2e` required check.
- Remaining blocker: the repository or organization still has GitHub Actions configured to disallow workflows from creating pull requests.
- Required manual fix in GitHub: `Settings -> Actions -> General -> Workflow permissions`
  - set `Read and write permissions`
  - enable `Allow GitHub Actions to create and approve pull requests`

## Steps Followed

The work so far followed this order:

1. Audit production behavior and identify correctness bugs before refactoring.
2. Fix search, URL, and date-handling bugs first.
3. Expand validation and regression coverage before deeper structural work.
4. Refactor `App.tsx` incrementally into hooks and components.
5. Add UI regression testing once the shell boundaries stabilized.
6. Extract the remaining presentation and header-shell sections.
7. Commit only after lint, build, validation, and UI tests were green.
8. Push to `main` after verification.
9. Patch CI/deploy tooling when platform version drift breaks the workflow.
10. Harden workflow git operations against branch drift during long-running scheduled jobs.
11. Fix interaction semantics before adding deeper browser-level coverage.
12. Standardize deterministic browser automation before promoting E2E into the main validation path.
13. Separate app-behavior CI from the daily data-refresh workflow.
14. Move artifact publication to PR-based automation so `main` can be protected without breaking the updater.
15. Activate the `main` ruleset only after the updater moved to PR-based artifact delivery.
16. Capture the remaining non-code GitHub Actions permission dependency explicitly in repo docs.

## Verification Baseline

Current expected verification commands:

- `npm run lint`
- `npm run test:ui`
- `npm run build`
- `npm run validate`
- `git diff --check`

## Recommended Next Steps

The highest-value next work is:

1. Watch the first CI runs of `.github/workflows/e2e.yml` and adjust timeouts/artifact capture if GitHub runners behave differently from local.
2. Continue improving search quality with more natural-language golden queries and Berkeley-specific venue language.
3. Run a second live UX/browser audit now that deterministic E2E coverage exists.
4. Tighten data-pipeline health thresholds for major sources in the GitHub Actions workflow.
5. Decide whether the automation PR should auto-merge after `browser-e2e` passes or remain a manual approval step.
6. In GitHub settings, allow GitHub Actions to create pull requests, then rerun `update-events` and confirm the automation PR flow end to end.

## Update Rule

Append new milestones here whenever one of these happens:

- a new audit produces action items
- a major bugfix lands
- validation/test coverage expands
- a structural refactor lands
- a production-impacting workflow or ingestion change is made
- a commit is pushed to `main`
