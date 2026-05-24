import {
  abortableDelay,
  signalWithTimeout,
  type FetchOptions,
} from "./abort.js";

export interface FetchWithRetryOptions extends FetchOptions {
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  /** Short label for log lines (defaults to the URL). */
  label?: string;
  /** Return immediately on these HTTP statuses without retrying. */
  acceptStatuses?: number[];
}

/**
 * Fetch with linear backoff retries. Throws after the final failed attempt.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const {
    signal,
    timeoutMs = 30_000,
    maxAttempts = 3,
    retryDelayMs = 1_500,
    label = url,
    acceptStatuses = [],
  } = options;

  let lastErr = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(
      `[${label}] fetching ${url} (attempt ${attempt}/${maxAttempts})`,
    );

    try {
      const res = await fetch(url, {
        ...init,
        signal: signalWithTimeout(signal, timeoutMs),
      });

      if (acceptStatuses.includes(res.status)) {
        return res;
      }

      if (res.ok) {
        return res;
      }

      lastErr = `${res.status} ${res.statusText}`;
      console.warn(`[${label}] non-2xx (${lastErr})`);
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      console.warn(`[${label}] fetch error: ${lastErr}`);
    }

    if (attempt < maxAttempts) {
      await abortableDelay(retryDelayMs * attempt, signal);
    }
  }

  throw new Error(
    `${label} fetch failed after ${maxAttempts} attempts: ${lastErr}`,
  );
}
