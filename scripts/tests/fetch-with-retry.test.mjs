import assert from "node:assert/strict";
import test from "node:test";

import { fetchWithRetry } from "../lib/fetchWithRetry.ts";

test("fetchWithRetry succeeds on the first ok response", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;

  globalThis.fetch = async () => {
    attempts += 1;
    return { ok: true, status: 200, statusText: "OK" };
  };

  try {
    const res = await fetchWithRetry(
      "https://example.com/feed",
      {},
      {
        label: "test",
        maxAttempts: 3,
        retryDelayMs: 1,
      },
    );
    assert.equal(res.ok, true);
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchWithRetry retries transient failures", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;

  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      return { ok: false, status: 503, statusText: "Service Unavailable" };
    }
    return { ok: true, status: 200, statusText: "OK" };
  };

  try {
    const res = await fetchWithRetry(
      "https://example.com/feed",
      {},
      {
        label: "test",
        maxAttempts: 3,
        retryDelayMs: 1,
      },
    );
    assert.equal(res.ok, true);
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchWithRetry returns acceptStatuses without retrying", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;

  globalThis.fetch = async () => {
    attempts += 1;
    return { ok: false, status: 400, statusText: "Bad Request" };
  };

  try {
    const res = await fetchWithRetry(
      "https://example.com/feed",
      {},
      {
        label: "test",
        maxAttempts: 3,
        retryDelayMs: 1,
        acceptStatuses: [400],
      },
    );
    assert.equal(res.status, 400);
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchWithRetry throws after exhausting attempts", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    statusText: "Internal Server Error",
  });

  try {
    await assert.rejects(
      () =>
        fetchWithRetry(
          "https://example.com/feed",
          {},
          {
            label: "test",
            maxAttempts: 2,
            retryDelayMs: 1,
          },
        ),
      /test fetch failed after 2 attempts/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
