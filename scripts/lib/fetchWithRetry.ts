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
 * Fetch with exponential backoff and jitter. Throws after the final failed
 * attempt. Jitter (±20%) keeps the 11 adapters from synchronizing into retry
 * storms when a shared dependency blips.
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
      const backoff = Math.floor(
        retryDelayMs * 2 ** (attempt - 1) * (0.8 + Math.random() * 0.4),
      );
      await abortableDelay(backoff, signal);
    }
  }

  throw new Error(
    `${label} fetch failed after ${maxAttempts} attempts: ${lastErr}`,
  );
}
