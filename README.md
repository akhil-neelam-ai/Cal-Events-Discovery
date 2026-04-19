# Cal Events Discovery

A web application that helps UC Berkeley students discover campus events. The site publishes a static snapshot of upcoming events collected from multiple Berkeley calendars, then serves that snapshot through a fast searchable interface.

## Features

- **Instant loading** - Events, status metadata, and the search index are pre-generated as static assets.
- **Daily auto-updates** - GitHub Actions refreshes the published snapshot on a schedule or on demand.
- **Sharable filters** - Search, date range, source, and selected event state are reflected in the URL.
- **Campus-wide search** - Search across event titles, descriptions, organizers, and indexed keywords.
- **Responsive event details** - Mobile uses a bottom sheet and desktop uses a slide-out panel.

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS
- **Build Tool**: Vite
- **Data pipeline**: TypeScript scripts that ingest Berkeley event sources and build `events.json`, `status.json`, and `search-index.json`
- **Hosting**: Vercel
- **CI/CD**: GitHub Actions

## How It Works

1. A GitHub Action runs the ingestion pipeline against multiple Berkeley event sources.
2. The pipeline writes `public/events.json`, `public/status.json`, and `public/search-index.json`.
3. Updated artifacts are committed to the repository and redeployed to Vercel.
4. When users visit the site, the client loads the static snapshot and filters locally.

