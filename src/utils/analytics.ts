/**
 * Google Analytics 4 typed utility functions
 */

interface GtagEvent {
  [key: string]: string | number | boolean | undefined;
}

interface PageViewParams {
  page_path: string;
  page_title?: string;
}

interface SearchParams {
  search_term: string;
  results_count?: number;
}

interface EventClickParams {
  event_id?: string;
  event_title: string;
  event_category: string;
  event_date?: string;
}

interface ExternalLinkParams {
  event_id?: string;
  event_title: string;
  destination_url: string;
}

/**
 * Initialize GA4 (called once on app startup)
 */
export function initGA(): void {
  if (typeof window !== 'undefined' && typeof gtag !== 'undefined') {
    console.log('[Analytics] GA4 initialized');
  }
}

/**
 * Track a custom event in GA4
 */
export function trackEvent(eventName: string, eventParams?: GtagEvent): void {
  if (typeof window !== 'undefined' && typeof gtag !== 'undefined') {
    gtag('event', eventName, eventParams);
    console.log(`[Analytics] Event: ${eventName}`, eventParams);
  }
}

/**
 * Track a page view
 */
export function trackPageView(params: PageViewParams): void {
  if (typeof window !== 'undefined' && typeof gtag !== 'undefined') {
    gtag('config', 'G-E8MCW83PNG', {
      page_path: params.page_path,
      page_title: params.page_title,
    });
    console.log(`[Analytics] Page view: ${params.page_path}`);
  }
}

/**
 * Track search events
 */
export function trackSearch(params: SearchParams): void {
  trackEvent('search', {
    search_term: params.search_term,
    results_count: params.results_count || 0,
  });
}

/**
 * Track category filter selection
 */
export function trackCategoryFilter(category: string): void {
  trackEvent('filter_applied', {
    filter_type: 'category',
    filter_value: category,
  });
}

/**
 * Track date filter selection
 */
export function trackDateFilter(dateRange: string): void {
  trackEvent('filter_applied', {
    filter_type: 'date',
    filter_value: dateRange,
  });
}

/**
 * Track event card clicks
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
 * Track external link clicks
 */
export function trackExternalLink(params: ExternalLinkParams): void {
  trackEvent('external_link_click', {
    event_id: params.event_id,
    event_title: params.event_title,
    destination_url: params.destination_url,
  });
}

// Declare gtag globally for TypeScript
declare function gtag(...args: any[]): void;
