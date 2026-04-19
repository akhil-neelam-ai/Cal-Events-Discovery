
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { fetchEventsFromGemini } from './services/geminiService';
import { CalEvent, IngestionStatus, SearchFilters, LoadingState } from './types';
import {
  initGA,
  trackPageView,
  trackSearch,
  trackCategoryFilter,
  trackDateFilter,
  trackEventClick,
  trackExternalLink,
  trackFilter,
} from './utils/analytics';

// Source provenance helpers
const SOURCE_LABELS: Record<string, string> = {
  livewhale: 'UC Berkeley Events',
  ehub: 'Berkeley E-Hub',
  gemini: 'Discovered',
  cal_performances: 'Cal Performances',
  bampfa: 'BAMPFA',
  calbears: 'Cal Bears',
  callink: 'CalLink',
  haas: 'Berkeley Haas',
  berkeley_law: 'Berkeley Law',
  simons: 'Simons Institute',
};

const SOURCE_URLS: Record<string, string> = {
  livewhale: 'https://events.berkeley.edu',
  ehub: 'https://ehub.berkeley.edu/events/',
  cal_performances: 'https://calperformances.org',
  bampfa: 'https://bampfa.org/events',
  calbears: 'https://calbears.com/calendar',
  callink: 'https://callink.berkeley.edu/events',
  haas: 'https://haas.berkeley.edu/events/',
  berkeley_law: 'https://www.law.berkeley.edu/events/',
  simons: 'https://simons.berkeley.edu/programs-events',
};

// Source dropdown used in the header filters bar. Replaces the old chip row
// now that we have ~10 sources that were wrapping awkwardly.
interface SourceOption {
  value: string;
  label: string;
  count: number;
}

