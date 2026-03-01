# Internship Agent - Project Architecture

## Overview
An internship search automation system for Bay Area AI startups with a Next.js 14 dashboard frontend and Python FastAPI backend.

## Architecture

### Frontend (dashboard/)
- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS with green-themed design system
- **State**: React hooks with client-side state management
- **API Layer**: `src/lib/api.ts` - async client with mock data fallback

### Backend (backend/)
- **Framework**: Python FastAPI
- **Purpose**: Discovery, research, and outreach automation
- **API Contract**: REST endpoints for companies, replies, pipeline stats

## Key Files
- `src/lib/types.ts` - All TypeScript interfaces (Company, Reply, Pipeline, etc.)
- `src/lib/api.ts` - API client layer (mock data for development)
- `src/lib/utils.ts` - Formatting utilities, confidence badges, timeline helpers
- `src/lib/mock-data.ts` - Realistic mock data for all entities
- `src/app/layout.tsx` - Root layout with sidebar
- `src/app/sidebar.tsx` - Navigation sidebar component
- `src/app/page.tsx` - Overview dashboard
- `src/app/companies/page.tsx` - Companies list with filters
- `src/app/companies/[id]/page.tsx` - Company detail with timeline
- `src/app/replies/page.tsx` - Reply inbox triage
- `src/app/pipeline/page.tsx` - Kanban pipeline view

## Design System
- **Primary**: Green (#16a34a)
- **Background**: Light gray (#f9fafb)
- **Cards**: White with gray-200 borders
- **Pipeline Stages**: Color-coded (slate → blue → amber → orange → emerald → green → gray)
- **Urgency**: Hot (red), Warm (amber), Cold (blue)
- **Confidence**: Verified (green), Guessed (yellow), Unknown (red)

## Data Models
- **Company**: Full profile with contacts, timeline, outreach drafts, next actions
- **Reply**: Inbox item with urgency classification and suggested actions
- **Pipeline Stage**: discovered → researched → outreach_sent → followed_up → replied → interview → done
- **Timeline Event**: Chronological touchpoints per company
