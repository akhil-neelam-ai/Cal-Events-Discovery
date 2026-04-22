# New Laptop Bootstrap

This checklist is for bringing the `Cal-Events-Discovery` project and local coding environment back to a working state on a new machine.

## 1. Install core tools

Install and verify:

- Git
- Node.js 20.x
- npm
- Chrome or Chrome for Testing

Sanity check:

```bash
git --version
node --version
npm --version
```

## 2. Set up SSH for GitHub

Generate or copy your SSH key, add it to GitHub, then verify access:

```bash
ssh -T git@github.com
```

## 3. Clone the repo

```bash
git clone git@github.com:akhil-neelam-ai/Cal-Events-Discovery.git
cd Cal-Events-Discovery
```

## 4. Fetch the saved handoff branch

The latest documented handoff state is stored on:

- `handoff/document-project-handoff-state`

Fetch and inspect it:

```bash
git fetch origin handoff/document-project-handoff-state
git checkout handoff/document-project-handoff-state
```

Important docs in that branch:

- `HANDOFF.md`
- `PROGRESS.md`
- `NEW-LAPTOP-BOOTSTRAP.md`

## 5. Install project dependencies

```bash
npm ci
npm run install:browsers
```

## 6. Verify the repo locally

```bash
npm run validate
npm run test:e2e
```

If you only want the fast baseline first:

```bash
npm run lint
npm run test:ui
npm run build
```

## 7. Run the app locally

```bash
npm run dev
```

If you want to preview the production build:

```bash
npm run build
npm run preview
```

## 8. Restore Codex CLI

Install or upgrade Codex CLI, then sign in again if needed.

Two supported paths:

- Sign in with ChatGPT
- Use an OpenAI API key

Local sanity checks:

```bash
codex --version
codex
```

If you prefer API-key auth, export the key in your shell profile before launching Codex.

## 9. Restore GitHub workflow context

Current expected GitHub state:

- `main` branch has an active ruleset
- required check includes `browser-e2e`
- `update-events` no longer pushes directly to `main`
- `update-events` is intended to open an automation PR

Current known blocker:

- GitHub Actions still needs permission to create pull requests

Manual GitHub setting still required:

- `Settings -> Actions -> General -> Workflow permissions`
  - `Read and write permissions`
  - `Allow GitHub Actions to create and approve pull requests`

## 10. Resume safely

Recommended next actions after setup:

1. Confirm local validation passes.
2. Confirm Codex CLI works.
3. Enable the remaining GitHub Actions PR-creation permission if it is still disabled.
4. Trigger `update-events` manually and verify it opens an automation PR.
5. Continue work from a feature branch or from the handoff branch as appropriate.

## 11. Useful project commands

```bash
npm run dev
npm run build
npm run validate
npm run test:ui
npm run test:e2e
npm run update-events
```
