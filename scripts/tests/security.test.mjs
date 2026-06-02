/**
 * Security regression tests for the client XSS posture.
 *
 * The entire no-XSS guarantee rests on `HttpUrlSchema` rejecting non-http(s)
 * schemes before a URL can reach the `href={event.url}` sinks React does not
 * escape. Every adapter validates through `CanonicalEventSchema` (which uses
 * `HttpUrlSchema` for `canonical_url`/`source_url`), so a hostile feed cannot
 * smuggle a `javascript:` URL into the published feed. These tests pin that.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  CanonicalEventSchema,
  HttpUrlSchema,
} from "../../scripts/lib/schema.ts";

test("HttpUrlSchema accepts http and https URLs", () => {
  assert.equal(
    HttpUrlSchema.safeParse("https://example.com/event").success,
    true,
  );
  assert.equal(
    HttpUrlSchema.safeParse("http://example.com/event").success,
    true,
  );
});

test("HttpUrlSchema rejects script-bearing and non-web schemes", () => {
  const hostile = [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "  javascript:alert(1)  ",
    "not a url",
    "",
  ];
  for (const value of hostile) {
    assert.equal(
      HttpUrlSchema.safeParse(value).success,
      false,
      `HttpUrlSchema must reject ${JSON.stringify(value)}`,
    );
  }
});

function baseCanonicalEvent(overrides = {}) {
  return {
    source_name: "livewhale",
    source_id: "evt-1",
    source_url: "https://events.berkeley.edu/evt-1",
    title: "Sample Event",
    start_at: "2026-05-10T12:00:00-07:00",
    canonical_url: "https://events.berkeley.edu/evt-1",
    last_seen_at: "2026-05-04T12:00:00Z",
    ...overrides,
  };
}

test("CanonicalEventSchema rejects a javascript: canonical_url", () => {
  const result = CanonicalEventSchema.safeParse(
    baseCanonicalEvent({ canonical_url: "javascript:alert(document.cookie)" }),
  );
  assert.equal(result.success, false);
});

test("CanonicalEventSchema rejects a data: source_url", () => {
  const result = CanonicalEventSchema.safeParse(
    baseCanonicalEvent({
      source_url: "data:text/html,<script>alert(1)</script>",
    }),
  );
  assert.equal(result.success, false);
});

test("CanonicalEventSchema accepts a clean event and preserves its URL", () => {
  const result = CanonicalEventSchema.safeParse(baseCanonicalEvent());
  assert.equal(result.success, true);
  assert.equal(result.data.canonical_url, "https://events.berkeley.edu/evt-1");
});
