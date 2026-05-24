/**
 * Lightweight live contract checks against Berkeley source endpoints.
 * Does not run full adapters — only verifies endpoints are reachable and
 * still return parseable payloads.
 *
 * Run: node scripts/runSourceContracts.mjs
 */

const USER_AGENT = "Cal-Events-Discovery-Contract-Test";
const TIMEOUT_MS = 30_000;

function todayUtcIso() {
  return new Date().toISOString();
}

/** @type {Array<{ name: string, url: string, validate: (response: Response, body: string) => void }>} */
const CONTRACTS = [
  {
    name: "livewhale",
    url: "https://events.berkeley.edu/live/ical/events",
    validate(_response, body) {
      if (!/BEGIN:VCALENDAR/.test(body)) {
        throw new Error("response is not iCalendar data");
      }
      if (body.length < 10_000) {
        throw new Error(`response too short (${body.length} bytes)`);
      }
    },
  },
  {
    name: "callink",
    url: `https://callink.berkeley.edu/api/discovery/event/search?endsAfter=${encodeURIComponent(todayUtcIso())}&status=Approved&$top=5`,
    validate(response, body) {
      if (!response.headers.get("content-type")?.includes("json")) {
        throw new Error(
          `unexpected content-type: ${response.headers.get("content-type")}`,
        );
      }
      const parsed = JSON.parse(body);
      if (!Array.isArray(parsed.value)) {
        throw new Error("CampusGroups response missing value[]");
      }
    },
  },
  {
    name: "cal_performances",
    url: "https://calperformances.org/wp-json/wp/v2/cp_event?per_page=1&_fields=id,title",
    validate(_response, body) {
      const parsed = JSON.parse(body);
      if (!Array.isArray(parsed)) {
        throw new Error("WP REST response is not an array");
      }
    },
  },
  {
    name: "calbears",
    url: "https://calbears.com/calendar.ashx/calendar.ics",
    validate(_response, body) {
      if (!/BEGIN:VCALENDAR/.test(body)) {
        throw new Error("response is not iCalendar data");
      }
    },
  },
  {
    name: "bampfa",
    url: "https://bampfa.org/visit/calendar",
    validate(_response, body) {
      if (!/calendar\.google\.com\/calendar\/r\/eventedit/i.test(body)) {
        throw new Error("BAMPFA calendar page missing Google Calendar links");
      }
    },
  },
  {
    name: "haas",
    url: "https://haas.berkeley.edu/wp-json/tribe/events/v1/events?per_page=1",
    validate(_response, body) {
      const parsed = JSON.parse(body);
      if (!Array.isArray(parsed.events)) {
        throw new Error("Tribe REST response missing events[]");
      }
    },
  },
  {
    name: "berkeley_law",
    url: "https://www.law.berkeley.edu/wp-json/tribe/events/v1/events?per_page=1",
    validate(_response, body) {
      const parsed = JSON.parse(body);
      if (!Array.isArray(parsed.events)) {
        throw new Error("Tribe REST response missing events[]");
      }
    },
  },
  {
    name: "simons",
    url: "https://simons.berkeley.edu/api/events",
    validate(_response, body) {
      const parsed = JSON.parse(body);
      if (!Array.isArray(parsed)) {
        throw new Error("Simons API response is not an array");
      }
    },
  },
  {
    name: "ehub",
    url: "https://ehub.berkeley.edu/events/",
    validate(_response, body) {
      if (!/wfea-card-item|events/i.test(body)) {
        throw new Error("E-Hub events page missing expected markup");
      }
    },
  },
];

async function checkContract(contract) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(contract.url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });

    const body = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    contract.validate(response, body);
    console.log(`[contracts] ok ${contract.name}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

const failures = [];

for (const contract of CONTRACTS) {
  try {
    await checkContract(contract);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ name: contract.name, message });
    console.error(`[contracts] fail ${contract.name}: ${message}`);
  }
}

if (failures.length > 0) {
  console.error(
    `[contracts] ${failures.length}/${CONTRACTS.length} source contract(s) failed`,
  );
  process.exit(1);
}

console.log(`[contracts] all ${CONTRACTS.length} source contracts passed`);
