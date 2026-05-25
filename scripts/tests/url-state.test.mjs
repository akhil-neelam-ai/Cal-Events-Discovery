import assert from "node:assert/strict";
import test from "node:test";

import { buildUrlStateSearch, parseUrlState } from "../../utils/urlState.ts";

const DEFAULT_FILTERS = {
  dateRange: "today",
  category: "All",
  searchQuery: "",
  source: "All",
};

const OPTIONS = {
  defaultFilters: DEFAULT_FILTERS,
  allowedCategories: [
    "All",
    "Academic",
    "Arts",
    "Sports",
    "Science & Tech",
    "Student Life",
    "Entrepreneurship",
  ],
  allowedSources: [
    "All",
    "livewhale",
    "ehub",
    "cal_performances",
    "bampfa",
    "calbears",
    "callink",
    "haas",
    "berkeley_law",
    "simons",
  ],
};

test("parseUrlState restores shareable filters and selected event", () => {
  const parsed = parseUrlState(
    "?q=ai%20talks&date=week&category=Science%20%26%20Tech&source=livewhale&event=evt-42",
    OPTIONS,
  );

  assert.deepEqual(parsed.filters, {
    dateRange: "week",
    category: "Science & Tech",
    searchQuery: "ai talks",
    source: "livewhale",
  });
  assert.equal(parsed.selectedEventId, "evt-42");
  assert.equal(parsed.hasExplicitDateRange, true);
});

test("parseUrlState preserves tomorrow when shared explicitly", () => {
  const parsed = parseUrlState("?date=tomorrow&category=Arts", OPTIONS);

  assert.deepEqual(parsed.filters, {
    ...DEFAULT_FILTERS,
    dateRange: "tomorrow",
    category: "Arts",
  });
  assert.equal(parsed.hasExplicitDateRange, true);
});

test("parseUrlState ignores unsupported values", () => {
  const parsed = parseUrlState(
    "?date=month&category=Unknown&source=made-up&event=",
    OPTIONS,
  );

  assert.deepEqual(parsed.filters, DEFAULT_FILTERS);
  assert.equal(parsed.selectedEventId, null);
  assert.equal(parsed.hasExplicitDateRange, false);
});

test("parseUrlState marks missing date as not user-selected", () => {
  const parsed = parseUrlState("?q=tomorrow", OPTIONS);

  assert.deepEqual(parsed.filters, {
    ...DEFAULT_FILTERS,
    searchQuery: "tomorrow",
  });
  assert.equal(parsed.hasExplicitDateRange, false);
});

test("buildUrlStateSearch omits defaults and trims search text", () => {
  const serialized = buildUrlStateSearch(
    {
      ...DEFAULT_FILTERS,
      searchQuery: "  career fair  ",
      dateRange: "upcoming",
      source: "callink",
    },
    "event-123",
    { defaultFilters: DEFAULT_FILTERS },
  );

  assert.equal(
    serialized,
    "?q=career+fair&date=upcoming&source=callink&event=event-123",
  );
});

test("buildUrlStateSearch clears empty shareable state", () => {
  const serialized = buildUrlStateSearch(DEFAULT_FILTERS, null, {
    defaultFilters: DEFAULT_FILTERS,
  });
  assert.equal(serialized, "");
});

test("buildUrlStateSearch keeps tomorrow in shareable state", () => {
  const serialized = buildUrlStateSearch(
    {
      ...DEFAULT_FILTERS,
      dateRange: "tomorrow",
    },
    null,
    { defaultFilters: DEFAULT_FILTERS },
  );

  assert.equal(serialized, "?date=tomorrow");
});
