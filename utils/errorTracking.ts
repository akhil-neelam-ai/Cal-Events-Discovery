/**
 * Optional client error tracking via Sentry.
 *
 * No-op unless VITE_SENTRY_DSN is set. Sentry is loaded with a dynamic import,
 * so it ships as a separate lazy chunk that is only fetched when a DSN is
 * configured — the main bundle stays the same size when tracking is off.
 *
 * To enable: create a Sentry project and set VITE_SENTRY_DSN in the Vercel
 * project environment (and .env.local for local testing). Error tracking only —
 * no performance tracing or session replay, to keep the network footprint light
 * for a static events site.
 */

type SentryModule = typeof import("@sentry/react");

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

let sentry: SentryModule | null = null;
let initPromise: Promise<void> | null = null;

export function initErrorTracking(): Promise<void> {
  if (!DSN) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = import("@sentry/react")
    .then((mod) => {
      mod.init({
        dsn: DSN,
        environment: import.meta.env.MODE,
        tracesSampleRate: 0,
        sendDefaultPii: false,
      });
      sentry = mod;
    })
    .catch((err) => {
      console.error("[errorTracking] Sentry failed to load", err);
    });

  return initPromise;
}

/** Report a caught error. No-op when tracking is disabled or not yet loaded. */
export function captureError(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (sentry) {
    sentry.captureException(error, context ? { extra: context } : undefined);
  }
}
