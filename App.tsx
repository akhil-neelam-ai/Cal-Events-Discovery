
import React, { useState, useEffect, useMemo } from 'react';
import { fetchEventsFromGemini } from './services/geminiService';
import { CalEvent, SearchFilters, LoadingState, GroundingSource } from './types';

// Synonym mapping for natural language search
const SEARCH_SYNONYMS: Record<string, string[]> = {
  'ai': ['artificial intelligence', 'machine learning', 'ml', 'deep learning', 'neural network'],
  'artificial intelligence': ['ai', 'machine learning', 'ml', 'deep learning'],
  'machine learning': ['ml', 'ai', 'artificial intelligence', 'deep learning'],
  'ml': ['machine learning', 'ai', 'artificial intelligence'],
  'tech': ['technology', 'computer', 'software', 'engineering', 'science & tech'],
  'technology': ['tech', 'computer', 'software', 'engineering'],
  'music': ['concert', 'performance', 'jazz', 'classical', 'orchestra', 'recital'],
  'concert': ['music', 'performance', 'show', 'live'],
  'sports': ['athletics', 'game', 'match', 'basketball', 'football', 'volleyball'],
  'basketball': ['sports', 'game', 'hoops', 'cal bears'],
  'football': ['sports', 'game', 'cal bears'],
  'lecture': ['talk', 'presentation', 'seminar', 'speaker', 'academic'],
  'talk': ['lecture', 'presentation', 'seminar', 'speaker'],
  'workshop': ['class', 'training', 'hands-on', 'session'],
  'art': ['arts', 'exhibition', 'gallery', 'museum', 'visual'],
  'arts': ['art', 'exhibition', 'gallery', 'performance', 'theater', 'theatre'],
  'theater': ['theatre', 'play', 'drama', 'performance', 'arts'],
  'theatre': ['theater', 'play', 'drama', 'performance', 'arts'],
  'film': ['movie', 'cinema', 'screening'],
  'movie': ['film', 'cinema', 'screening'],
  'health': ['wellness', 'medical', 'healthcare', 'public health'],
  'wellness': ['health', 'mental health', 'self-care'],
  'career': ['job', 'employment', 'professional', 'networking', 'recruiting'],
  'job': ['career', 'employment', 'hiring', 'internship'],
  'diversity': ['dei', 'inclusion', 'equity', 'multicultural'],
  'dei': ['diversity', 'equity', 'inclusion'],
};

// Expand search query with synonyms
function expandSearchQuery(query: string): string[] {
  const normalized = query.toLowerCase().trim();
  const terms = [normalized];

  // Check for exact matches in synonym map
  if (SEARCH_SYNONYMS[normalized]) {
    terms.push(...SEARCH_SYNONYMS[normalized]);
  }

  // Check if query words match synonym keys (whole word matching only)
  const queryWords = normalized.split(/\s+/);
  Object.entries(SEARCH_SYNONYMS).forEach(([key, synonyms]) => {
    // Only match if the key is exactly one of the query words
    // or if the query exactly matches a multi-word key
    if (queryWords.includes(key) || key === normalized) {
      terms.push(...synonyms);
    }
  });

  return [...new Set(terms)]; // Remove duplicates
}

// Short terms that should only match as whole words (not inside other words)
const WHOLE_WORD_ONLY = new Set(['ai', 'ml', 'ar', 'vr', 'it', 'cs']);

// Check if event matches any of the search terms
function eventMatchesSearch(event: CalEvent, searchTerms: string[]): boolean {
  const searchableText = [
    event.title,
    event.description,
    event.organizer,
    ...(event.tags || [])
  ].join(' ').toLowerCase();

  return searchTerms.some(term => {
    // For short terms, use word boundary matching to avoid false positives
    // e.g., "ai" should match "AI event" but not "against" or "training"
    if (WHOLE_WORD_ONLY.has(term)) {
      const wordBoundaryRegex = new RegExp(`\\b${term}\\b`, 'i');
      return wordBoundaryRegex.test(searchableText);
    }
    // For longer terms, substring matching is fine
    return searchableText.includes(term);
  });
}

const Categories = ['All', 'Academic', 'Arts', 'Sports', 'Science & Tech', 'Student Life'];
const DateRanges = [
  { label: 'Upcoming', value: 'upcoming' },
  { label: 'Today', value: 'today' },
  { label: 'This Week', value: 'week' },
];

