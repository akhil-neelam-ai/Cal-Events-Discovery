/**
 * Canonical event schema — internal representation across all source adapters.
 *
 * Each adapter (LiveWhale, E-Hub, Gemini) maps its raw payload into CanonicalEvent.
 * The orchestrator dedupes the union, then projects down to the legacy CalEvent
 * shape that public/events.json (and the React frontend) consumes.
 */

import { z } from 'zod';

export const SourceName = z.enum(['livewhale', 'callink', 'cal_performances', 'calbears', 'bampfa', 'ehub', 'gemini']);
export type SourceName = z.infer<typeof SourceName>;

export const Modality = z.enum(['in_person', 'virtual', 'hybrid', 'unknown']);
export type Modality = z.infer<typeof Modality>;

export const CanonicalEventSchema = z.object({
  // Provenance
  source_name: SourceName,
  source_id: z.string().min(1),
  source_url: z.string().url(),
  evidence_url: z.string().url().optional(),

  // Identity
  title: z.string().min(2),
  description: z.string().default(''),

  // Time (ISO 8601 with offset, OR YYYY-MM-DD when all_day)
  start_at: z.string().min(8),
  end_at: z.string().min(8).optional(),
  timezone: z.string().default('America/Los_Angeles'),
  all_day: z.boolean().default(false),

  // Place
  venue: z.string().default(''),
  building: z.string().default(''),
  address: z.string().default(''),
  modality: Modality.default('in_person'),

  // People / unit
  organizer: z.string().default(''),
  organizer_unit: z.string().default(''),
  audience: z.string().default(''),

  // Engagement
  cost: z.string().default(''),
  registration_url: z.string().url().optional(),
  canonical_url: z.string().url(),

  // Categorization
  categories: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),

  // Quality / freshness
  last_seen_at: z.string(),
  confidence: z.number().min(0).max(1).default(1),
  quality_flags: z.array(z.string()).default([]),
});

export type CanonicalEvent = z.infer<typeof CanonicalEventSchema>;

/**
 * Legacy event shape — what public/events.json publishes and App.tsx reads.
 * Kept stable to avoid frontend churn during the source-adapter migration.
 */
export interface LegacyCalEvent {
  id: string;
  title: string;
  organizer: string;
  date: string;
  time: string;
  location: string;
  description: string;
  tags: string[];
  url: string;
  source?: string;
}

export interface PublishedSource {
  title: string;
  uri: string;
}

export interface SourceStatus {
  name: SourceName;
  ok: boolean;
  count: number;
  duration_ms: number;
  error?: string;
  fetched_at: string;
}

export interface StatusReport {
  generated_at: string;
  total_events: number;
  duplicates_removed: number;
  past_events_filtered: number;
  invalid_events_filtered: number;
  sources: SourceStatus[];
  fallback_used: boolean;
  degraded: boolean;
  degraded_reason?: string;
  last_good_used?: number;
}
