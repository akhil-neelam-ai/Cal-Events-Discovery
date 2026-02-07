/**
 * Google Analytics 4 Utilities for CalEvents Discovery
 *
 * Tracks user interactions to understand how students use the app.
 */

// GA4 Measurement ID
const GA_MEASUREMENT_ID = 'G-E8MCW83PNG';

// Type definitions for analytics events
interface EventParams {
  [key: string]: string | number | boolean | undefined;
}

interface PageViewParams {
  page_path: string;
  page_title?: string;
}

interface SearchParams {
  search_term: string;
  results_count: number;
}

interface FilterParams {
  filter_type: 'category' | 'date_range';
  filter_value: string;
}

interface EventClickParams {
  event_id: string;
  event_title: string;
  event_category: string;
  event_date: string;
}

interface ExternalLinkParams {
  event_id: string;
  event_title: string;
  destination_url: string;
}

// Declare gtag on window
declare global {
  interface Window {
    gtag: (
      command: 'config' | 'event' | 'js',
      targetId: string | Date,
      params?: EventParams
    ) => void;
    dataLayer: unknown[];
  }
}

/**
 * Initialize Google Analytics
 * Call this once when the app loads
 */
export function initGA(): void {
  if (typeof window === 'undefined') return;

  // Avoid double initialization
  if (typeof window.gtag === 'function') return;

  // Initialize dataLayer
  window.dataLayer = window.dataLayer || [];

  // Define gtag function
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer.push(args);
  };

  window.gtag('js', new Date());
  window.gtag('config', GA_MEASUREMENT_ID, {
    send_page_view: false, // We'll send manually for SPA
  });

  console.log('[Analytics] GA4 initialized');
}

/**
 * Track page views
 * Call on initial load and route changes
 */
export function trackPageView(params: PageViewParams): void {
  if (typeof window === 'undefined' || !window.gtag) return;

  window.gtag('event', 'page_view', {
    page_path: params.page_path,
    page_title: params.page_title || document.title,
  });

  console.log('[Analytics] Page view:', params.page_path);
}

/**
 * Track generic events
 */
export function trackEvent(eventName: string, params?: EventParams): void {
  if (typeof window === 'undefined' || !window.gtag) return;

  window.gtag('event', eventName, params);
  console.log('[Analytics] Event:', eventName, params);
}

/**
 * Track search queries
 */
export function trackSearch(params: SearchParams): void {
  trackEvent('search', {
    search_term: params.search_term,
    results_count: params.results_count,
  });
}

/**
 * Track filter usage
 */
export function trackFilter(params: FilterParams): void {
  trackEvent('filter_applied', {
    filter_type: params.filter_type,
    filter_value: params.filter_value,
  });
}

/**
 * Track event card clicks (opening detail view)
 */
export function trackEventClick(params: EventClickParams): void {
  trackEvent('event_click', {
    event_id: params.event_id,
    event_title: params.event_title,
    event_category: params.event_category,
    event_date: params.event_date,
  });
}

/**
 * Track clicks to external event pages
 */
export function trackExternalLink(params: ExternalLinkParams): void {
  trackEvent('external_link_click', {
    event_id: params.event_id,
    event_title: params.event_title,
    destination_url: params.destination_url,
  });
}

/**
 * Track category filter changes
 */
export function trackCategoryFilter(category: string): void {
  trackFilter({
    filter_type: 'category',
    filter_value: category,
  });
}

/**
 * Track date range filter changes
 */
export function trackDateFilter(dateRange: string): void {
  trackFilter({
    filter_type: 'date_range',
    filter_value: dateRange,
  });
}
