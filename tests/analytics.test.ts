import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("posthog-js", () => ({ default: posthog }));

type AnalyticsModule = typeof import("../utils/analytics");

// The module keeps its PostHog client in module state, so each test loads a
// fresh copy.
async function loadAnalytics(): Promise<AnalyticsModule> {
  vi.resetModules();
  return import("../utils/analytics");
}

// Lets the mocked dynamic import of posthog-js settle.
async function posthogLoaded(): Promise<void> {
  await vi.waitFor(() => expect(posthog.init).toHaveBeenCalled());
}

describe("analytics fan-out", () => {
  const gtag = vi.fn();

  beforeEach(() => {
    window.gtag = gtag;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("leaves PostHog off when no project key is set", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "");
    const analytics = await loadAnalytics();

    analytics.initPostHog();
    analytics.trackEvent("search", { search_term: "jazz" });
    await Promise.resolve();

    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
    expect(gtag).toHaveBeenCalledWith("event", "search", {
      search_term: "jazz",
    });
  });

  it("starts PostHog cookieless, through the proxy, with replay off", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    const analytics = await loadAnalytics();

    analytics.initPostHog();
    await posthogLoaded();

    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(posthog.init).toHaveBeenCalledWith(
      "phc_test",
      expect.objectContaining({
        api_host: "/pulse",
        cookieless_mode: "always",
        disable_session_recording: true,
      }),
    );
  });

  it("sends each event to both GA4 and PostHog", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    const analytics = await loadAnalytics();
    analytics.initPostHog();
    await posthogLoaded();

    analytics.trackFilter({ filter_type: "topic", filter_value: "AI" });

    const params = { filter_type: "topic", filter_value: "AI" };
    expect(gtag).toHaveBeenCalledWith("event", "filter_applied", params);
    expect(posthog.capture).toHaveBeenCalledWith("filter_applied", params);
  });

  it("holds events fired while PostHog loads, then sends them in order", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    const analytics = await loadAnalytics();

    analytics.initPostHog();
    analytics.trackEvent("first");
    analytics.trackEvent("second", { n: 2 });
    expect(posthog.capture).not.toHaveBeenCalled();

    await posthogLoaded();
    await vi.waitFor(() => expect(posthog.capture).toHaveBeenCalledTimes(2));

    expect(posthog.capture.mock.calls).toEqual([
      ["first", undefined],
      ["second", { n: 2 }],
    ]);
  });

  it("initializes once when called twice", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    const analytics = await loadAnalytics();

    analytics.initPostHog();
    analytics.initPostHog();
    await posthogLoaded();
    analytics.initPostHog();
    await Promise.resolve();

    expect(posthog.init).toHaveBeenCalledTimes(1);
  });
});
