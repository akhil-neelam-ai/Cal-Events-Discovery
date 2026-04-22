# Handoff Notes

This file captures the current project state and the remaining manual steps that are not represented purely in code.

## Repository

- Repo: `akhil-neelam-ai/Cal-Events-Discovery`
- Default branch: `main`
- Latest pushed commit: `d199ab1` - `Move artifact updates to PR workflow`

## Key Recent Commits

- `d199ab1` - Move artifact updates to PR workflow
- `aad6f1f` - Add browser E2E workflow
- `b5cb06e` - Add browser E2E and harden search queries
- `0e81757` - Refactor app shell and strengthen validation

## What Changed

### App structure and validation

- `App.tsx` was reduced to a thin composition shell.
- The app now has:
  - lint
  - format checks
  - Node-based runtime/search tests
  - UI regression tests with `vitest`
  - Playwright browser E2E coverage

### CI

- `.github/workflows/e2e.yml`
  - runs `browser-e2e`
  - triggers on push, pull request, and manual dispatch
- `.github/workflows/update-events.yml`
  - no longer pushes artifacts directly to `main`
  - now opens or updates an automation PR branch instead

## Current Manual GitHub State

These settings were changed manually in GitHub and are not stored in the repo:

- A ruleset targeting `main` was activated.
- The required check includes `browser-e2e`.

## Current Blocker

`update-events` still cannot open the automation PR because GitHub Actions is not yet allowed to create pull requests.

Error seen:

`GitHub Actions is not permitted to create or approve pull requests.`

## Required Manual Fix In GitHub

Open:

- `Settings -> Actions -> General -> Workflow permissions`

Then set:

1. `Read and write permissions`
2. `Allow GitHub Actions to create and approve pull requests`

If the repository inherits Actions policy from an organization, make the same change at the organization level.

## Expected Behavior After That Setting Is Enabled

1. Run `update-events` manually or wait for the next schedule.
2. The workflow should open or update a PR from `automation/update-events` into `main`.
3. That PR should receive the `browser-e2e` required check.
4. Merge the PR after checks pass.
5. `main` remains protected while the daily update flow still works.

## Local Setup On A New Machine

From a fresh clone:

```bash
npm ci
npm run install:browsers
npm run validate
```

Useful commands:

```bash
npm run dev
npm run test:e2e
npm run validate
npm run update-events
```

## Recommended Next Steps

1. Enable the GitHub Actions pull-request permission setting.
2. Verify the updater PR flow end to end.
3. Decide whether automation PRs should auto-merge after `browser-e2e` passes.
4. Add a separate CI workflow for `npm run validate` and make it a required check alongside `browser-e2e`.
