/**
 * Canonical event schema — internal representation across all source adapters.
 *
 * Each adapter maps its raw payload into CanonicalEvent.
 * The orchestrator dedupes the union, then projects down to the legacy CalEvent
 * shape that public/events.json (and the React frontend) consumes.
 */

import { z } from "zod";

import {
  TOPIC_GROUPS,
  TOPIC_SLUGS,
  TOPIC_VOCABULARY_VERSION,
  type TopicSlug,
} from "./topics.js";

export const SourceNameSchema = z.enum([
  "livewhale",
  "callink",
  "cal_performances",
  "calbears",
  "bampfa",
  "haas",
  "berkeley_law",
  "simons",
  "luma",
  "begin",
  "ai_risk",
  "brsl",
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

/**
 * Accepts either a bare PT calendar date (`YYYY-MM-DD`, used for all-day
 * events) or a full ISO-8601 timestamp with an explicit offset or `Z`. This
 * is the boundary check that catches a future upstream format change before
 * it lands in events.json — see the start_at / end_at fields below.
 */
const ISO8601_LIKE_PATTERN =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2}))?$/;
const ISO8601_LIKE_REGEX = z
  .string()
  .regex(
    ISO8601_LIKE_PATTERN,
    "must be YYYY-MM-DD or ISO 8601 with an explicit offset / Z",
  );

export const CanonicalEventSchema = z.object({
  // Provenance
  source_name: SourceNameSchema,
  source_id: z.string().min(1).max(512),
  source_url: HttpUrlSchema,
  evidence_url: HttpUrlSchema.optional(),

  // Identity. Bounded so a broken or hostile feed cannot publish a
  // multi-megabyte field that bloats events.json / search-index.json.
  title: z.string().min(2).max(300),
  description: z.string().max(20000).default(""),

  // Time: either an ISO-8601 date-time with a numeric offset (preferred), or
  // `YYYY-MM-DD` for all-day events. A loose min(8) check used to accept
  // any string, which let garbage from a future BAMPFA widget format change
  // (e.g. "2026--04-2T22T:1:00-08:00") slip into events.json and get
  // lexicographically compared against today's date — silently shifting
  // events to wrong dates in the UI. Adapters that emit anything else now
  // fail Zod validation at the publish boundary instead.
  start_at: ISO8601_LIKE_REGEX,
  end_at: ISO8601_LIKE_REGEX.optional(),
  timezone: z.string().default("America/Los_Angeles"),
  all_day: z.boolean().default(false),

  // Multi-day collapse: when a source emits one row per day for a long-running
  // event (e.g. LiveWhale exhibits), collapseMultiDay merges them into a single
  // event whose start_at/end_at span the run. occurrence_dates holds every
  // upcoming day the event actually occurs (PT YYYY-MM-DD), so the frontend can
  // distinguish a continuous run from a gappy/recurring series. Absent for
  // single-day events.
  occurrence_dates: z.array(z.string()).optional(),

  // Place
  venue: z.string().max(500).default(""),
  building: z.string().max(500).default(""),
  address: z.string().max(500).default(""),
  modality: ModalitySchema.default("in_person"),

  // People / unit
  organizer: z.string().max(500).default(""),
  organizer_unit: z.string().max(500).default(""),
  audience: z.string().max(500).default(""),

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

/** Standard return shape for every source adapter's fetch function. */
export interface FetchResult {
  events: CanonicalEvent[];
  rawCount: number;
  filteredPast: number;
  invalid: number;
}

const TOPIC_SLUG_TUPLE = TOPIC_SLUGS as readonly [TopicSlug, ...TopicSlug[]];

export const TopicSlugSchema = z.enum(TOPIC_SLUG_TUPLE);
export const TopicGroupSchema = z.enum(TOPIC_GROUPS);

export const TopicDefinitionSchema = z.object({
  slug: TopicSlugSchema,
  label: z.string().min(1),
  group: TopicGroupSchema,
  synonyms: z.array(z.string().min(1)).min(1),
});

export const TopicVocabularySchema = z.object({
  version: z.literal(TOPIC_VOCABULARY_VERSION),
  topics: z.array(TopicDefinitionSchema).min(1),
});

/**
 * Legacy event shape — what public/events.json publishes and App.tsx reads.
 * Kept stable to avoid frontend churn during the source-adapter migration.
 */
export const LegacyCalEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(2).max(300),
  organizer: z.string().max(500),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string(),
  location: z.string().max(1000),
  description: z.string().max(20000),
  tags: z.array(z.string()),
  topics: z
    .array(TopicSlugSchema)
    .max(3)
    .refine((topics) => new Set(topics).size === topics.length, {
      message: "topics must not contain duplicate slugs",
    })
    .optional(),
  url: HttpUrlSchema,
  // Always set by projectToLegacy and required by the webmcp source filter.
  // The fallback-restore path reuses already-published events, which also
  // carry source, so every published LegacyCalEvent has it.
  source: z.string().min(1),
  // Multi-day events only (set by collapseMultiDay). `date` is the earliest
  // upcoming occurrence; `end_date` is the last; `dates` lists every upcoming
  // occurrence day (PT YYYY-MM-DD). Single-day events omit both.
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
});
export type LegacyCalEvent = z.infer<typeof LegacyCalEventSchema>;

export const PublishedSourceSchema = z.object({
  title: z.string().min(1),
  uri: HttpUrlSchema,
});
export type PublishedSource = z.infer<typeof PublishedSourceSchema>;

export const PublishedEventsPayloadSchema = z.object({
  events: z.array(LegacyCalEventSchema),
  sources: z.array(PublishedSourceSchema),
  lastUpdated: z.number().int().nonnegative(),
  data_age_hours: z.number().nonnegative(),
  degraded_sources: z.array(SourceNameSchema),
  topic_vocabulary: TopicVocabularySchema,
});
export type PublishedEventsPayload = z.infer<
  typeof PublishedEventsPayloadSchema
>;

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
  /**
   * Set when this source's last-good data was older than the fallback age
   * ceiling, so its events were dropped rather than republished as fresh.
   * Distinct from `fallback_used`, which means fallback was actually applied.
   */
  fallback_expired?: boolean;
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
  /** Sources whose expired last-good events were dropped from this publish. */
  stale_fallback_sources?: SourceName[];
}
