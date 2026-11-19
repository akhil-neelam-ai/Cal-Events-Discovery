/**
 * Analytics utilities for CalEvents Discovery: GA4 and PostHog
 *
 * Tracks user interactions to understand how students use the app.
 * Every custom event goes through trackEvent, which sends it to both.
 */

import type { PostHog } from "posthog-js";

// GA4 Measurement ID
const GA_MEASUREMENT_ID = "G-E8MCW83PNG";

// Same-origin path that vercel.json forwards to PostHog. Requests stay on
// cal-events.com, so the CSP needs no PostHog hosts.
const POSTHOG_PROXY_PATH = "/pulse";

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
  filter_type: "category" | "date_range" | "source" | "topic";
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
      command: "config" | "event" | "js",
      targetId: string | Date,
      params?: EventParams,
    ) => void;
    dataLayer: unknown[];
  }
}

/**
 * Initialize Google Analytics
 * Call this once when the app loads
 * Waits for Google's gtag script to load before configuring
 */
export function initGA(): void {
  if (typeof window === "undefined") return;

  // Initialize dataLayer first
  window.dataLayer = window.dataLayer || [];

  // Wait for Google's gtag to be ready (from the script tag)
  const checkGtag = () => {
    if (typeof window.gtag === "function") {
      // Google's gtag is ready - configure it
      window.gtag("config", GA_MEASUREMENT_ID, {
        send_page_view: false, // We'll send manually for SPA
      });
      if (import.meta.env.DEV) console.log("[Analytics] GA4 initialized");
      return true;
    }
    return false;
  };

  // Try immediately
  if (checkGtag()) return;

  // If not ready, poll for up to 3 seconds
  let attempts = 0;
  const interval = setInterval(() => {
    attempts++;
    if (checkGtag() || attempts >= 30) {
      clearInterval(interval);
      if (attempts >= 30) {
        if (import.meta.env.DEV)
          console.warn(
            "[Analytics] GA4 gtag not found - Google Analytics script may have failed to load",
          );
      }
    }
  }, 100);
}

type QueuedEvent = [eventName: string, params: EventParams | undefined];

let posthogClient: PostHog | null = null;
// Holds events fired while the PostHog chunk loads. Null when not loading.
let posthogQueue: QueuedEvent[] | null = null;

/**
 * Initialize PostHog
 * Call this once when the app loads
 *
 * The project key comes from VITE_POSTHOG_KEY, which is public like the GA4
 * ID. PostHog stays off when the key is unset: local dev, tests, and previews.
 * The library loads in its own chunk so it never delays first paint.
 */
export function initPostHog(): void {
  if (typeof window === "undefined") return;
  if (posthogClient || posthogQueue) return;

  const key: string | undefined = import.meta.env.VITE_POSTHOG_KEY;
  if (!key) return;

  posthogQueue = [];
  import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(key, {
        api_host: POSTHOG_PROXY_PATH,
        ui_host: "https://us.posthog.com",
        defaults: "2026-08-30",
        // No cookies or local storage. PostHog's servers derive a daily
        // anonymous ID instead, so the site needs no consent banner.
        cookieless_mode: "always",
        disable_session_recording: true,
        disable_surveys: true,
      });
      posthogClient = posthog;
      for (const [eventName, params] of posthogQueue ?? []) {
        posthog.capture(eventName, params);
      }
      posthogQueue = null;
      if (import.meta.env.DEV) console.log("[Analytics] PostHog initialized");
    })
    .catch(() => {
      // A blocked or failed chunk leaves PostHog off for this visit.
      posthogQueue = null;
    });
}

function capturePostHog(eventName: string, params?: EventParams): void {
  if (posthogClient) {
    posthogClient.capture(eventName, params);
  } else {
    posthogQueue?.push([eventName, params]);
  }
}

/**
 * Track page views in GA4
 * Call on initial load and route changes
 *
 * PostHog sends its own $pageview when it initializes, so this stays GA4-only.
 */
export function trackPageView(params: PageViewParams): void {
  if (typeof window === "undefined") return;

  if (!window.gtag) {
    if (import.meta.env.DEV)
      console.warn("[Analytics] gtag not available - page view not tracked");
    return;
  }

  window.gtag("event", "page_view", {
    page_path: params.page_path,
    page_title: params.page_title || document.title,
  });

  if (import.meta.env.DEV)
    console.log("[Analytics] Page view tracked:", params.page_path);
}

/**
 * Track generic events
 */
export function trackEvent(eventName: string, params?: EventParams): void {
  if (typeof window === "undefined") return;

  capturePostHog(eventName, params);

  if (!window.gtag) {
    if (import.meta.env.DEV)
      console.warn(
        "[Analytics] gtag not available - event not tracked:",
        eventName,
      );
    return;
  }

  window.gtag("event", eventName, params);
  if (import.meta.env.DEV)
    console.log("[Analytics] Event tracked:", eventName, params);
}

/**
 * Track search queries
 */
export function trackSearch(params: SearchParams): void {
  trackEvent("search", {
    search_term: params.search_term,
    results_count: params.results_count,
  });
}

/**
 * Track filter usage
 */
export function trackFilter(params: FilterParams): void {
  trackEvent("filter_applied", {
    filter_type: params.filter_type,
    filter_value: params.filter_value,
  });
}

/**
 * Track event card clicks (opening detail view)
 */
/**
 * Track a shared link to an event the feed no longer lists
 */
export function trackEndedEventLink(eventId: string): void {
  trackEvent("ended_event_link", { event_id: eventId });
}

export function trackEventClick(params: EventClickParams): void {
  trackEvent("event_click", {
    event_id: params.event_id,
    event_title: params.event_title,
    event_category: params.event_category,
    event_date: params.event_date,
  });
}

/**
 * Track the "Surprise me" sticker. The event it opens also sends
 * event_click, the same as a card click.
 */
export function trackSurpriseMe(params: {
  event_id: string;
  results_count: number;
}): void {
  trackEvent("surprise_me", {
    event_id: params.event_id,
    results_count: params.results_count,
  });
}

/**
 * Track the "Clear all" link, beside the view heading or in the phone
 * Filters drawer.
 */
export function trackClearAll(placement: "wall" | "drawer"): void {
  trackEvent("clear_all", { placement });
}

/**
 * Track clicks to external event pages
 */
export function trackExternalLink(params: ExternalLinkParams): void {
  trackEvent("external_link_click", {
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
    filter_type: "category",
    filter_value: category,
  });
}

/**
 * Track date range filter changes
 */
export function trackDateFilter(dateRange: string): void {
  trackFilter({
    filter_type: "date_range",
    filter_value: dateRange,
  });
}
