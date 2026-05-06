(function registerCalEventsWebMcpTools() {
  const EVENTS_CACHE_TTL_MS = 120_000;
  let eventsCache = null;

  async function fetchJson(path) {
    const response = await fetch(path, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    return response.json();
  }

  async function fetchEventsPayload() {
    const now = Date.now();
    if (eventsCache && now - eventsCache.fetchedAt < EVENTS_CACHE_TTL_MS) {
      return eventsCache.payload;
    }

    const payload = await fetchJson("/events.json");
    eventsCache = { fetchedAt: now, payload };
    return payload;
  }

  function matchesText(event, query) {
    if (!query) return true;
    const haystack = [
      event.title,
      event.description,
      event.organizer,
      event.location,
      event.source,
      ...(Array.isArray(event.tags) ? event.tags : []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query.toLowerCase());
  }

  function parseLimit(value) {
    const parsed = Number(value ?? 10);
    if (!Number.isFinite(parsed)) return 10;
    return Math.min(Math.max(Math.trunc(parsed), 1), 50);
  }

  const searchEventsTool = {
    name: "search_berkeley_events",
    description:
      "Search upcoming UC Berkeley campus events from CalEvents. Returns matching events with title, date, time, location, organizer, category, source, and official URL.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Optional keyword query matched against title, description, organizer, location, tags, and source.",
        },
        category: {
          type: "string",
          enum: [
            "Academic",
            "Arts",
            "Sports",
            "Science & Tech",
            "Student Life",
            "Entrepreneurship",
          ],
          description:
            "Optional category filter. Matches any event tag, not only the primary displayed tag.",
        },
        source: {
          type: "string",
          description:
            "Optional source id such as livewhale, bampfa, callink, calbears, cal_performances, haas, berkeley_law, simons, or ehub.",
        },
        startDate: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description:
            "Optional inclusive Pacific date lower bound in YYYY-MM-DD.",
        },
        endDate: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description:
            "Optional inclusive Pacific date upper bound in YYYY-MM-DD.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          default: 10,
        },
      },
    },
    annotations: { readOnlyHint: true },
    execute: async function executeSearchEvents(input = {}) {
      if (input.startDate && input.endDate && input.startDate > input.endDate) {
        return {
          error: "startDate must be earlier than or equal to endDate",
          count: 0,
          events: [],
        };
      }

      const data = await fetchEventsPayload();
      const limit = parseLimit(input.limit);
      const events = Array.isArray(data.events) ? data.events : [];
      const results = events
        .filter((event) => matchesText(event, input.query || ""))
        .filter((event) =>
          input.category && Array.isArray(event.tags)
            ? event.tags.includes(input.category)
            : true,
        )
        .filter((event) =>
          input.source ? event.source === input.source : true,
        )
        .filter((event) =>
          input.startDate ? event.date >= input.startDate : true,
        )
        .filter((event) => (input.endDate ? event.date <= input.endDate : true))
        .slice(0, limit)
        .map((event) => ({
          id: event.id,
          title: event.title,
          date: event.date,
          time: event.time,
          location: event.location,
          organizer: event.organizer,
          category: event.tags?.[0] || null,
          source: event.source || null,
          url: event.url,
        }));

      return {
        lastUpdated: data.lastUpdated,
        count: results.length,
        events: results,
      };
    },
  };

  const feedStatusTool = {
    name: "get_cal_events_feed_status",
    description:
      "Inspect CalEvents source freshness, ingestion status, fallback usage, and data-quality state.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async function executeFeedStatus() {
      return fetchJson("/status.json");
    },
  };

  try {
    if (
      "modelContext" in navigator &&
      navigator.modelContext &&
      typeof navigator.modelContext.registerTool === "function"
    ) {
      navigator.modelContext.registerTool(searchEventsTool);
      navigator.modelContext.registerTool(feedStatusTool);
    }
  } catch (error) {
    if (
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    ) {
      console.warn("[webmcp] tool registration failed", error);
    }
  }
})();
