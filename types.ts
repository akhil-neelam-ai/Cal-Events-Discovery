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
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface SearchResponse {
  events: CalEvent[];
  sources: GroundingSource[];
}

export interface SearchFilters {
  dateRange: 'upcoming' | 'today' | 'week' | 'month' | 'weekend';
  category: string;
  searchQuery: string;
}

export enum LoadingState {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}