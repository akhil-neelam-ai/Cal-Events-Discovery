(function registerCalEventsWebMcpTools() {
  const EVENTS_CACHE_TTL_MS = 120_000;
  const FETCH_TIMEOUT_MS = 8_000;
  let eventsCache = null;

  async function fetchJson(path, timeoutMs = FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(path, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }
      return response.json();
    } finally {
      clearTimeout(timeoutId);
    }
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

  function findMatchingCategory(event, category) {
    if (!category || !Array.isArray(event.tags)) return null;
    const requested = category.toLowerCase();
    return (
      event.tags.find((tag) => String(tag).toLowerCase() === requested) ?? null
    );
  }

  function timeSortValue(time) {
    if (!time || /all\s*day/i.test(time)) return 0;
    const match = String(time).match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
    if (!match) return Number.MAX_SAFE_INTEGER;

    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    const meridiem = match[3].toLowerCase();

    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) {
      return Number.MAX_SAFE_INTEGER;
    }

    if (meridiem === "am" && hour === 12) {
      hour = 0;
    } else if (meridiem === "pm" && hour !== 12) {
      hour += 12;
    }

    return hour * 60 + minute;
  }

  function compareEventsChronologically(left, right) {
    return (
      String(left.date || "").localeCompare(String(right.date || "")) ||
      timeSortValue(left.time) - timeSortValue(right.time) ||
      String(left.title || "").localeCompare(String(right.title || ""))
    );
  }

  const PT_TIME_ZONE = "America/Los_Angeles";

  function pacificDateKey(date) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: PT_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date ?? new Date());
  }

  function addDaysToDateKey(dateKey, days) {
    const [year, month, day] = String(dateKey).split("-").map(Number);
    if (!year || !month || !day) return dateKey;
    const shifted = new Date(Date.UTC(year, month - 1, day));
    shifted.setUTCDate(shifted.getUTCDate() + days);
    return shifted.toISOString().slice(0, 10);
  }

  // Resolve a FiltersBar-style preset into inclusive Pacific date bounds.
  function resolveDatePreset(preset) {
    if (!preset) return null;
    const today = pacificDateKey();
    if (preset === "today") return { startDate: today, endDate: today };
    if (preset === "tomorrow") {
      const tomorrow = addDaysToDateKey(today, 1);
      return { startDate: tomorrow, endDate: tomorrow };
    }
    if (preset === "week") {
      return { startDate: today, endDate: addDaysToDateKey(today, 6) };
    }
    if (preset === "upcoming") return { startDate: today, endDate: undefined };
    return null;
  }

  // ─── ICS generation ─────────────────────────────────────────────────────────
  // Mirrors utils/icsExport.ts (RFC 5545). Kept in sync by tests in
  // scripts/tests/webmcp-tools.test.mjs. webmcp-tools.js is a classic script and
  // cannot import the TypeScript module directly.
  function escapeIcsText(value) {
    return String(value)
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\n/g, "\\n");
  }

  function formatIcsUtc(date) {
    return date
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
  }

  function isContiguousRun(dateKeys) {
    for (let i = 1; i < dateKeys.length; i += 1) {
      if (addDaysToDateKey(dateKeys[i - 1], 1) !== dateKeys[i]) return false;
    }
    return true;
  }

  function icsTimeWindow(time, dateKey) {
    const compactDate = String(dateKey).replace(/-/g, "");

    if (/all\s*day/i.test(time)) {
      const endDate = new Date(`${dateKey}T00:00:00Z`);
      endDate.setUTCDate(endDate.getUTCDate() + 1);
      return {
        allDay: true,
        startLocal: compactDate,
        endLocal: endDate.toISOString().slice(0, 10).replace(/-/g, ""),
      };
    }

    const match = String(time).match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
    if (!match) {
      return {
        allDay: false,
        startLocal: `${compactDate}T120000`,
        endLocal: `${compactDate}T130000`,
      };
    }

    let hour = Number(match[1]);
    const minute = Number(match[2] ?? 0);
    const meridiem = match[3].toLowerCase();
    if (meridiem === "am" && hour === 12) hour = 0;
    if (meridiem === "pm" && hour !== 12) hour += 12;

    let endHour = hour + 1;
    let endDateCompact = compactDate;
    if (endHour >= 24) {
      endHour -= 24;
      endDateCompact = addDaysToDateKey(dateKey, 1).replace(/-/g, "");
    }
    const pad = (value) => String(value).padStart(2, "0");

    return {
      allDay: false,
      startLocal: `${compactDate}T${pad(hour)}${pad(minute)}00`,
      endLocal: `${endDateCompact}T${pad(endHour)}${pad(minute)}00`,
    };
  }

  function veventLines(uid, window, event) {
    const lines = [
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${formatIcsUtc(new Date())}`,
    ];

    if (window.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${window.startLocal}`);
      lines.push(`DTEND;VALUE=DATE:${window.endLocal}`);
    } else {
      lines.push(`DTSTART;TZID=${PT_TIME_ZONE}:${window.startLocal}`);
      lines.push(`DTEND;TZID=${PT_TIME_ZONE}:${window.endLocal}`);
    }

    lines.push(`SUMMARY:${escapeIcsText(event.title)}`);
    lines.push(
      `DESCRIPTION:${escapeIcsText(event.description || event.title)}`,
    );
    if (event.location) {
      lines.push(`LOCATION:${escapeIcsText(event.location)}`);
    }
    if (event.url) {
      lines.push(`URL:${event.url}`);
    }
    lines.push("END:VEVENT");
    return lines;
  }

  function buildVevents(event) {
    const dates =
      Array.isArray(event.dates) && event.dates.length > 1 ? event.dates : null;

    if (dates) {
      const allDay = /all\s*day/i.test(event.time);
      if (allDay && isContiguousRun(dates)) {
        const start = dates[0].replace(/-/g, "");
        const endExclusive = addDaysToDateKey(
          dates[dates.length - 1],
          1,
        ).replace(/-/g, "");
        return veventLines(
          `${event.id}@cal-events.com`,
          { allDay: true, startLocal: start, endLocal: endExclusive },
          event,
        );
      }

      return dates.flatMap((dateKey) =>
        veventLines(
          `${event.id}-${dateKey}@cal-events.com`,
          icsTimeWindow(event.time, dateKey),
          event,
        ),
      );
    }

    return veventLines(
      `${event.id}@cal-events.com`,
      icsTimeWindow(event.time, String(event.date).slice(0, 10)),
      event,
    );
  }

  function buildEventIcs(event) {
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Cal Events Discovery//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      ...buildVevents(event),
      "END:VCALENDAR",
    ];
    return `${lines.join("\r\n")}\r\n`;
  }

  const searchEventsTool = {
    name: "search_berkeley_events",
    description:
      "Search upcoming UC Berkeley campus events from CalEvents. Returns matching events with title, date, time, location, organizer, category, source, and official URL. NOTE: query is a case-insensitive substring match across fields, then chronological sort — it does NOT use the website's ranked relevance engine (synonym expansion, intent detection, fuzzy fallback). For precise keyword filtering this is reliable; for broad natural-language queries the website UI may surface more relevant results.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Optional keyword query (case-insensitive substring) matched against title, description, organizer, location, tags, and source.",
        },
        datePreset: {
          type: "string",
          enum: ["today", "tomorrow", "week", "upcoming"],
          description:
            "Optional Pacific-time shorthand resolved server-side: today, tomorrow, week (next 7 days), or upcoming (today onward). Explicit startDate/endDate override the matching bound.",
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
            "Optional source id: livewhale, callink, cal_performances, calbears, bampfa, haas, berkeley_law, simons, ehub, luma, or begin.",
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
    execute: async function executeSearchEvents(input) {
      input = input ?? {};

      const preset = resolveDatePreset(input.datePreset);
      const startDate =
        input.startDate ?? (preset ? preset.startDate : undefined);
      const endDate = input.endDate ?? (preset ? preset.endDate : undefined);

      if (startDate && endDate && startDate > endDate) {
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
          input.category
            ? Boolean(findMatchingCategory(event, input.category))
            : true,
        )
        .filter((event) =>
          input.source ? event.source === input.source : true,
        )
        .filter((event) => (startDate ? event.date >= startDate : true))
        .filter((event) => (endDate ? event.date <= endDate : true))
        .sort(compareEventsChronologically)
        .slice(0, limit)
        .map((event) => {
          const matchedCategory = findMatchingCategory(event, input.category);
          return {
            id: event.id,
            title: event.title,
            date: event.date,
            time: event.time,
            location: event.location,
            organizer: event.organizer,
            category: matchedCategory || event.tags?.[0] || null,
            matchedCategory,
            tags: Array.isArray(event.tags) ? event.tags : [],
            source: event.source || null,
            url: event.url,
          };
        });

      return {
        lastUpdated: data.lastUpdated,
        count: results.length,
        events: results,
      };
    },
  };

  function findEventById(events, id) {
    return events.find((event) => event.id === id) ?? null;
  }

  const getEventByIdTool = {
    name: "get_event_by_id",
    description:
      "Fetch a single CalEvents event by its id (the same id used in ?event=<id> deep links and returned by search_berkeley_events). Returns the full event or null if not found.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The event id to look up.",
        },
      },
      required: ["id"],
    },
    annotations: { readOnlyHint: true },
    execute: async function executeGetEventById(input) {
      input = input ?? {};
      if (!input.id) {
        return { error: "id is required", event: null };
      }

      const data = await fetchEventsPayload();
      const events = Array.isArray(data.events) ? data.events : [];
      const event = findEventById(events, input.id);

      return { lastUpdated: data.lastUpdated, event };
    },
  };

  const generateEventIcsTool = {
    name: "generate_event_ics",
    description:
      "Generate an RFC 5545 iCalendar (.ics) string for a single CalEvents event by id, suitable for adding to a calendar. Times use America/Los_Angeles. Returns the ics text, or an error if the id is not found.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The event id to export.",
        },
      },
      required: ["id"],
    },
    annotations: { readOnlyHint: true },
    execute: async function executeGenerateEventIcs(input) {
      input = input ?? {};
      if (!input.id) {
        return { error: "id is required", ics: null };
      }

      const data = await fetchEventsPayload();
      const events = Array.isArray(data.events) ? data.events : [];
      const event = findEventById(events, input.id);
      if (!event) {
        return { error: `no event found for id ${input.id}`, ics: null };
      }

      return {
        id: event.id,
        filename: `event-${String(event.id).replace(/[^\w.-]+/g, "_")}.ics`,
        ics: buildEventIcs(event),
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
      navigator.modelContext.registerTool(getEventByIdTool);
      navigator.modelContext.registerTool(generateEventIcsTool);
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
