import type {
  LegacyCalEvent,
  SourceStatus as PipelineSourceStatus,
  StatusReport,
} from './scripts/lib/schema';

export type CalEvent = LegacyCalEvent;

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface SearchResponse {
  events: CalEvent[];
  sources: GroundingSource[];
}

export type SourceStatus = PipelineSourceStatus;
export type IngestionStatus = StatusReport;

export interface SearchFilters {
  dateRange: 'upcoming' | 'today' | 'tomorrow' | 'week';
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
