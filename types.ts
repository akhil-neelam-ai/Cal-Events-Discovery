export interface CalEvent {
  id: string;
  title: string;
  organizer: string;
  date: string; // ISO string preferred
  time: string;
  location: string;
  description: string;
  tags: string[];
  url: string;
  source?: string;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface SearchResponse {
  events: CalEvent[];
  sources: GroundingSource[];
}

export interface SourceStatus {
  name: string;
  ok: boolean;
  count: number;
  duration_ms: number;
  fetched_at: string;
  error?: string;
  degraded?: boolean;
  fallback_used?: boolean;
  fallback_count?: number;
  degraded_reason?: string;
  skipped?: boolean;
}

export interface IngestionStatus {
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
  fallback_sources?: string[];
  degraded_sources?: string[];
}

export interface SearchFilters {
  dateRange: 'upcoming' | 'today' | 'week';
  category: string;
  searchQuery: string;
  source: string;
}

export enum LoadingState {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}