function SourceDropdown({
  options,
  value,
  onChange,
}: {
  options: SourceOption[];
  value: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState<number>(-1);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selected = options.find(o => o.value === value) ?? options[0];

  // Close on outside click (panel is portal-free but position-fixed, so check both refs)
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideTrigger = containerRef.current?.contains(target);
      const insidePanel = panelRef.current?.contains(target);
      if (!insideTrigger && !insidePanel) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Position the fixed panel under the trigger. Recompute on open, resize, scroll.
  useEffect(() => {
    if (!open) {
      setPanelPos(null);
      return;
    }
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const minWidth = 220;
      const width = Math.max(rect.width, minWidth);
      // Keep the panel on-screen horizontally
      const maxLeft = window.innerWidth - width - 8;
      const left = Math.max(8, Math.min(rect.left, maxLeft));
      setPanelPos({ top: rect.bottom + 6, left, width });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  // Close on Escape regardless of focus target within the dropdown
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  // When opening, focus the currently-selected option
  useEffect(() => {
    if (open) {
      const current = options.findIndex(o => o.value === value);
      const idx = current >= 0 ? current : 0;
      setFocusIndex(idx);
      // defer so refs exist after render
      requestAnimationFrame(() => {
        itemRefs.current[idx]?.focus();
      });
    } else {
      setFocusIndex(-1);
    }
  }, [open, options, value]);

  const handleTriggerKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
    }
  };

  const handleItemKey = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = (idx + 1) % options.length;
      setFocusIndex(next);
      itemRefs.current[next]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = (idx - 1 + options.length) % options.length;
      setFocusIndex(prev);
      itemRefs.current[prev]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      setFocusIndex(0);
      itemRefs.current[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      const last = options.length - 1;
      setFocusIndex(last);
      itemRefs.current[last]?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(options[idx].value);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        onKeyDown={handleTriggerKey}
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 transition text-white"
      >
        <span className="font-medium">
          {selected.label} <span className="opacity-70">({selected.count})</span>
        </span>
        <svg
          className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && panelPos && (
        <div
          ref={panelRef}
          role="listbox"
          aria-label="Filter by source"
          style={{
            position: 'fixed',
            top: panelPos.top,
            left: panelPos.left,
            width: panelPos.width,
          }}
          className="max-h-[60vh] overflow-y-auto bg-white text-gray-800 rounded-lg shadow-xl border border-gray-200 z-[70] py-1"
        >
          {options.map((opt, idx) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                ref={el => { itemRefs.current[idx] = el; }}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => pick(opt.value)}
                onKeyDown={e => handleItemKey(e, idx)}
                onMouseEnter={() => setFocusIndex(idx)}
                className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-3 transition ${
                  isSelected
                    ? 'bg-berkeley-blue text-white'
                    : focusIndex === idx
                      ? 'bg-berkeley-gold/20 text-berkeley-blue'
                      : 'hover:bg-berkeley-gold/10 text-gray-800'
                }`}
              >
                <span className="font-medium truncate">{opt.label}</span>
                <span className={`flex-shrink-0 tabular-nums ${isSelected ? 'text-white/80' : 'text-gray-500'}`}>
                  {opt.count}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SourceBadge({ source }: { source?: string }) {
  if (!source || !SOURCE_LABELS[source]) return null;
  const label = SOURCE_LABELS[source];
  const url = SOURCE_URLS[source];
  const inner = (
    <span className="inline-flex items-center gap-1 text-[10px] text-gray-400 font-medium">
      <svg className="w-2.5 h-2.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
      {label}
    </span>
  );
  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="hover:text-gray-600 transition-colors">
        {inner}
      </a>
    );
  }
  return inner;
}

// Hook to detect mobile vs desktop
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return isMobile;
}

const PACIFIC_TIME_ZONE = 'America/Los_Angeles';
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PACIFIC_DATE_PARTS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const PACIFIC_SYNC_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC_TIME_ZONE,
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

function formatDateKeyInTimeZone(date: Date): string {
  const parts = PACIFIC_DATE_PARTS_FORMATTER.formatToParts(date);

  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;

  if (!year || !month || !day) {
    return '';
  }

  return `${year}-${month}-${day}`;
}

function getPacificDateKey(dateString: string): string {
  if (DATE_ONLY_RE.test(dateString)) {
    return dateString;
  }

  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  return formatDateKeyInTimeZone(parsed);
}

function getCurrentPacificDateKey(now = new Date()): string {
  return formatDateKeyInTimeZone(now);
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) {
    return dateKey;
  }

  const shifted = new Date(Date.UTC(year, month - 1, day));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function formatPacificDateTime(timestamp: number): string {
  return PACIFIC_SYNC_FORMATTER.format(new Date(timestamp));
}

function formatStatusSources(status: IngestionStatus): string {
  const failed = status.sources.filter(source => !source.ok).map(source => SOURCE_LABELS[source.name] || source.name);
  if (failed.length === 0) {
    return '';
  }

  if (failed.length === 1) {
    return failed[0];
  }

  if (failed.length === 2) {
    return `${failed[0]} and ${failed[1]}`;
  }

  return `${failed.slice(0, 2).join(', ')} and ${failed.length - 2} more`;
}

function formatNamedSources(names: string[] | undefined): string {
  if (!names || names.length === 0) {
    return '';
  }

  const labels = names.map(name => SOURCE_LABELS[name] || name);
  if (labels.length === 1) {
    return labels[0];
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  return `${labels.slice(0, 2).join(', ')} and ${labels.length - 2} more`;
}

// Format date from YYYY-MM-DD to "10th Feb"
function formatEventDate(dateString: string): string {
  const key = getPacificDateKey(dateString) || dateString.slice(0, 10);
  const [, month, day] = key.split('-').map(Number);

  if (!month || !day) {
    return dateString;
  }

  // Add ordinal suffix (st, nd, rd, th)
  const ordinal = (n: number) => {
    if (n > 3 && n < 21) return 'th';
    switch (n % 10) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  };

  return `${day}${ordinal(day)} ${MONTHS[month - 1]}`;
}

// Bottom Sheet Component (Mobile)
function BottomSheet({ event, onClose }: { event: CalEvent; onClose: () => void }) {
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(onClose, 300);
  }, [onClose]);

  const handleTouchStart = () => setIsDragging(true);
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    const deltaY = touch.clientY - (e.target as HTMLElement).getBoundingClientRect().top;
    if (deltaY > 0) setDragY(deltaY);
  };
  const handleTouchEnd = () => {
    setIsDragging(false);
    if (dragY > 150) {
      handleClose();
    }
    setDragY(0);
  };

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'animate-fade-in'}`}
        onClick={handleClose}
      />
      {/* Sheet */}
      <div
        className={`absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl max-h-[85vh] overflow-hidden shadow-2xl ${isClosing ? '' : 'animate-slide-up'}`}
        style={{
          transform: isClosing ? 'translateY(100%)' : `translateY(${dragY}px)`,
          transition: isDragging ? 'none' : 'transform 0.4s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.3s ease-out'
        }}
      >
        {/* Drag Handle */}
        <div
          className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="w-12 h-1.5 bg-gray-300 rounded-full" />
        </div>

        {/* Content */}
        <div className="px-5 pb-8 overflow-y-auto max-h-[calc(85vh-40px)]">
          <div className="flex items-center justify-between mb-3">
            <span className="inline-block bg-berkeley-blue text-berkeley-gold text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-widest">
              {event.tags?.[0] || 'Event'}
            </span>
            <SourceBadge source={event.source} />
          </div>

          <h2 className="text-xl font-bold text-berkeley-blue mb-4">{event.title}</h2>

          <div className="space-y-3 text-sm text-gray-600 mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-berkeley-gold/10 rounded-lg">
                <svg className="h-4 w-4 text-berkeley-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <div className="font-bold text-gray-800">{formatEventDate(event.date)}</div>
                <div className="text-gray-500">{event.time}</div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="p-2 bg-berkeley-gold/10 rounded-lg">
                <svg className="h-4 w-4 text-berkeley-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                </svg>
              </div>
              <div className="font-medium">{event.location}</div>
            </div>

            <div className="flex items-center gap-3">
              <div className="p-2 bg-berkeley-gold/10 rounded-lg">
                <svg className="h-4 w-4 text-berkeley-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
              <div className="italic">{event.organizer}</div>
            </div>
          </div>

          <div className="mb-6">
            <h3 className="font-bold text-gray-800 mb-2">About this event</h3>
            <p className="text-gray-600 leading-relaxed">{event.description}</p>
          </div>

          {event.url && (
            <a
              href={event.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full py-3 bg-berkeley-blue text-white text-center font-bold rounded-lg hover:bg-berkeley-medblue transition"
              onClick={() => trackExternalLink({
                event_id: event.id,
                event_title: event.title,
                destination_url: event.url,
              })}
            >
              View Official Page
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// Slide-out Panel Component (Desktop)
function SlideOutPanel({ event, onClose }: { event: CalEvent; onClose: () => void }) {
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(onClose, 350);
  }, [onClose]);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [handleClose]);

  return (
    <div className="fixed inset-0 z-50 hidden md:block">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'animate-fade-in'}`}
        onClick={handleClose}
      />
      {/* Panel */}
      <div
        className={`absolute top-0 right-0 h-full w-[450px] bg-white shadow-2xl overflow-hidden ${isClosing ? '' : 'animate-slide-in'}`}
        style={{
          boxShadow: '-10px 0 40px rgba(0,0,0,0.15)',
          transform: isClosing ? 'translateX(100%)' : 'translateX(0)',
          transition: 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)'
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-berkeley-blue text-white">
          <span className="font-bold">Event Details</span>
          <button
            onClick={onClose}
            className="p-1 hover:bg-white/20 rounded transition"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto h-[calc(100%-60px)]">
          <div className="flex items-center justify-between mb-3">
            <span className="inline-block bg-berkeley-blue text-berkeley-gold text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-widest">
              {event.tags?.[0] || 'Event'}
            </span>
            <SourceBadge source={event.source} />
          </div>

          <h2 className="text-2xl font-bold text-berkeley-blue mb-6">{event.title}</h2>

          <div className="space-y-4 text-sm text-gray-600 mb-8">
            <div className="flex items-start gap-4 p-3 bg-gray-50 rounded-lg">
              <div className="p-2 bg-berkeley-gold/10 rounded-lg">
                <svg className="h-5 w-5 text-berkeley-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <div className="font-bold text-gray-800 text-base">{formatEventDate(event.date)}</div>
                <div className="text-gray-500">{event.time}</div>
              </div>
            </div>

            <div className="flex items-start gap-4 p-3 bg-gray-50 rounded-lg">
              <div className="p-2 bg-berkeley-gold/10 rounded-lg">
                <svg className="h-5 w-5 text-berkeley-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                </svg>
              </div>
              <div className="font-medium text-base">{event.location}</div>
            </div>

            <div className="flex items-start gap-4 p-3 bg-gray-50 rounded-lg">
              <div className="p-2 bg-berkeley-gold/10 rounded-lg">
                <svg className="h-5 w-5 text-berkeley-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
              <div className="italic text-base">{event.organizer}</div>
            </div>
          </div>

          <div className="mb-8">
            <h3 className="font-bold text-gray-800 mb-3 text-lg">About this event</h3>
            <p className="text-gray-600 leading-relaxed">{event.description}</p>
          </div>

          {event.url && (
            <a
              href={event.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full py-3 bg-berkeley-blue text-white text-center font-bold rounded-lg hover:bg-berkeley-medblue transition"
              onClick={() => trackExternalLink({
                event_id: event.id,
                event_title: event.title,
                destination_url: event.url,
              })}
            >
              View Official Page
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

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

// Berkeley/campus locations for filtering home games
const BERKELEY_LOCATIONS = [
  'berkeley', 'uc berkeley', 'cal ', 'memorial stadium', 'haas pavilion',
  'edwards stadium', 'evans diamond', 'hearst', 'recreational sports facility',
  'rsf', 'zellerbach', 'wheeler', 'dwinelle', 'soda hall', 'cory hall',
  'doe library', 'moffitt', 'bancroft', 'sproul', 'mlk student union',
  'california memorial', 'greek theatre', 'hearst greek'
];

// Check if a sports event is a home game (in Berkeley)
function isHomeGame(event: CalEvent): boolean {
  // Only apply this filter to sports events
  const isSportsEvent = event.tags?.some(tag =>
    tag.toLowerCase().includes('sport')
  );

  if (!isSportsEvent) return true; // Non-sports events pass through

  const location = event.location.toLowerCase();
  return BERKELEY_LOCATIONS.some(loc => location.includes(loc));
}

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

const Categories = ['All', 'Academic', 'Arts', 'Sports', 'Science & Tech', 'Student Life', 'Entrepreneurship'];
const ALL_SOURCES = ['All', 'livewhale', 'ehub', 'gemini', 'cal_performances', 'bampfa', 'calbears', 'callink', 'haas', 'berkeley_law', 'simons'];
const DateRanges = [
  { label: 'Upcoming', value: 'upcoming' },
  { label: 'Today', value: 'today' },
  { label: 'This Week', value: 'week' },
];

export default function App() {
  const [allEvents, setAllEvents] = useState<CalEvent[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [loading, setLoading] = useState<LoadingState>(LoadingState.IDLE);
  const [statusReport, setStatusReport] = useState<IngestionStatus | null>(null);
  const [filters, setFilters] = useState<SearchFilters>({
    dateRange: 'upcoming',
    category: 'All',
    searchQuery: '',
    source: 'All',
  });
  const [selectedEvent, setSelectedEvent] = useState<CalEvent | null>(null);
  const isMobile = useIsMobile();
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleEventClick = useCallback((event: CalEvent) => {
    setSelectedEvent(event);
    trackEventClick({
      event_id: event.id,
      event_title: event.title,
      event_category: event.tags?.[0] || 'Unknown',
      event_date: event.date,
    });
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedEvent(null);
  }, []);

  const loadEvents = async () => {
    setLoading(LoadingState.LOADING);
    setStatusReport(null);
    try {
      const data = await fetchEventsFromGemini();
      setAllEvents(data.events);
      setLastUpdated(data.lastUpdated);
      setStatusReport(data.status || null);
      setLoading(LoadingState.SUCCESS);
    } catch (error) {
      console.error(error);
      setLoading(LoadingState.ERROR);
    }
  };

  useEffect(() => {
    // Initialize GA4 and track page view
    // Vercel Analytics is initialized via the <Analytics /> component wrapper
    initGA();
    trackPageView({ page_path: '/', page_title: 'CalEvents - UC Berkeley Events' });
    loadEvents();
  }, []);

  // Per-source counts from the full event set, used to populate the Source dropdown.
  // Preserves the original ALL_SOURCES ordering and filters to sources that have
  // at least one event in the current dataset.
  const sourceOptions = useMemo<SourceOption[]>(() => {
    const counts = new Map<string, number>();
    for (const ev of allEvents) {
      if (!ev.source) continue;
      counts.set(ev.source, (counts.get(ev.source) ?? 0) + 1);
    }
    const opts: SourceOption[] = [{ value: 'All', label: 'All', count: allEvents.length }];
    for (const src of ALL_SOURCES) {
      if (src === 'All') continue;
      const count = counts.get(src) ?? 0;
      if (count === 0) continue;
      opts.push({
        value: src,
        label: SOURCE_LABELS[src] || src,
        count,
      });
    }
    return opts;
  }, [allEvents]);

  const statusBanner = useMemo(() => {
    if (!statusReport) {
      return null;
    }

    const failedSources = statusReport.sources.filter(source => !source.ok);
    const failedLabel = formatStatusSources(statusReport);
    const fallbackLabel = formatNamedSources(statusReport.fallback_sources);
    const degradedLabel = formatNamedSources(statusReport.degraded_sources);

    if (statusReport.degraded || statusReport.fallback_used || statusReport.last_good_used > 0) {
      return {
        tone: 'warning' as const,
        title: statusReport.fallback_used ? 'Showing mostly fresh data.' : 'Showing partial data.',
        message: statusReport.fallback_used
          ? (
              fallbackLabel
                ? `The latest update reused cached events for ${fallbackLabel}.`
                : failedLabel
                  ? `The latest update had source issues (${failedLabel}) and reused cached events for part of the feed.`
                  : 'The latest update reused cached events for part of the feed.'
            )
          : (
              degradedLabel
                ? `${degradedLabel} did not return a healthy result in the latest run.`
                : statusReport.degraded_reason || 'One or more sources did not return a healthy result in the latest run.'
            ),
      };
    }

    if (failedSources.length > 0) {
      return {
        tone: 'info' as const,
        title: 'Some sources were unavailable.',
        message: failedLabel
          ? `The current dataset loaded successfully, but ${failedLabel} did not return data in the latest run.`
          : 'The current dataset loaded successfully, but one or more sources did not return data in the latest run.',
      };
    }

    return null;
  }, [statusReport]);

  // Instant Local Filtering with natural language search
  const filteredEvents = useMemo(() => {
    const todayKey = getCurrentPacificDateKey();
    const nextWeekKey = addDaysToDateKey(todayKey, 7);

    return allEvents.filter(event => {
      // Category filter
      const matchesCategory = filters.category === 'All' ||
        event.tags?.some(t => t.toLowerCase().includes(filters.category.toLowerCase())) ||
        event.tags?.includes(filters.category);

      // Date filter
      const eventDateKey = getPacificDateKey(event.date);
      if (!eventDateKey) {
        return false;
      }

      let matchesDate = true;
      if (filters.dateRange === 'today') {
        matchesDate = eventDateKey === todayKey;
      } else if (filters.dateRange === 'week') {
        matchesDate = eventDateKey >= todayKey && eventDateKey <= nextWeekKey;
      } else if (filters.dateRange === 'upcoming') {
        matchesDate = eventDateKey >= todayKey;
      }

      // Search filter with synonym expansion
      const searchQuery = filters.searchQuery.trim();
      let matchesSearch = true;
      if (searchQuery) {
        const expandedTerms = expandSearchQuery(searchQuery);
        matchesSearch = eventMatchesSearch(event, expandedTerms);
      }

      // Filter out away games for sports events
      const isLocalEvent = isHomeGame(event);

      // Source filter
      const matchesSource = filters.source === 'All' || event.source === filters.source;

      return matchesCategory && matchesDate && matchesSearch && isLocalEvent && matchesSource;
    })
    .sort((a, b) => {
      // Sort by date ascending (earliest first)
      const dateA = getPacificDateKey(a.date);
      const dateB = getPacificDateKey(b.date);
      const dateCompare = dateA.localeCompare(dateB);
      if (dateCompare !== 0) return dateCompare;
      return (a.time || '').localeCompare(b.time || '') || a.title.localeCompare(b.title);
    });
  }, [allEvents, filters]);

  return (
    <div className="min-h-screen bg-berkeley-lightgray text-gray-800 font-sans">
      <Analytics />
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
                Last Synced: {formatPacificDateTime(lastUpdated)}
              </span>
            )}
          </div>
          
          <div className="w-full md:w-1/2 relative">
            <input
              type="text"
              placeholder="Search for events, concerts and seminars"
              className="w-full px-4 py-2 rounded-full text-gray-900 focus:outline-none focus:ring-2 focus:ring-berkeley-gold text-sm"
              value={filters.searchQuery}
              onChange={(e) => {
                const query = e.target.value;
                setFilters(prev => ({...prev, searchQuery: query}));
                // Debounced search tracking (500ms after typing stops)
                if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
                if (query.trim().length >= 2) {
                  searchTimeoutRef.current = setTimeout(() => {
                    trackSearch({ search_term: query.trim(), results_count: filteredEvents.length });
                  }, 500);
                }
              }}
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
                  onClick={() => {
                    setFilters(prev => ({ ...prev, dateRange: range.value as any }));
                    trackDateFilter(range.value);
                  }}
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
                  onClick={() => {
                    setFilters(prev => ({ ...prev, category: cat }));
                    trackCategoryFilter(cat);
                  }}
                  className={`px-3 py-1 rounded-full transition ${filters.category === cat ? 'bg-white text-berkeley-blue font-bold shadow-inner' : 'hover:bg-white/20'}`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div className="w-px h-4 bg-white/30 mx-1"></div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-berkeley-gold uppercase text-[10px]">Source</span>
              <SourceDropdown
                value={filters.source}
                options={sourceOptions}
                onChange={(next) => {
                  setFilters(prev => ({ ...prev, source: next }));
                  trackFilter({ filter_type: 'source', filter_value: next });
                }}
              />
            </div>
          </div>
        </div>
      </header>

      {statusBanner && (
        <div className={statusBanner.tone === 'warning' ? 'bg-yellow-50 border-b border-yellow-200 text-yellow-900 text-xs' : 'bg-blue-50 border-b border-blue-200 text-blue-900 text-xs'}>
          <div className="container mx-auto px-4 py-2 flex items-start gap-2">
            <svg className={statusBanner.tone === 'warning' ? 'w-4 h-4 flex-shrink-0 mt-px text-yellow-700' : 'w-4 h-4 flex-shrink-0 mt-px text-blue-700'} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-2.99l-6.93-12a2 2 0 00-3.48 0l-6.93 12A2 2 0 005.07 19z" />
            </svg>
            <span>
              <strong>{statusBanner.title}</strong> {statusBanner.message}
            </span>
          </div>
        </div>
      )}

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
                  onClick={() => setFilters({dateRange: 'upcoming', category: 'All', searchQuery: '', source: 'All'})}
                  className="mt-4 text-berkeley-medblue font-bold hover:underline"
                >
                  Clear all filters
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredEvents.map((event, idx) => (
                  <div
                    key={event.id || idx}
                    onClick={() => handleEventClick(event)}
                    className="bg-white rounded-xl shadow-sm hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 ease-out border border-gray-100 overflow-hidden flex flex-col group cursor-pointer animate-card-in opacity-0"
                    style={{ animationDelay: `${Math.min(idx * 50, 500)}ms`, animationFillMode: 'forwards' }}
                  >
                    <div className="p-5 flex-grow">
                      <div className="flex justify-between items-start mb-3">
                        <span className="inline-block bg-berkeley-blue text-berkeley-gold text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-widest">
                          {event.tags?.[0] || 'Event'}
                        </span>
                        {event.url && (
                          <a
                            href={event.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-gray-400 hover:text-berkeley-gold transition-colors"
                          >
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
                          <span className="font-bold text-gray-800">{formatEventDate(event.date)}</span>
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
                        onClick={(e) => e.stopPropagation()}
                        className="text-berkeley-blue text-sm font-bold hover:underline flex items-center gap-1"
                      >
                        Official Page
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                      </a>
                      <SourceBadge source={event.source} />
                    </div>
                  </div>
                ))}
              </div>
            )}

          </>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-berkeley-blue text-white/70 py-6 mt-10">
        <div className="container mx-auto px-4 text-center text-sm">
          <p className="mb-1">
            I'm <a href="https://akhilneelam.com/" target="_blank" rel="noopener noreferrer" className="text-berkeley-gold hover:underline font-medium">Akhil</a>, MBA student at <span className="text-berkeley-gold font-medium">Haas School of Business</span>, and I built this to help Berkeley students discover campus events across different schools.
          </p>
          <p>
            Feedback? Reach out at{' '}
            <a href="mailto:akhil_neelam@berkeley.edu" className="text-berkeley-gold hover:underline">
              akhil_neelam@berkeley.edu
            </a>
          </p>
          <p className="mt-2">
            <a href="/architecture.png" target="_blank" rel="noopener noreferrer" className="text-white/40 hover:text-white/70 text-xs transition-colors">
              How this works →
            </a>
          </p>
        </div>
      </footer>

      {/* Event Detail Panel/Sheet */}
      {selectedEvent && (
        isMobile ? (
          <BottomSheet event={selectedEvent} onClose={handleCloseDetail} />
        ) : (
          <SlideOutPanel event={selectedEvent} onClose={handleCloseDetail} />
        )
      )}
    </div>
  );
}
