
import React, { useState, useEffect, useMemo, useCallback, useRef, useId } from 'react';
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
import { searchEvents, buildSearchPlan } from './utils/searchEngine';
import type { SearchIndex } from './utils/textUtils';
import type { InterpretedChip } from './utils/searchEngine';
import { getRecentSearches, addRecentSearch, clearRecentSearches } from './utils/recentSearches';
import { buildUrlStateSearch, parseUrlState } from './utils/urlState';

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
  tone = 'light',
}: {
  options: SourceOption[];
  value: string;
  onChange: (next: string) => void;
  tone?: 'light' | 'dark';
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

  const triggerClasses = tone === 'dark'
    ? 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 transition text-white'
    : 'inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-2 text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50';

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        onKeyDown={handleTriggerKey}
        className={triggerClasses}
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
            zIndex: 9999,
          }}
          className="max-h-[60vh] overflow-y-auto bg-white text-gray-800 rounded-xl shadow-2xl border border-slate-200 py-1.5"
        >
          {options.map((opt, idx) => {
            const isSelected = opt.value === value;
            const isAllOption = opt.value === 'All';
            return (
              <React.Fragment key={opt.value}>
                {/* Divider between All and individual sources */}
                {idx === 1 && (
                  <div className="mx-3 my-1.5 border-t border-slate-100" />
                )}
                <button
                  ref={el => { itemRefs.current[idx] = el; }}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => pick(opt.value)}
                  onKeyDown={e => handleItemKey(e, idx)}
                  onMouseEnter={() => setFocusIndex(idx)}
                  className={`w-full text-left mx-1 px-3 py-2 rounded-lg text-xs flex items-center justify-between gap-3 transition-colors ${
                    isSelected
                      ? 'bg-berkeley-blue text-white'
                      : focusIndex === idx
                        ? 'bg-slate-100 text-berkeley-blue'
                        : 'text-slate-700 hover:bg-slate-50'
                  } ${isAllOption ? 'font-semibold' : ''}`}
                  style={{ width: 'calc(100% - 8px)' }}
                >
                  <span className="truncate">{opt.label}</span>
                  <span className={`flex-shrink-0 tabular-nums text-[11px] rounded-full px-1.5 py-0.5 ${
                    isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {opt.count}
                  </span>
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SourceBadge({ source, linked = true }: { source?: string; linked?: boolean }) {
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
  if (url && linked) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex px-2 py-1 -mx-2 -my-1 rounded hover:text-gray-600 transition-colors">
        {inner}
      </a>
    );
  }
  return inner;
}

// Hook to detect mobile vs desktop
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 768 : false));

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
const ONLINE_LOCATION_RE = /\b(online|virtual|zoom|remote|livestream|live stream|webinar)\b/i;
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

function formatShortDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return dateKey;
  return `${MONTHS[month - 1]} ${day}`;
}

// Format date key into a section header label (Today · Apr 19 / Tomorrow · Apr 20 / Friday · Apr 25)
function dateGroupLabel(dateKey: string): string {
  const todayKey = getCurrentPacificDateKey();
  const tomorrowKey = addDaysToDateKey(todayKey, 1);
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return dateKey;
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayName = date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const shortDate = formatShortDateKey(dateKey);
  if (dateKey === todayKey) return `Today · ${shortDate}`;
  if (dateKey === tomorrowKey) return `Tomorrow · ${shortDate}`;
  return `${dayName} · ${shortDate}`;
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

function filterEventsByDateRange(
  events: CalEvent[],
  dateRange: SearchFilters['dateRange'],
  todayKey: string,
  nextWeekKey: string,
  tomorrowKey?: string,
): CalEvent[] {
  return events.filter(event => {
    const eventDateKey = getPacificDateKey(event.date);
    if (!eventDateKey) {
      return false;
    }

    if (dateRange === 'today') {
      return eventDateKey === todayKey;
    }

    if (dateRange === 'tomorrow') {
      return eventDateKey === (tomorrowKey ?? addDaysToDateKey(todayKey, 1));
    }

    if (dateRange === 'week') {
      return eventDateKey >= todayKey && eventDateKey <= nextWeekKey;
    }

    return eventDateKey >= todayKey;
  });
}

function getDirectionsUrl(location: string): string | null {
  if (!location || ONLINE_LOCATION_RE.test(location)) {
    return null;
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

type CategoryStyle = {
  label: string;
  badge: string;
  border: string;
  accent: string;
  stripColor: string;  // CSS color for the left accent bar
  tintBg: string;      // Tailwind class for the subtle content-area wash
};

const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  Academic: {
    label: 'Academic',
    badge: 'bg-sky-50 text-sky-700',
    border: 'border-l-sky-400',
    accent: 'bg-sky-100 text-sky-800',
    stripColor: '#38bdf8',
    tintBg: 'bg-sky-50/30',
  },
  Arts: {
    label: 'Arts',
    badge: 'bg-amber-50 text-amber-700',
    border: 'border-l-amber-400',
    accent: 'bg-amber-100 text-amber-900',
    stripColor: '#fbbf24',
    tintBg: 'bg-amber-50/30',
  },
  Sports: {
    label: 'Sports',
    badge: 'bg-emerald-50 text-emerald-700',
    border: 'border-l-emerald-400',
    accent: 'bg-emerald-100 text-emerald-900',
    stripColor: '#34d399',
    tintBg: 'bg-emerald-50/30',
  },
  'Science & Tech': {
    label: 'Science & Tech',
    badge: 'bg-indigo-50 text-indigo-700',
    border: 'border-l-indigo-400',
    accent: 'bg-indigo-100 text-indigo-900',
    stripColor: '#818cf8',
    tintBg: 'bg-indigo-50/30',
  },
  'Student Life': {
    label: 'Student Life',
    badge: 'bg-rose-50 text-rose-700',
    border: 'border-l-rose-400',
    accent: 'bg-rose-100 text-rose-900',
    stripColor: '#fb7185',
    tintBg: 'bg-rose-50/30',
  },
  Entrepreneurship: {
    label: 'Entrepreneurship',
    badge: 'bg-violet-50 text-violet-700',
    border: 'border-l-violet-400',
    accent: 'bg-violet-100 text-violet-900',
    stripColor: '#a78bfa',
    tintBg: 'bg-violet-50/30',
  },
  Event: {
    label: 'Event',
    badge: 'bg-slate-50 text-slate-600',
    border: 'border-l-slate-300',
    accent: 'bg-slate-100 text-slate-800',
    stripColor: '#94a3b8',
    tintBg: 'bg-slate-50/20',
  },
};

function getCategoryStyle(tag?: string): CategoryStyle {
  if (!tag) {
    return CATEGORY_STYLES.Event;
  }

  const normalized = tag.toLowerCase();
  if (normalized.includes('art')) return CATEGORY_STYLES.Arts;
  if (normalized.includes('sport')) return CATEGORY_STYLES.Sports;
  if (normalized.includes('science') || normalized.includes('tech')) return CATEGORY_STYLES['Science & Tech'];
  if (normalized.includes('student')) return CATEGORY_STYLES['Student Life'];
  if (normalized.includes('entrepreneur')) return CATEGORY_STYLES.Entrepreneurship;
  if (normalized.includes('academic')) return CATEGORY_STYLES.Academic;

  return CATEGORY_STYLES[tag] || CATEGORY_STYLES.Event;
}

// Bottom Sheet Component (Mobile)
function BottomSheet({ event, onClose }: { event: CalEvent; onClose: () => void }) {
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [copied, setCopied] = useState(false);
  const categoryStyle = getCategoryStyle(event.tags?.[0]);
  const directionsUrl = getDirectionsUrl(event.location);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const titleId = useId();
  const prefersReducedMotion = usePrefersReducedMotion();

  const handleClose = useCallback(() => {
    setIsClosing((previous) => {
      if (previous) {
        return previous;
      }

      closeTimeoutRef.current = window.setTimeout(onClose, prefersReducedMotion ? 0 : 300);
      return true;
    });
  }, [onClose, prefersReducedMotion]);

  const [touchStartY, setTouchStartY] = useState(0);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  useDialogAccessibility({
    dialogRef,
    initialFocusRef: closeButtonRef,
    onClose: handleClose,
  });

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    setTouchStartY(e.touches[0].clientY);
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const deltaY = e.touches[0].clientY - touchStartY;
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
        aria-hidden="true"
        className={`absolute inset-0 bg-black/40 backdrop-blur-[3px] ${prefersReducedMotion ? '' : `transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'animate-fade-in'}`}`}
        onClick={handleClose}
      />
      {/* Sheet */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-hidden rounded-t-3xl bg-white shadow-2xl overscroll-contain ${prefersReducedMotion || isClosing ? '' : 'animate-slide-up'}`}
        style={{
          transform: isClosing ? 'translateY(100%)' : `translateY(${dragY}px)`,
          transition: isDragging || prefersReducedMotion ? 'none' : 'transform 0.4s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.3s ease-out',
        }}
      >
        {/* Drag Handle */}
        <div
          className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="w-10 h-1 bg-slate-300 rounded-full" />
        </div>

        {/* Content */}
        <div className="max-h-[calc(85vh-40px)] overflow-y-auto overscroll-contain px-5 pb-[max(2rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between mb-3">
            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${categoryStyle.badge}`}>
              {categoryStyle.label}
            </span>
            <div className="flex items-center gap-3">
              <SourceBadge source={event.source} />
              <button
                ref={closeButtonRef}
                type="button"
                onClick={handleClose}
                aria-label="Close event details"
                className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-berkeley-gold/60 focus-visible:ring-offset-2"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <h2 id={titleId} className="mb-4 text-xl font-semibold text-berkeley-blue md:font-serif">{event.title}</h2>

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
            <p className="text-gray-600 leading-relaxed whitespace-pre-wrap">{event.description}</p>
          </div>

          <div className="space-y-3">
            <div className="flex gap-2">
              {event.url && (
                <a
                  href={event.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 block py-3.5 bg-berkeley-blue text-white text-center font-bold rounded-xl tap-highlight select-none"
                  style={{ transition: 'transform 150ms cubic-bezier(0.32,0.72,0,1), opacity 150ms ease' }}
                  onClick={() => trackExternalLink({
                    event_id: event.id,
                    event_title: event.title,
                    destination_url: event.url,
                  })}
                >
                  View Official Page
                </a>
              )}
              <button
                type="button"
                className="flex items-center gap-1.5 px-4 py-3.5 border border-slate-200 text-slate-700 font-semibold rounded-xl tap-highlight active:bg-slate-50 select-none"
                style={{ transition: 'background-color 150ms ease' }}
                onClick={() => {
                  try {
                    navigator.clipboard.writeText(window.location.href);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  } catch { /* clipboard not available */ }
                }}
              >
                {copied ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-600" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                )}
                <span>{copied ? 'Copied!' : 'Copy link'}</span>
              </button>
            </div>
            {directionsUrl && (
              <a
                href={directionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full py-3.5 border border-slate-200 text-slate-700 text-center font-semibold rounded-xl tap-highlight active:bg-slate-50 select-none"
                style={{ transition: 'transform 150ms cubic-bezier(0.32,0.72,0,1), background-color 150ms ease' }}
                onClick={(e) => {
                  e.stopPropagation();
                  trackExternalLink({
                    event_id: event.id,
                    event_title: event.title,
                    destination_url: directionsUrl,
                  });
                }}
              >
                Map & Directions
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Slide-out Panel Component (Desktop)
function SlideOutPanel({ event, onClose }: { event: CalEvent; onClose: () => void }) {
  const [isClosing, setIsClosing] = useState(false);
  const [copied, setCopied] = useState(false);
  const categoryStyle = getCategoryStyle(event.tags?.[0]);
  const directionsUrl = getDirectionsUrl(event.location);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const titleId = useId();
  const prefersReducedMotion = usePrefersReducedMotion();

  const handleClose = useCallback(() => {
    setIsClosing((previous) => {
      if (previous) {
        return previous;
      }

      closeTimeoutRef.current = window.setTimeout(onClose, prefersReducedMotion ? 0 : 350);
      return true;
    });
  }, [onClose, prefersReducedMotion]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  useDialogAccessibility({
    dialogRef,
    initialFocusRef: closeButtonRef,
    onClose: handleClose,
  });

  return (
    <div className="fixed inset-0 z-50 hidden md:block">
      {/* Backdrop */}
      <div
        aria-hidden="true"
        className={`absolute inset-0 bg-black/40 backdrop-blur-sm ${prefersReducedMotion ? '' : `transition-opacity duration-300 ${isClosing ? 'opacity-0' : 'animate-fade-in'}`}`}
        onClick={handleClose}
      />
      {/* Panel */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`absolute top-0 right-0 h-full w-[min(450px,90vw)] overflow-hidden bg-white shadow-2xl overscroll-contain ${prefersReducedMotion || isClosing ? '' : 'animate-slide-in'}`}
        style={{
          boxShadow: '-10px 0 40px rgba(0,0,0,0.15)',
          transform: isClosing ? 'translateX(100%)' : 'translateX(0)',
          transition: prefersReducedMotion ? 'none' : 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-berkeley-blue text-white">
          <span className="font-bold">Event Details</span>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={handleClose}
            aria-label="Close event details"
            className="p-1 hover:bg-white/20 rounded transition"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="h-[calc(100%-60px)] overflow-y-auto overscroll-contain p-6">
          <div className="flex items-center justify-between mb-3">
            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${categoryStyle.badge}`}>
              {categoryStyle.label}
            </span>
            <SourceBadge source={event.source} />
          </div>

          <h2 id={titleId} className="mb-6 text-2xl font-semibold text-berkeley-blue md:font-serif">{event.title}</h2>

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
            <p className="text-gray-600 leading-relaxed whitespace-pre-wrap">{event.description}</p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {event.url && (
              <a
                href={event.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full py-3.5 bg-berkeley-blue text-white text-center font-bold rounded-xl tap-highlight select-none"
                style={{ transition: 'transform 150ms cubic-bezier(0.32,0.72,0,1), opacity 150ms ease' }}
                onClick={() => trackExternalLink({
                  event_id: event.id,
                  event_title: event.title,
                  destination_url: event.url,
                })}
              >
                View Official Page
              </a>
            )}
            <button
              type="button"
              className="flex items-center justify-center gap-1.5 w-full py-3.5 border border-slate-200 text-slate-700 font-semibold rounded-xl tap-highlight active:bg-slate-50 select-none"
              style={{ transition: 'background-color 150ms ease' }}
              onClick={() => {
                try {
                  navigator.clipboard.writeText(window.location.href);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch { /* clipboard not available */ }
              }}
            >
              {copied ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-600" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
              )}
              <span>{copied ? 'Copied!' : 'Copy link'}</span>
            </button>
            {directionsUrl && (
              <a
                href={directionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full py-3.5 border border-slate-200 text-slate-700 text-center font-semibold rounded-xl tap-highlight active:bg-slate-50 select-none"
                style={{ transition: 'transform 150ms cubic-bezier(0.32,0.72,0,1), background-color 150ms ease' }}
                onClick={(e) => {
                  e.stopPropagation();
                  trackExternalLink({
                    event_id: event.id,
                    event_title: event.title,
                    destination_url: directionsUrl,
                  });
                }}
              >
                Map & Directions
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

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

const Categories = ['All', 'Academic', 'Arts', 'Sports', 'Science & Tech', 'Student Life', 'Entrepreneurship'];
const ALL_SOURCES = ['All', 'livewhale', 'ehub', 'gemini', 'cal_performances', 'bampfa', 'calbears', 'callink', 'haas', 'berkeley_law', 'simons'];
const DateRanges = [
  { label: 'Today', value: 'today' },
  { label: 'This Week', value: 'week' },
  { label: 'All Events', value: 'upcoming' },
];

const DEFAULT_FILTERS: SearchFilters = {
  dateRange: 'today',
  category: 'All',
  searchQuery: '',
  source: 'All',
};

const VISIBLE_EVENT_BATCH_SIZE = 72;

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ));

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    setPrefersReducedMotion(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  return prefersReducedMotion;
}

function readAppUrlState() {
  return parseUrlState(typeof window !== 'undefined' ? window.location.search : '', {
    defaultFilters: DEFAULT_FILTERS,
    allowedCategories: Categories,
    allowedSources: ALL_SOURCES,
  });
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(element => {
    if (element.hasAttribute('disabled')) return false;
    if (element.getAttribute('aria-hidden') === 'true') return false;
    return true;
  });
}

function useDialogAccessibility({
  dialogRef,
  initialFocusRef,
  onClose,
}: {
  dialogRef: React.RefObject<HTMLElement | null>;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    previousActiveElementRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const { body, documentElement } = document;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth;

    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    const focusInitialTarget = () => {
      const focusable = getFocusableElements(dialog);
      const fallbackTarget = initialFocusRef?.current ?? focusable[0] ?? dialog;
      fallbackTarget.focus();
    };

    const frameId = window.requestAnimationFrame(focusInitialTarget);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

      if (event.shiftKey) {
        if (!activeElement || activeElement === first || activeElement === dialog) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) {
        const focusable = getFocusableElements(dialog);
        (focusable[0] ?? dialog).focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocusIn);

    return () => {
      window.cancelAnimationFrame(frameId);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocusIn);
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
      previousActiveElementRef.current?.focus();
    };
  }, [dialogRef, initialFocusRef, onClose]);
}

interface QuickFilterPreset {
  label: string;
  dateRange: SearchFilters['dateRange'];
  category: string;
  searchQuery: string;
}

const DESKTOP_HERO_PRESETS: QuickFilterPreset[] = [
  { label: 'Tonight', dateRange: 'today', category: 'All', searchQuery: '' },
  { label: 'AI talks', dateRange: 'week', category: 'Science & Tech', searchQuery: 'ai' },
  { label: 'Cal games', dateRange: 'week', category: 'Sports', searchQuery: '' },
  { label: 'This week', dateRange: 'week', category: 'All', searchQuery: '' },
];

const POPULAR_SEARCHES = [
  'AI', 'Film screening', 'Career fair',
  'Hackathon', 'Speaker', 'Workshop', 'Wellness',
];

function SearchSuggestionsDropdown({
  recents,
  onSelect,
  onClear,
}: {
  recents: string[];
  onSelect: (q: string) => void;
  onClear: () => void;
}) {
  const handleSuggestionSelect = (query: string) => {
    onSelect(query);
  };

  return (
    <div className="absolute top-full left-0 right-0 z-[60] mt-1.5 rounded-2xl border border-slate-200 bg-white shadow-2xl animate-dropdown-in overflow-hidden" style={{ transformOrigin: 'top center', maxHeight: 'min(320px, 40vh)' }}>
      <div className="overflow-y-auto no-scrollbar h-full">
        {recents.length > 0 && (
          <div className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Recent</span>
              <button
                type="button"
                onClick={onClear}
                className="text-[11px] text-slate-400 tap-highlight hover:text-slate-600 active:text-slate-800"
              >
                Clear
              </button>
            </div>
            {recents.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => handleSuggestionSelect(s)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm text-slate-700 tap-highlight hover:bg-slate-50 active:bg-slate-100"
              >
                <svg className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {s}
              </button>
            ))}
          </div>
        )}
        <div className={`p-3 ${recents.length > 0 ? 'border-t border-slate-100' : ''}`}>
          <span className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Popular</span>
          <div className="flex flex-wrap gap-1.5">
            {POPULAR_SEARCHES.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => handleSuggestionSelect(s)}
                className="rounded-full border border-berkeley-gold/30 bg-berkeley-gold/10 px-3 py-1 text-xs text-berkeley-blue tap-highlight hover:bg-berkeley-gold/20 active:bg-berkeley-gold/30 select-none"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const CAL_PHRASES: Array<{ plain: string; gold: string }> = [
  { plain: 'Go Bears.', gold: "What's the move?" },
  { plain: 'Oski says', gold: "something's happening." },
  { plain: 'Bear territory.', gold: 'What are you into?' },
  { plain: "It's a good day", gold: 'to be a Bear.' },
];

function DesktopHero({
  lastUpdated,
  totalEvents,
  sourceCount,
  loading,
  searchQuery,
  onSearchChange,
  onPresetSelect,
  inputId,
}: {
  lastUpdated: number | null;
  totalEvents: number;
  sourceCount: number;
  loading: LoadingState;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onPresetSelect: (preset: QuickFilterPreset) => void;
  inputId: string;
}) {
  const [phraseIdx] = useState(() => Math.floor(Math.random() * CAL_PHRASES.length));
  const phrase = CAL_PHRASES[phraseIdx];
  const [searchFocused, setSearchFocused] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFocus = () => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    setRecents(getRecentSearches());
    setSearchFocused(true);
  };
  const handleBlur = () => {
    blurTimerRef.current = setTimeout(() => setSearchFocused(false), 150);
  };
  const handleSelectSuggestion = (q: string) => {
    onSearchChange(q);
    addRecentSearch(q);
    setRecents(getRecentSearches());
    setSearchFocused(false);
  };

  const statusCopy = lastUpdated
    ? `Synced ${formatPacificDateTime(lastUpdated)}`
    : loading === LoadingState.ERROR
      ? 'Latest batch unavailable'
      : 'Loading latest batch';

  const summaryCopy = loading === LoadingState.SUCCESS && totalEvents > 0
    ? `${totalEvents.toLocaleString()} events across ${sourceCount} campus feeds. Search by topic, speaker, venue, or organizer.`
    : 'Search Berkeley events by topic, speaker, venue, or organizer, then refine with filters below.';

  return (
    <header
      className="hidden md:block text-white border-b-4 border-[#FDB515] shadow-md relative"
      style={{ background: 'linear-gradient(165deg, #003262 0%, #00233F 100%)' }}
    >
      {/* Decorative glow blobs — clipped to header bounds via their own overflow-hidden wrapper */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -top-16 -right-16 w-[440px] h-[440px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(253,181,21,0.38) 0%, transparent 60%)', mixBlendMode: 'screen' }}
        />
        <div
          className="absolute -bottom-16 -left-16 w-[320px] h-[320px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(253,181,21,0.18) 0%, transparent 60%)', mixBlendMode: 'screen' }}
        />
      </div>
      <div className="container mx-auto px-6 py-8 lg:py-9 relative z-10">
        <div className="flex items-center justify-between gap-6 mb-6">
          <div className="flex items-baseline gap-2">
            <span className="text-berkeley-gold text-2xl font-bold tracking-tight">Cal</span>
            <span className="text-2xl font-light tracking-wide">Events</span>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs text-berkeley-gold/90">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.18)]" />
            {statusCopy}
          </div>
        </div>

        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-4xl lg:text-[3.35rem] font-semibold leading-tight font-serif" style={{ textWrap: 'balance', letterSpacing: '-0.02em' }}>
            {phrase.plain}&nbsp;
            <span className="text-berkeley-gold italic font-medium" style={{ textShadow: '0 0 40px rgba(253,181,21,0.35)' }}>{phrase.gold}</span>
          </h1>
          <p className="mt-3 text-[15px] leading-7 text-white/72">
            {summaryCopy}
          </p>

          <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-white p-4" style={{ boxShadow: '0 2px 4px rgba(0,50,98,0.08), 0 12px 40px rgba(0,50,98,0.18), 0 0 0 1px rgba(253,181,21,0.12)' }}>
            <div className="relative">
              <label htmlFor={inputId} className="sr-only">
                Search campus events
              </label>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                id={inputId}
                type="text"
                name="event-search"
                aria-label="Search campus events"
                autoComplete="off"
                placeholder="Search events, speakers, topics, or venues…"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-4 pl-12 pr-5 text-base text-slate-900 outline-none transition focus:border-berkeley-medblue focus:bg-white focus:ring-2 focus:ring-berkeley-gold/50"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && searchQuery.trim()) {
                    const trimmed = searchQuery.trim();
                    onSearchChange(trimmed);
                    addRecentSearch(trimmed);
                    setSearchFocused(false);
                  }
                }}
              />
              {searchFocused && (
                <SearchSuggestionsDropdown
                  recents={recents}
                  onSelect={handleSelectSuggestion}
                  onClear={() => { clearRecentSearches(); setRecents([]); }}
                />
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-center gap-3 border-t border-slate-100 pt-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                Quick Start
              </span>
              {DESKTOP_HERO_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => onPresetSelect(preset)}
                  className="rounded-full border border-[rgba(253,181,21,0.5)] bg-[rgba(253,181,21,0.08)] px-4 py-2 text-sm font-medium text-[#003262] transition hover:border-[#FDB515] hover:bg-[rgba(253,181,21,0.18)]"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function DesktopFiltersBar({
  filters,
  activeDateRange,
  sourceOptions,
  onDateChange,
  onCategoryChange,
  onSourceChange,
}: {
  filters: SearchFilters;
  activeDateRange: SearchFilters['dateRange'];
  sourceOptions: SourceOption[];
  onDateChange: (next: SearchFilters['dateRange']) => void;
  onCategoryChange: (next: string) => void;
  onSourceChange: (next: string) => void;
}) {
  return (
    <div className="bg-white/90 backdrop-blur-md" style={{ boxShadow: '0 1px 0 rgba(253,181,21,0.22)' }}>
      <div className="container mx-auto px-4 py-3 flex items-center gap-3 overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 scrollbar-track-transparent whitespace-nowrap">
        <div className="flex flex-shrink-0 items-center gap-1 rounded-full bg-slate-100 p-1 shadow-inner">
          {DateRanges.map(range => {
            const active = activeDateRange === range.value;
            return (
              <button
                key={range.value}
                onClick={() => onDateChange(range.value as SearchFilters['dateRange'])}
                className={`px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? 'text-berkeley-blue border-b-2 border-[#FDB515] rounded-none bg-transparent'
                    : 'rounded-full text-slate-600 hover:bg-white hover:text-berkeley-blue'
                }`}
              >
                {range.label}
              </button>
            );
          })}
        </div>

        <div className="hidden h-6 w-px flex-shrink-0 bg-slate-200 lg:block" />

        <div className="flex items-center gap-2 flex-shrink-0">
          {Categories.map(cat => (
            <button
              key={cat}
              onClick={() => onCategoryChange(cat)}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                filters.category === cat
                  ? 'border-berkeley-blue bg-berkeley-blue text-white shadow-sm'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="hidden h-6 w-px flex-shrink-0 bg-slate-200 lg:block" />

        <div className="flex flex-shrink-0 items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Source</span>
          <SourceDropdown
            value={filters.source}
            options={sourceOptions}
            onChange={onSourceChange}
            tone="light"
          />
        </div>
      </div>
    </div>
  );
}

function MobileFiltersBar({
  filters,
  activeDateRange,
  sourceOptions,
  onDateChange,
  onCategoryChange,
  onSourceChange,
}: {
  filters: SearchFilters;
  activeDateRange: SearchFilters['dateRange'];
  sourceOptions: SourceOption[];
  onDateChange: (next: SearchFilters['dateRange']) => void;
  onCategoryChange: (next: string) => void;
  onSourceChange: (next: string) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const activeFilterCount = Number(filters.category !== 'All') + Number(filters.source !== 'All');

  useEffect(() => {
    setAdvancedOpen(false);
  }, [filters.dateRange]);

  const selectedSource = sourceOptions.find(option => option.value === filters.source)?.label || 'All sources';

  return (
    <div className="bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-sm">
      <div className="container mx-auto px-4 py-2.5 flex items-center gap-2 overflow-x-auto no-scrollbar whitespace-nowrap">
        {DateRanges.map(range => {
          const active = activeDateRange === range.value;
          return (
            <button
              key={range.value}
              onClick={() => onDateChange(range.value as SearchFilters['dateRange'])}
              className={`rounded-full px-4 py-2 text-sm font-semibold tap-highlight select-none ${
                active
                  ? 'bg-berkeley-blue text-white shadow-[0_2px_10px_rgba(0,50,98,0.25)]'
                  : 'bg-slate-100 text-slate-600 active:bg-slate-200'
              }`}
            >
              {range.label}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setAdvancedOpen(open => !open)}
          className={`ml-auto inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold tap-highlight select-none ${
            advancedOpen || activeFilterCount > 0
              ? 'border-berkeley-blue bg-berkeley-blue text-white shadow-[0_2px_10px_rgba(0,50,98,0.25)]'
              : 'border-slate-200 bg-white text-slate-700 active:bg-slate-50'
          }`}
        >
          Filters
          {activeFilterCount > 0 && (
            <span className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] ${advancedOpen ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700'}`}>
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {advancedOpen && (
        <div className="border-t border-slate-200/80 bg-white animate-panel-in">
          <div className="container mx-auto px-4 py-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Filters</p>
                <p className="mt-1 text-sm text-slate-600">
                  Category: <span className="font-medium text-slate-800">{filters.category}</span>
                  <span className="mx-2 text-slate-300">•</span>
                  Source: <span className="font-medium text-slate-800">{selectedSource}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAdvancedOpen(false)}
                className="text-sm font-semibold text-berkeley-blue tap-highlight px-3 py-1.5 rounded-full active:bg-slate-100 select-none"
              >
                Done
              </button>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Category</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {Categories.map(cat => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => onCategoryChange(cat)}
                    className={`rounded-full border px-3 py-1.5 text-sm tap-highlight select-none ${
                      filters.category === cat
                        ? 'border-berkeley-blue bg-berkeley-blue text-white shadow-[0_2px_8px_rgba(0,50,98,0.2)]'
                        : 'border-slate-200 bg-white text-slate-600 active:bg-slate-50'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Source</p>
              <div className="mt-2">
                <SourceDropdown
                  value={filters.source}
                  options={sourceOptions}
                  onChange={onSourceChange}
                  tone="light"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface EmptyStateConfig {
  title: string;
  description: string;
  primaryLabel: string;
  primaryAction: () => void;
  secondaryLabel?: string;
  secondaryAction?: () => void;
}

export default function App() {
  const initialUrlState = readAppUrlState();
  const [allEvents, setAllEvents] = useState<CalEvent[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [loading, setLoading] = useState<LoadingState>(LoadingState.IDLE);
  const [statusReport, setStatusReport] = useState<IngestionStatus | null>(null);
  const [searchIndex, setSearchIndex] = useState<SearchIndex | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const [filters, setFilters] = useState<SearchFilters>(initialUrlState.filters);
  const [selectedEvent, setSelectedEvent] = useState<CalEvent | null>(null);
  const [shouldAnimateCards, setShouldAnimateCards] = useState(!prefersReducedMotion);
  // Mobile search suggestions
  const [mobileSearchFocused, setMobileSearchFocused] = useState(false);
  const [mobileRecents, setMobileRecents] = useState<string[]>([]);
  const mobileBlurRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dismissedInterpretationKeys, setDismissedInterpretationKeys] = useState<Set<string>>(new Set());
  const desktopSearchInputId = useId();
  const mobileSearchInputId = useId();
  const isMobile = useIsMobile();
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingSelectedEventId, setPendingSelectedEventId] = useState<string | null>(initialUrlState.selectedEventId);
  const historyModeRef = useRef<'push' | 'replace'>('replace');
  const isApplyingHistoryRef = useRef(false);
  const userSetDateRangeRef = useRef<boolean>(false);
  const [visibleEventCount, setVisibleEventCount] = useState(VISIBLE_EVENT_BATCH_SIZE);
  const [showBackToTop, setShowBackToTop] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 800);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleEventClick = useCallback((event: CalEvent) => {
    setSelectedEvent(event);
    // Persist the search term that led to this click
    setFilters(prev => {
      if (prev.searchQuery.trim()) addRecentSearch(prev.searchQuery.trim());
      return prev;
    });
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

  const loadEvents = useCallback(async () => {
    setLoading(LoadingState.LOADING);
    setStatusReport(null);
    try {
      const results = await Promise.all([
        fetchEventsFromGemini(),
        fetch('/search-index.json')
          .then(r => r.ok ? r.json() : null)
          .then((idx: SearchIndex | null) => { if (idx) setSearchIndex(idx); })
          .catch(() => { /* index not yet generated — fall back to Fuse-only */ }),
      ]).catch((err: unknown) => {
        console.error(err);
        setLoading(LoadingState.ERROR);
        return null;
      });
      if (!results) return;
      const [data] = results;
      setAllEvents(data.events);
      setLastUpdated(data.lastUpdated);
      setStatusReport(data.status || null);
      setLoading(LoadingState.SUCCESS);
    } catch (error) {
      console.error(error);
      setLoading(LoadingState.ERROR);
    }
  }, []);

  useEffect(() => {
    // Initialize GA4 and track page view
    // Vercel Analytics is initialized via the <Analytics /> component wrapper
    initGA();
    trackPageView({ page_path: '/', page_title: 'CalEvents - UC Berkeley Events' });
    loadEvents();
  }, []);

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
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
  const sourceCount = Math.max(sourceOptions.length - 1, 0);

  const [bannerDismissed, setBannerDismissed] = useState(() =>
    typeof sessionStorage !== 'undefined' && sessionStorage.getItem('statusBannerDismissed') === '1'
  );
  const dismissBanner = () => {
    setBannerDismissed(true);
    sessionStorage.setItem('statusBannerDismissed', '1');
  };

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

  const [dateKeys, setDateKeys] = useState(() => {
    const today = getCurrentPacificDateKey();
    return { todayKey: today, tomorrowKey: addDaysToDateKey(today, 1), nextWeekKey: addDaysToDateKey(today, 7) };
  });
  const { todayKey, tomorrowKey, nextWeekKey } = dateKeys;

  useEffect(() => {
    const id = setInterval(() => {
      const today = getCurrentPacificDateKey();
      setDateKeys({ todayKey: today, tomorrowKey: addDaysToDateKey(today, 1), nextWeekKey: addDaysToDateKey(today, 7) });
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // Active search plan — derived from query, used for chips + scoring.
  const activePlan = useMemo(() => {
    const q = filters.searchQuery.trim();
    if (q.length < 2) return null;
    return buildSearchPlan(q);
  }, [filters.searchQuery]);

  // Chips to display: interpretations minus dismissed ones.
  const activeChips = useMemo<InterpretedChip[]>(() => {
    if (!activePlan) return [];
    return activePlan.interpretations.filter(i => !dismissedInterpretationKeys.has(i.key));
  }, [activePlan, dismissedInterpretationKeys]);

  // Instant local filtering — category + source + home-game, then ranked search.
  // Returns the full SearchOutput so fallbackMessage is strongly typed.
  const searchOutput = useMemo(() => {
    const q = filters.searchQuery.trim();

    const pool = allEvents.filter(event => {
      const eventDateKey = getPacificDateKey(event.date);
      if (!eventDateKey) return false;

      const matchesCategory = filters.category === 'All' ||
        event.tags?.some(t => t.toLowerCase().includes(filters.category.toLowerCase())) ||
        event.tags?.includes(filters.category);

      const matchesSource = filters.source === 'All' || event.source === filters.source;
      return matchesCategory && matchesSource;
    });

    if (!q) {
      const sorted = [...pool].sort((a, b) => {
        const dateCompare = (getPacificDateKey(a.date) || '').localeCompare(getPacificDateKey(b.date) || '');
        if (dateCompare !== 0) return dateCompare;
        return (a.time || '').localeCompare(b.time || '') || a.title.localeCompare(b.title);
      });
      return { results: sorted, fallbackUsed: false, fallbackMessage: undefined };
    }

    const { results, fallbackUsed, fallbackMessage } = searchEvents(pool, q, searchIndex, dismissedInterpretationKeys);
    return { results, fallbackUsed, fallbackMessage: fallbackUsed ? fallbackMessage : undefined };
  }, [allEvents, filters.category, filters.searchQuery, filters.source, searchIndex, dismissedInterpretationKeys]);

  const baseFilteredEvents = searchOutput.results;
  const searchFallbackMessage: string | undefined = searchOutput.fallbackMessage;

  const todayEvents = useMemo(
    () => filterEventsByDateRange(baseFilteredEvents, 'today', todayKey, nextWeekKey),
    [baseFilteredEvents, todayKey, nextWeekKey],
  );

  const tomorrowEvents = useMemo(
    () => filterEventsByDateRange(baseFilteredEvents, 'tomorrow', todayKey, nextWeekKey, tomorrowKey),
    [baseFilteredEvents, todayKey, nextWeekKey, tomorrowKey],
  );

  const weekEvents = useMemo(
    () => filterEventsByDateRange(baseFilteredEvents, 'week', todayKey, nextWeekKey),
    [baseFilteredEvents, todayKey, nextWeekKey],
  );

  const upcomingEvents = useMemo(
    () => filterEventsByDateRange(baseFilteredEvents, 'upcoming', todayKey, nextWeekKey),
    [baseFilteredEvents, todayKey, nextWeekKey],
  );

  const derivedDateRange = useMemo<SearchFilters['dateRange']>(() => {
    // User's explicit filter-bar click always wins
    if (userSetDateRangeRef.current) return filters.dateRange;
    // Otherwise let query interpretation guide the date
    if (activePlan?.filters.dateRange && !dismissedInterpretationKeys.has(`dateRange:${activePlan.filters.dateRange}`)) {
      return activePlan.filters.dateRange;
    }
    return filters.dateRange;
  }, [filters.dateRange, activePlan, dismissedInterpretationKeys]);

  const effectiveDateRange = useMemo<SearchFilters['dateRange']>(() => {
    if (derivedDateRange === 'today' && todayEvents.length === 0 && weekEvents.length > 0) {
      return 'week';
    }
    if (derivedDateRange === 'tomorrow' && tomorrowEvents.length === 0 && weekEvents.length > 0) {
      return 'week';
    }
    return derivedDateRange;
  }, [derivedDateRange, todayEvents.length, tomorrowEvents.length, weekEvents.length]);

  const filteredEvents = useMemo(() => {
    if (effectiveDateRange === 'today') return todayEvents;
    if (effectiveDateRange === 'tomorrow') return tomorrowEvents;
    if (effectiveDateRange === 'week') return weekEvents;
    return upcomingEvents;
  }, [effectiveDateRange, todayEvents, weekEvents, upcomingEvents]);

  const showingTodayFallback = derivedDateRange === 'today' && effectiveDateRange === 'week' && weekEvents.length > 0;

  const emptyState = useMemo<EmptyStateConfig>(() => {
    const q = filters.searchQuery.trim();
    const hasSearch = !!q;
    const hasCategory = filters.category !== 'All';

    const resetAll = () => setFilters(DEFAULT_FILTERS);
    const clearSearch = () => setFilters(prev => ({ ...prev, searchQuery: '' }));
    const clearCategory = () => setFilters(prev => ({ ...prev, category: DEFAULT_FILTERS.category }));
    const showWeek = () => setFilters(prev => ({ ...prev, dateRange: 'week' }));
    const showUpcoming = () => setFilters(prev => ({ ...prev, dateRange: 'upcoming' }));

    if (hasSearch && upcomingEvents.length > 0) {
      const dateLabel = effectiveDateRange === 'today' ? 'today' : 'this week';
      return {
        title: `No “${q}” events ${dateLabel}.`,
        description: `${upcomingEvents.length} match${upcomingEvents.length !== 1 ? 'es' : ''} found in the coming weeks — broaden your date range to see them.`,
        primaryLabel: effectiveDateRange !== 'upcoming' ? 'See all upcoming' : 'Clear search',
        primaryAction: effectiveDateRange !== 'upcoming' ? showUpcoming : clearSearch,
        secondaryLabel: 'Clear search',
        secondaryAction: clearSearch,
      };
    }

    if (hasSearch && hasCategory) {
      return {
        title: `No “${q}” in ${filters.category}.`,
        description: `Try removing the ${filters.category} filter — there may be matches across other categories.`,
        primaryLabel: `Clear “${filters.category}”`,
        primaryAction: clearCategory,
        secondaryLabel: 'Clear search',
        secondaryAction: clearSearch,
      };
    }

    if (hasSearch) {
      return {
        title: `No results for “${q}”.`,
        description: 'Try a different search term or browse upcoming events.',
        primaryLabel: 'Clear search',
        primaryAction: clearSearch,
        secondaryLabel: 'Show all upcoming',
        secondaryAction: resetAll,
      };
    }

    if (derivedDateRange === 'today' && weekEvents.length > 0) {
      return {
        title: 'Nothing on today.',
        description: `${weekEvents.length} event${weekEvents.length !== 1 ? 's' : ''} coming up this week though.`,
        primaryLabel: 'Show This Week',
        primaryAction: showWeek,
        secondaryLabel: 'Show Upcoming',
        secondaryAction: showUpcoming,
      };
    }

    if (derivedDateRange === 'week' && upcomingEvents.length > weekEvents.length) {
      const upcomingBeyondWeek = upcomingEvents.length - weekEvents.length;
      return {
        title: 'Nothing is scheduled this week.',
        description: `${upcomingBeyondWeek} more upcoming event${upcomingBeyondWeek !== 1 ? 's are' : ' is'} already on the calendar.`,
        primaryLabel: 'Show Upcoming',
        primaryAction: showUpcoming,
        secondaryLabel: 'Clear all filters',
        secondaryAction: resetAll,
      };
    }

    if (filters.category !== 'All' || filters.source !== 'All') {
      return {
        title: 'No events match these filters.',
        description: 'Try a different category or source, or clear the filters to see the full campus feed.',
        primaryLabel: 'Clear all filters',
        primaryAction: resetAll,
      };
    }

    return {
      title: 'No events match these filters.',
      description: 'Try broadening the date range or clearing the active search.',
      primaryLabel: 'Clear all filters',
      primaryAction: resetAll,
      secondaryLabel: derivedDateRange !== 'upcoming' ? 'Show Upcoming' : undefined,
      secondaryAction: derivedDateRange !== 'upcoming' ? showUpcoming : undefined,
    };
  }, [filters, upcomingEvents.length, weekEvents.length, effectiveDateRange, derivedDateRange]);

  // Group sorted filtered events by Pacific date key
  const visibleEvents = useMemo(
    () => filteredEvents.slice(0, visibleEventCount),
    [filteredEvents, visibleEventCount],
  );

  const hiddenEventCount = Math.max(filteredEvents.length - visibleEvents.length, 0);

  const eventGroups = useMemo(() => {
    const groups: { dateKey: string; label: string; events: CalEvent[] }[] = [];
    for (const event of visibleEvents) {
      const dateKey = getPacificDateKey(event.date);
      const last = groups[groups.length - 1];
      if (last && last.dateKey === dateKey) {
        last.events.push(event);
      } else {
        groups.push({ dateKey, label: dateGroupLabel(dateKey), events: [event] });
      }
    }
    return groups;
  }, [visibleEvents]);

  useEffect(() => {
    if (loading === LoadingState.SUCCESS && filteredEvents.length > 0 && shouldAnimateCards) {
      const timeout = window.setTimeout(() => setShouldAnimateCards(false), 1100);
      return () => window.clearTimeout(timeout);
    }
  }, [loading, filteredEvents.length, shouldAnimateCards]);

  useEffect(() => {
    setVisibleEventCount(VISIBLE_EVENT_BATCH_SIZE);
    setShouldAnimateCards(!prefersReducedMotion);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [filters, effectiveDateRange, prefersReducedMotion]);

  const selectedEventId = selectedEvent?.id ?? null;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const nextSearch = buildUrlStateSearch(filters, selectedEventId, {
      defaultFilters: DEFAULT_FILTERS,
    });
    const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (nextUrl !== currentUrl) {
      const historyMethod = isApplyingHistoryRef.current
        ? 'replaceState'
        : historyModeRef.current === 'push'
          ? 'pushState'
          : 'replaceState';
      window.history[historyMethod](null, '', nextUrl);
    }

    historyModeRef.current = 'replace';
    isApplyingHistoryRef.current = false;
  }, [filters, selectedEventId]);

  useEffect(() => {
    if (!pendingSelectedEventId) return;

    const matchedEvent = allEvents.find(event => event.id === pendingSelectedEventId);
    if (matchedEvent) {
      setSelectedEvent(matchedEvent);
    }
  }, [allEvents, pendingSelectedEventId]);

  useEffect(() => {
    if (!selectedEventId) return;

    const stillExists = allEvents.some(event => event.id === selectedEventId);
    if (!stillExists) {
      setSelectedEvent(null);
    }
  }, [allEvents, selectedEventId]);

  useEffect(() => {
    if (selectedEventId && !filteredEvents.some(event => event.id === selectedEventId)) {
      setSelectedEvent(null);
    }
  }, [filteredEvents, selectedEventId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePopState = () => {
      isApplyingHistoryRef.current = true;
      const nextState = parseUrlState(window.location.search, {
        defaultFilters: DEFAULT_FILTERS,
        allowedCategories: Categories,
        allowedSources: ALL_SOURCES,
      });

      setFilters(nextState.filters);
      setPendingSelectedEventId(nextState.selectedEventId);

      if (!nextState.selectedEventId) {
        setSelectedEvent(null);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const prevSearchQueryRef = useRef<string>(filters.searchQuery);

  const handleSearchChange = useCallback((query: string) => {
    historyModeRef.current = 'replace';
    setFilters(prev => ({ ...prev, searchQuery: query }));
    // Reset dismissed chips when the first word changes (different search intent),
    // and also reset the explicit date-range flag when the query is cleared.
    const prevFirstWord = prevSearchQueryRef.current.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    const nextFirstWord = query.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    if (prevFirstWord !== nextFirstWord) {
      setDismissedInterpretationKeys(new Set());
    }
    if (query.length === 0) {
      userSetDateRangeRef.current = false;
    }
    prevSearchQueryRef.current = query;

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (query.trim().length >= 2) {
      searchTimeoutRef.current = setTimeout(() => {
        trackSearch({ search_term: query.trim(), results_count: filteredEvents.length });
      }, 500);
    }
  }, [filteredEvents.length]);

  const handleDismissChip = useCallback((key: string) => {
    setDismissedInterpretationKeys(prev => new Set([...prev, key]));
  }, [activeChips, activePlan]);

  const handleDateRangeChange = useCallback((dateRange: SearchFilters['dateRange']) => {
    historyModeRef.current = 'push';
    userSetDateRangeRef.current = true;
    setFilters(prev => ({ ...prev, dateRange }));
    trackDateFilter(dateRange);
  }, []);

  const handleCategoryChange = useCallback((category: string) => {
    historyModeRef.current = 'push';
    setFilters(prev => ({ ...prev, category }));
    trackCategoryFilter(category);
  }, []);

  const handleSourceChange = useCallback((source: string) => {
    historyModeRef.current = 'push';
    setFilters(prev => ({ ...prev, source }));
    trackFilter({ filter_type: 'source', filter_value: source });
  }, []);

  const handleQuickPreset = useCallback((preset: QuickFilterPreset) => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    historyModeRef.current = 'push';
    setFilters(prev => ({
      ...prev,
      dateRange: preset.dateRange,
      category: preset.category,
      searchQuery: preset.searchQuery,
    }));

    trackDateFilter(preset.dateRange);
    if (preset.category !== 'All') {
      trackCategoryFilter(preset.category);
    }
  }, []);

  return (
    <div className="min-h-screen bg-berkeley-lightgray text-gray-800 font-sans">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-berkeley-blue focus:text-white focus:rounded-md focus:text-sm focus:font-medium"
      >
        Skip to events
      </a>
      <Analytics />
      {isMobile ? (
        <>
          <header className="bg-berkeley-blue text-white" style={{ boxShadow: '0 4px 24px rgba(0,50,98,0.18)' }}>
            <div className="container mx-auto px-4 pt-4 pb-3 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-berkeley-gold text-2xl font-bold tracking-tight">Cal</span>
                  <span className="text-2xl font-light tracking-wide">Events</span>
                </div>
                {lastUpdated && (
                  <span className="text-[10px] text-berkeley-gold/70 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                    {formatPacificDateTime(lastUpdated)}
                  </span>
                )}
              </div>

              <div
                className="relative"
                style={{
                  transition: 'transform 200ms cubic-bezier(0.32, 0.72, 0, 1)',
                  transform: mobileSearchFocused ? 'scale(1.012)' : 'scale(1)',
                }}
              >
                <label htmlFor={mobileSearchInputId} className="sr-only">
                  Search campus events
                </label>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2"
                  style={{
                    color: mobileSearchFocused ? '#FDB515' : '#94a3b8',
                    transition: 'color 200ms ease',
                  }}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  id={mobileSearchInputId}
                  type="text"
                  name="event-search-mobile"
                  aria-label="Search campus events"
                  autoComplete="off"
                  placeholder="Search events, speakers, topics, or venues…"
                  className="w-full rounded-2xl bg-white py-3 pl-11 pr-11 text-base text-slate-900 outline-none"
                  style={{
                    border: mobileSearchFocused ? '2px solid #FDB515' : '2px solid rgba(255,255,255,0.12)',
                    boxShadow: mobileSearchFocused ? '0 0 0 4px rgba(253,181,21,0.18)' : 'none',
                    transition: 'border-color 200ms ease, box-shadow 200ms ease',
                  }}
                  value={filters.searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  onFocus={() => {
                    if (mobileBlurRef.current) clearTimeout(mobileBlurRef.current);
                    setMobileRecents(getRecentSearches());
                    setMobileSearchFocused(true);
                  }}
                  onBlur={() => {
                    mobileBlurRef.current = setTimeout(() => setMobileSearchFocused(false), 150);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && filters.searchQuery.trim()) {
                      const trimmed = filters.searchQuery.trim();
                      handleSearchChange(trimmed);
                      addRecentSearch(trimmed);
                      setMobileSearchFocused(false);
                    }
                  }}
                />
                {filters.searchQuery && (
                  <button
                    type="button"
                    onClick={() => handleSearchChange('')}
                    aria-label="Clear search"
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-slate-400 tap-highlight active:bg-slate-100 active:text-slate-700"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
                {mobileSearchFocused && (
                  <SearchSuggestionsDropdown
                    recents={mobileRecents}
                    onSelect={(q) => {
                      handleSearchChange(q);
                      addRecentSearch(q);
                      setMobileRecents(getRecentSearches());
                      setMobileSearchFocused(false);
                    }}
                    onClear={() => { clearRecentSearches(); setMobileRecents([]); }}
                  />
                )}
              </div>
            </div>
          </header>
          <div className="sticky top-0 z-50">
            <MobileFiltersBar
              filters={filters}
              activeDateRange={effectiveDateRange}
              sourceOptions={sourceOptions}
              onDateChange={handleDateRangeChange}
              onCategoryChange={handleCategoryChange}
              onSourceChange={handleSourceChange}
            />
          </div>
        </>
      ) : (
        <>
          <DesktopHero
            lastUpdated={lastUpdated}
            totalEvents={allEvents.length}
            sourceCount={sourceCount}
            loading={loading}
            searchQuery={filters.searchQuery}
            onSearchChange={handleSearchChange}
            onPresetSelect={handleQuickPreset}
            inputId={desktopSearchInputId}
          />
          <div className="sticky top-0 z-50 shadow-sm">
            <DesktopFiltersBar
              filters={filters}
              activeDateRange={effectiveDateRange}
              sourceOptions={sourceOptions}
              onDateChange={handleDateRangeChange}
              onCategoryChange={handleCategoryChange}
              onSourceChange={handleSourceChange}
            />
          </div>
        </>
      )}

      {statusBanner && !bannerDismissed && (
        <div className={statusBanner.tone === 'warning' ? 'bg-yellow-50 border-b border-yellow-200 text-yellow-900 text-xs' : 'bg-blue-50 border-b border-blue-200 text-blue-900 text-xs'}>
          <div className="container mx-auto px-4 py-2 flex items-start gap-2">
            <svg className={statusBanner.tone === 'warning' ? 'w-4 h-4 flex-shrink-0 mt-px text-yellow-700' : 'w-4 h-4 flex-shrink-0 mt-px text-blue-700'} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-2.99l-6.93-12a2 2 0 00-3.48 0l-6.93 12A2 2 0 005.07 19z" />
            </svg>
            <span className="flex-1">
              <strong>{statusBanner.title}</strong> {statusBanner.message}
            </span>
            <button
              type="button"
              onClick={dismissBanner}
              aria-label="Dismiss"
              className="flex-shrink-0 ml-2 text-current opacity-60 hover:opacity-100 transition-opacity"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main id="main-content" className="container mx-auto px-4 py-6 md:py-7">
        
        {loading === LoadingState.LOADING && (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <div className="relative">
               <div className="w-16 h-16 border-4 border-berkeley-blue/20 rounded-full"></div>
               <div className="absolute top-0 w-16 h-16 border-4 border-transparent border-t-berkeley-gold rounded-full animate-spin"></div>
            </div>
            <div className="text-center">
              <h3 className="text-berkeley-blue font-bold text-lg">Loading Events</h3>
              <p className="text-gray-500 text-sm animate-pulse">Fetching Berkeley events...</p>
            </div>
          </div>
        )}

        {loading === LoadingState.ERROR && (
          <div className="text-center py-10 bg-red-50 rounded-xl border border-red-200 max-w-lg mx-auto">
            <h3 className="text-xl text-red-800 font-bold mb-2">Failed to Load Events</h3>
            <p className="text-red-600 mb-2">We couldn't load the latest Berkeley event feed.</p>
            <p className="text-red-600 text-sm mb-4">Check your connection and try again.</p>
            <button onClick={() => loadEvents()} className="px-6 py-2 bg-red-700 hover:bg-red-800 text-white rounded-lg font-bold transition shadow-md">Retry</button>
          </div>
        )}

        {loading === LoadingState.SUCCESS && (
          <>
            {showingTodayFallback && (
              <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
                <strong>Nothing today</strong> — showing this week instead.
              </div>
            )}

            {/* Search interpretation chips */}
            {activeChips.length > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Interpreted as</span>
                {activeChips.map(chip => (
                  <span
                    key={chip.key}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(253,181,21,0.4)] bg-[rgba(253,181,21,0.08)] px-3 py-1 text-xs font-semibold text-berkeley-blue"
                  >
                    {chip.label}
                    <button
                      type="button"
                      aria-label={`Remove ${chip.label} filter`}
                      onClick={() => handleDismissChip(chip.key)}
                      className="ml-0.5 rounded-full p-2 -m-1 text-slate-400 hover:bg-berkeley-gold/20 hover:text-berkeley-blue transition-colors"
                    >
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Campus feed</p>
                <h2 className="mt-1 text-2xl font-semibold text-berkeley-blue md:text-[2rem] md:font-serif">
                  {filters.category !== 'All' ? `${filters.category} · ` : ''}
                  {effectiveDateRange === 'today' ? 'Today' : effectiveDateRange === 'tomorrow' ? 'Tomorrow' : effectiveDateRange === 'week' ? 'This Week' : 'Upcoming'}
                  <span className="ml-2 text-sm font-normal text-slate-400">({filteredEvents.length})</span>
                </h2>
                {lastUpdated && (
                  <p className="mt-1 text-sm text-slate-500">Updated {formatPacificDateTime(lastUpdated)}</p>
                )}
              </div>
            </div>

            {searchFallbackMessage && (
              <div className="mb-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 shadow-sm">
                {searchFallbackMessage}
              </div>
            )}

            {filteredEvents.length === 0 ? (
              <div className="rounded-3xl border border-slate-200 bg-white px-6 py-14 text-center shadow-sm">
                <p className="text-2xl font-semibold text-berkeley-blue md:font-serif">{emptyState.title}</p>
                <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-500">{emptyState.description}</p>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={emptyState.primaryAction}
                    className="rounded-full bg-berkeley-blue px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-berkeley-medblue"
                  >
                    {emptyState.primaryLabel}
                  </button>
                  {emptyState.secondaryLabel && emptyState.secondaryAction && (
                    <button
                      type="button"
                      onClick={emptyState.secondaryAction}
                      className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      {emptyState.secondaryLabel}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {(() => {
                    let globalIdx = 0;
                    return eventGroups.map(group => (
                      <React.Fragment key={group.dateKey}>
                        {eventGroups.length > 1 && (
                          <div className="col-span-full flex items-center gap-3 pt-4 pb-1">
                            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">{group.label}</h3>
                            <div className="flex-1 h-px bg-gray-200" />
                            <span className="text-xs text-gray-400">{group.events.length} event{group.events.length !== 1 ? 's' : ''}</span>
                          </div>
                        )}
                        {group.events.map((event) => {
                          const idx = globalIdx++;
                          const categoryStyle = getCategoryStyle(event.tags?.[0]);
                          return (
                            <article
                              key={event.id || idx}
                              aria-label={event.title}
                              className={`group relative flex h-full flex-col overflow-hidden rounded-2xl bg-white will-change-transform cursor-pointer select-none ${shouldAnimateCards ? 'animate-card-in opacity-0' : ''}`}
                              style={{
                                boxShadow: '0 1px 3px rgba(0,50,98,0.06), 0 4px 16px rgba(0,50,98,0.05)',
                                transition: 'transform 150ms cubic-bezier(0.32, 0.72, 0, 1), box-shadow 150ms cubic-bezier(0.32, 0.72, 0, 1)',
                                ...(shouldAnimateCards ? { animationDelay: `${Math.min(idx * 50, 500)}ms`, animationFillMode: 'forwards' } : {}),
                              }}
                              onClick={() => handleEventClick(event)}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 32px rgba(0,50,98,0.13), 0 1px 4px rgba(0,50,98,0.06)'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-3px)'; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(0,50,98,0.06), 0 4px 16px rgba(0,50,98,0.05)'; (e.currentTarget as HTMLElement).style.transform = ''; }}
                              onTouchStart={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.975)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 6px rgba(0,50,98,0.08)'; }}
                              onTouchEnd={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(0,50,98,0.06), 0 4px 16px rgba(0,50,98,0.05)'; }}
                              onTouchCancel={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(0,50,98,0.06), 0 4px 16px rgba(0,50,98,0.05)'; }}
                            >
                              {/* Left accent strip — gradient top to transparent */}
                              <div
                                className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-2xl"
                                style={{ background: `linear-gradient(to bottom, ${categoryStyle.stripColor} 0%, transparent 100%)` }}
                              />

                              {/* Content area with subtle category tint */}
                              <div className={`flex-grow p-5 pl-6 ${categoryStyle.tintBg}`}>
                                <div className="mb-3 flex items-start justify-between gap-2">
                                  <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${categoryStyle.badge}`}>
                                    {event.tags?.[0] || 'Event'}
                                  </span>
                                  {event.source === 'calbears' && !isHomeGame(event) && (
                                    <span className="inline-flex items-center bg-gray-100 text-gray-600 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-widest">Away</span>
                                  )}
                                  {event.url && (
                                    <a
                                      href={event.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={e => { e.stopPropagation(); trackExternalLink({ event_id: event.id, event_title: event.title, destination_url: event.url }); }}
                                      aria-label={`Open source page for ${event.title}`}
                                      className="flex-shrink-0 rounded-full p-1.5 text-slate-300 transition hover:bg-white/80 hover:text-berkeley-blue"
                                    >
                                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                      </svg>
                                    </a>
                                  )}
                                </div>

                                <h3 className="mb-4 text-[1.05rem] font-semibold leading-snug text-berkeley-blue transition-colors group-hover:text-berkeley-medblue md:font-serif" style={{ letterSpacing: '-0.01em' }}>{event.title}</h3>

                                {/* Compact metadata — no icon boxes */}
                                <div className="space-y-1.5 text-xs text-slate-500">
                                  <div className="flex items-center gap-1.5">
                                    <svg className="h-3.5 w-3.5 flex-shrink-0 text-[#FDB515]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                    <span className="font-medium text-slate-700">
                                      {effectiveDateRange !== 'today' && `${formatEventDate(event.date)} · `}{event.time || 'All day'}
                                    </span>
                                    {event.location && (
                                      <>
                                        <span className="text-slate-300">·</span>
                                        <span className="truncate">{event.location}</span>
                                      </>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <svg className="h-3.5 w-3.5 flex-shrink-0 text-[#FDB515]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                    </svg>
                                    <span className="truncate italic text-slate-500" title={event.organizer}>{event.organizer}</span>
                                  </div>
                                </div>
                              </div>

                              {/* Footer — no background, minimal divider */}
                              <div className="flex items-center justify-between px-6 py-3" style={{ borderTop: '1px solid rgba(0,50,98,0.06)' }}>
                                <SourceBadge source={event.source} linked={false} />
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); handleEventClick(event); }}
                                  className="inline-flex items-center gap-1 text-sm font-semibold text-berkeley-blue transition-colors hover:text-berkeley-medblue focus:outline-none focus-visible:ring-2 focus-visible:ring-berkeley-gold/60"
                                >
                                  View details
                                  <svg className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                                  </svg>
                                </button>
                              </div>
                            </article>
                          );
                        })}
                      </React.Fragment>
                    ));
                  })()}
                </div>
                <div className="mt-6 flex flex-col items-center gap-3">
                  <p className="text-sm text-gray-400 text-center">
                    Showing {visibleEvents.length} of {filteredEvents.length} events
                  </p>
                  {hiddenEventCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => setVisibleEventCount(count => count + VISIBLE_EVENT_BATCH_SIZE)}
                      className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm transition-colors duration-200 hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-berkeley-gold/60 focus-visible:ring-offset-2"
                    >
                      Load more events ({hiddenEventCount} remaining)
                    </button>
                  ) : (
                    <p className="text-sm text-gray-400 text-center">
                      All {filteredEvents.length} events loaded
                    </p>
                  )}
                </div>
              </>
            )}

          </>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-berkeley-blue text-white/70 py-6 mt-10">
        <div className="container mx-auto px-4 text-center text-sm">
          <p className="mb-1">
            Built for Berkeley students to discover campus events across all schools and organizations. By <a href="https://akhilneelam.com/" target="_blank" rel="noopener noreferrer" className="text-berkeley-gold hover:underline font-medium">Akhil Neelam</a>, <span className="text-berkeley-gold font-medium">Haas MBA</span>.
          </p>
          <p>
            Feedback? Reach out at{' '}
            <a href="mailto:akhil_neelam@berkeley.edu" className="text-berkeley-gold hover:underline">
              akhil_neelam@berkeley.edu
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

      {/* Back to top */}
      {showBackToTop && (
        <button
          type="button"
          aria-label="Back to top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-berkeley-blue text-white shadow-md transition-opacity duration-200 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-berkeley-gold/60 focus-visible:ring-offset-2"
        >
          ↑
        </button>
      )}
    </div>
  );
}
