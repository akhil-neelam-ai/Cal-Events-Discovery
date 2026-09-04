import type {
  LegacyCalEvent,
  PublishedEventsPayload,
  SourceStatus as PipelineSourceStatus,
  StatusReport,
} from "./scripts/lib/schema";

export type CalEvent = LegacyCalEvent;

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface SearchResponse {
  events: CalEvent[];
  sources: GroundingSource[];
  topic_vocabulary?: TopicVocabulary;
  lastUpdated?: number;
  data_age_hours?: number;
  degraded_sources?: string[];
}

export type SourceStatus = PipelineSourceStatus;
export type IngestionStatus = StatusReport;
export type TopicVocabulary = PublishedEventsPayload["topic_vocabulary"];
export type TopicDefinition = TopicVocabulary["topics"][number];

export interface SearchFilters {
  dateRange: "upcoming" | "today" | "tomorrow" | "week";
  category: string;
  /** Published topic slug, or an empty string when no topic is active. */
  topic: string;
  searchQuery: string;
  source: string;
}

export enum LoadingState {
  IDLE = "IDLE",
  LOADING = "LOADING",
  SUCCESS = "SUCCESS",
  ERROR = "ERROR",
}