export default function App() {
  const [allEvents, setAllEvents] = useState<CalEvent[]>([]);
  const [sources, setSources] = useState<GroundingSource[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [loading, setLoading] = useState<LoadingState>(LoadingState.IDLE);
  const [filters, setFilters] = useState<SearchFilters>({
    dateRange: 'upcoming',
    category: 'All',
    searchQuery: ''
  });

  const loadEvents = async () => {
    setLoading(LoadingState.LOADING);
    try {
      const data = await fetchEventsFromGemini();
      setAllEvents(data.events);
      setSources(data.sources);
      setLastUpdated(data.lastUpdated);
      setLoading(LoadingState.SUCCESS);
    } catch (error) {
      console.error(error);
      setLoading(LoadingState.ERROR);
    }
  };

  useEffect(() => {
    loadEvents();
  }, []);

  // Instant Local Filtering with natural language search
  const filteredEvents = useMemo(() => {
    return allEvents.filter(event => {
      // Category filter
      const matchesCategory = filters.category === 'All' ||
        event.tags?.some(t => t.toLowerCase().includes(filters.category.toLowerCase())) ||
        event.tags?.includes(filters.category);

      // Date filter
      const eventDate = new Date(event.date);
      const today = new Date();
      today.setHours(0,0,0,0);

      let matchesDate = true;
      if (filters.dateRange === 'today') {
        matchesDate = eventDate.toDateString() === today.toDateString();
      } else if (filters.dateRange === 'week') {
        const nextWeek = new Date();
        nextWeek.setDate(today.getDate() + 7);
        matchesDate = eventDate >= today && eventDate <= nextWeek;
      }

      // Search filter with synonym expansion
      const searchQuery = filters.searchQuery.trim();
      let matchesSearch = true;
      if (searchQuery) {
        const expandedTerms = expandSearchQuery(searchQuery);
        matchesSearch = eventMatchesSearch(event, expandedTerms);
      }

      return matchesCategory && matchesDate && matchesSearch;
    });
  }, [allEvents, filters]);

  return (
    <div className="min-h-screen bg-berkeley-lightgray text-gray-800 font-sans">
      {/* Header */}
      <header className="bg-berkeley-blue text-white shadow-md sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-berkeley-gold text-2xl font-bold">Cal</span>
              <span className="text-2xl font-light tracking-wide">Events</span>
            </div>
            {lastUpdated && (
              <span className="text-[10px] text-berkeley-gold/70 uppercase tracking-tighter -mt-1 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                Last Synced: {new Date(lastUpdated).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
              </span>
            )}
          </div>
          
          <div className="w-full md:w-1/2 relative">
            <input 
              type="text" 
              placeholder="Search for events, concerts and seminars" 
              className="w-full px-4 py-2 rounded-full text-gray-900 focus:outline-none focus:ring-2 focus:ring-berkeley-gold text-sm"
              value={filters.searchQuery}
              onChange={(e) => setFilters(prev => ({...prev, searchQuery: e.target.value}))}
            />
            <svg xmlns="http://www.w3.org/2000/svg" className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        {/* Filters Bar */}
        <div className="bg-berkeley-medblue text-white text-xs overflow-x-auto border-t border-white/10">
          <div className="container mx-auto px-4 py-2 flex items-center gap-4 whitespace-nowrap">
            <div className="flex items-center gap-2">
              <span className="font-bold text-berkeley-gold uppercase text-[10px]">Time</span>
              {DateRanges.map(range => (
                <button
                  key={range.value}
                  onClick={() => setFilters(prev => ({ ...prev, dateRange: range.value as any }))}
                  className={`px-3 py-1 rounded-full transition ${filters.dateRange === range.value ? 'bg-white text-berkeley-blue font-bold shadow-inner' : 'hover:bg-white/20'}`}
                >
                  {range.label}
                </button>
              ))}
            </div>
            <div className="w-px h-4 bg-white/30 mx-1"></div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-berkeley-gold uppercase text-[10px]">Topic</span>
              {Categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setFilters(prev => ({ ...prev, category: cat }))}
                  className={`px-3 py-1 rounded-full transition ${filters.category === cat ? 'bg-white text-berkeley-blue font-bold shadow-inner' : 'hover:bg-white/20'}`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        
        {loading === LoadingState.LOADING && (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <div className="relative">
               <div className="w-16 h-16 border-4 border-berkeley-blue/20 rounded-full"></div>
               <div className="absolute top-0 w-16 h-16 border-4 border-transparent border-t-berkeley-gold rounded-full animate-spin"></div>
            </div>
            <div className="text-center">
              <h3 className="text-berkeley-blue font-bold text-lg">Loading Events</h3>
              <p className="text-gray-500 text-sm animate-pulse">Fetching today's events...</p>
            </div>
          </div>
        )}

        {loading === LoadingState.ERROR && (
          <div className="text-center py-10 bg-red-50 rounded-xl border border-red-200 max-w-lg mx-auto">
            <h3 className="text-xl text-red-800 font-bold mb-2">Failed to Load Events</h3>
            <p className="text-red-600 mb-4">We couldn't load today's events.</p>
            <button onClick={() => loadEvents()} className="px-6 py-2 bg-berkeley-blue text-white rounded-lg font-bold hover:bg-berkeley-medblue transition shadow-md">Retry</button>
          </div>
        )}

        {loading === LoadingState.SUCCESS && (
          <>
            <div className="flex justify-between items-end mb-6">
              <h2 className="text-2xl font-bold text-berkeley-blue">
                {filters.category === 'All' ? 'Latest Events' : `${filters.category} Events`}
                <span className="ml-2 text-sm font-normal text-gray-400">({filteredEvents.length} found)</span>
              </h2>
            </div>

            {filteredEvents.length === 0 ? (
              <div className="text-center py-24 bg-white rounded-2xl border-2 border-dashed border-gray-200">
                <p className="text-xl text-gray-400 font-medium">No events match these filters in today's batch.</p>
                <button 
                  onClick={() => setFilters({dateRange: 'upcoming', category: 'All', searchQuery: ''})}
                  className="mt-4 text-berkeley-medblue font-bold hover:underline"
                >
                  Clear all filters
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredEvents.map((event, idx) => (
                  <div key={event.id || idx} className="bg-white rounded-xl shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-100 overflow-hidden flex flex-col group">
                    <div className="p-5 flex-grow">
                      <div className="flex justify-between items-start mb-3">
                        <span className="inline-block bg-berkeley-blue text-berkeley-gold text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-widest">
                          {event.tags?.[0] || 'Event'}
                        </span>
                        {event.url && (
                          <a href={event.url} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-berkeley-gold transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        )}
                      </div>
                      
                      <h3 className="text-lg font-bold text-berkeley-blue mb-3 leading-tight group-hover:text-berkeley-medblue transition-colors">{event.title}</h3>
                      
                      <div className="space-y-2.5 text-xs text-gray-600 mb-4">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 bg-berkeley-gold/10 rounded">
                            <svg className="h-3.5 w-3.5 text-berkeley-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </div>
                          <span className="font-bold text-gray-800">{event.date}</span>
                          <span className="text-gray-300">•</span>
                          <span className="font-medium">{event.time}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 bg-berkeley-gold/10 rounded">
                            <svg className="h-3.5 w-3.5 text-berkeley-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            </svg>
                          </div>
                          <span className="truncate">{event.location}</span>
                        </div>
                        <div className="flex items-center gap-2">
                           <div className="p-1.5 bg-berkeley-gold/10 rounded">
                            <svg className="h-3.5 w-3.5 text-berkeley-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0z" />
                            </svg>
                          </div>
                          <span className="italic font-medium">{event.organizer}</span>
                        </div>
                      </div>

                      <p className="text-gray-600 text-sm line-clamp-2 italic leading-relaxed">
                        "{event.description}"
                      </p>
                    </div>
                    
                    <div className="px-5 py-4 bg-gray-50/50 border-t border-gray-100 flex items-center justify-between">
                       <a 
                        href={event.url || '#'} 
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-berkeley-blue text-sm font-bold hover:underline flex items-center gap-1"
                      >
                        Official Page
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                      </a>
                      <span className="text-[10px] text-gray-400 font-mono tracking-tighter">ID: {event.id.slice(0, 8)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Grounding Sources Section */}
            {sources.length > 0 && (
              <div className="mt-20 border-t-2 border-berkeley-blue/5 pt-10 pb-10">
                <div className="flex items-center gap-3 mb-6">
                  <div className="h-px flex-grow bg-gray-200"></div>
                  <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] whitespace-nowrap">Daily Sync Verification</h4>
                  <div className="h-px flex-grow bg-gray-200"></div>
                </div>
                <div className="flex flex-wrap justify-center gap-4">
                  {sources.slice(0, 6).map((source, idx) => (
                    <a 
                      key={idx} 
                      href={source.uri} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="group flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-gray-100 hover:border-berkeley-gold hover:shadow-sm transition-all text-xs text-gray-500"
                    >
                      <img 
                        src={`https://www.google.com/s2/favicons?domain=${new URL(source.uri).hostname}`} 
                        alt="" 
                        className="w-3 h-3 grayscale group-hover:grayscale-0"
                      />
                      <span className="max-w-[150px] truncate">{source.title}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
