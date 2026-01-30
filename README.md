# Cal Events Discovery

A web application that helps UC Berkeley students discover campus events. Events are automatically fetched daily from various Berkeley calendars and displayed in an instant-loading interface.

## Features

- **Instant Loading** - Events are pre-fetched and stored as static JSON, so the page loads immediately
- **Daily Auto-Updates** - GitHub Actions automatically refreshes events every day at 6 AM PST
- **Smart Filtering** - Filter events by category (Academic, Arts, Sports, Career, etc.) and date range
- **Search** - Search across event titles, descriptions, and organizers
- **Mobile Friendly** - Responsive design works on all devices

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS
- **Build Tool**: Vite
- **Event Source**: Google Gemini API with Google Search grounding
- **Hosting**: Vercel
- **CI/CD**: GitHub Actions

## How It Works

1. A GitHub Action runs daily and calls the Gemini API to fetch 40-50 upcoming UC Berkeley events
2. Events are saved to `public/events.json` and committed to the repository
3. The site is automatically redeployed to Vercel
4. When users visit the site, they see events instantly (no API calls on page load)

