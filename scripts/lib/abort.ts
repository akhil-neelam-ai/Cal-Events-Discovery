export interface FetchOptions {
  signal?: AbortSignal;
}

export function signalWithTimeout(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!parent) return timeoutSignal;
  return AbortSignal.any([parent, timeoutSignal]);
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Operation aborted");
  }
}

export function abortableDelay(
  ms: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`Delay must be a non-negative finite number, got ${ms}`);
  }

  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new Error("Operation aborted"),
      );
    };

    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
