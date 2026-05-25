/**
 * Canonical event schema — internal representation across all source adapters.
 *
 * Each adapter maps its raw payload into CanonicalEvent.
 * The orchestrator dedupes the union, then projects down to the legacy CalEvent
 * shape that public/events.json (and the React frontend) consumes.
 */

import { z } from "zod";

export const SourceNameSchema = z.enum([
  "livewhale",
  "callink",
  "cal_performances",
  "calbears",
  "bampfa",
  "haas",
  "berkeley_law",
  "simons",
  "ehub",
]);
export type SourceName = z.infer<typeof SourceNameSchema>;

export const ModalitySchema = z.enum([
  "in_person",
  "virtual",
  "hybrid",
  "unknown",
]);
export type Modality = z.infer<typeof ModalitySchema>;

export const HttpUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === "http:" || protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "URL must use http or https" },
  );

export const CanonicalEventSchema = z.object({
  // Provenance
  source_name: SourceNameSchema,
  source_id: z.string().min(1),
  source_url: HttpUrlSchema,
  evidence_url: HttpUrlSchema.optional(),

  // Identity
  title: z.string().min(2),
  description: z.string().default(""),

  // Time (ISO 8601 with offset, OR YYYY-MM-DD when all_day)
  start_at: z.string().min(8),
  end_at: z.string().min(8).optional(),
  timezone: z.string().default("America/Los_Angeles"),
  all_day: z.boolean().default(false),

  // Place
  venue: z.string().default(""),
  building: z.string().default(""),
  address: z.string().default(""),
  modality: ModalitySchema.default("in_person"),

  // People / unit
  organizer: z.string().default(""),
  organizer_unit: z.string().default(""),
  audience: z.string().default(""),

  // Engagement
  cost: z.string().default(""),
  registration_url: HttpUrlSchema.optional(),
  canonical_url: HttpUrlSchema,

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

/**
 * Per-source health record written to `public/status.json`.
 * The frontend consumes the same shape through `types.ts` to avoid drift.
 */
export interface SourceStatus {
  name: SourceName;
  ok: boolean;
  count: number;
  duration_ms: number;
  error?: string;
  fetched_at: string;
  degraded?: boolean;
  fallback_used?: boolean;
  fallback_count?: number;
  fallback_age_hours?: number;
  degraded_reason?: string;
}

/**
 * Top-level ingestion summary written to `public/status.json`.
 * Keep this shape stable because the frontend reads it directly.
 */
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
  last_good_used: number;
  fallback_age_hours?: number;
  data_quality_blocked?: boolean;
  fallback_sources?: SourceName[];
  degraded_sources?: SourceName[];
}
