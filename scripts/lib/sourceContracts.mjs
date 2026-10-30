/**
 * Live contract definitions for Berkeley source endpoints.
 *
 * Split out from `scripts/runSourceContracts.mjs` so the contract list can be
 * imported by tests without executing the live checks, and so the critical /
 * supplementary split can be asserted against `scripts/lib/feedHealthPolicy.ts`.
 *
 * Plain .mjs (not .ts) on purpose: the Source Contracts workflow runs
 * `node scripts/runSourceContracts.mjs` with no `npm ci`, so this file must be
 * loadable by bare Node with no loader and no dependencies.
 */

import fs from "node:fs";

const USER_AGENT = "Cal-Events-Discovery-Contract-Test";
const TIMEOUT_MS = 30_000;

/**
 * Contract-check counterpart of CRITICAL_SOURCES in scripts/lib/feedHealthPolicy.ts.
 * Duplicated rather than imported because that module is TypeScript and this one
 * must run under bare Node; scripts/tests/feed-health.test.mjs asserts the two
 * sets stay identical.
 *
 * Only a critical source failing its contract is worth breaking the build. Every
 * other source is supplementary — scraped from fragile endpoints or naturally
 * sparse between terms — so its failure is reported and notified, but must not
 * take the whole check red and mask the health of the other sources.
 */
export const CRITICAL_CONTRACT_SOURCES = new Set(["livewhale"]);

/** LiveWhale's one-day window for today (UTC date; end_date is exclusive). */
function liveWhaleDayWindowUrl() {
  const start = new Date();
  const end = new Date(start.getTime() + 86_400_000);
  const key = (date) => date.toISOString().slice(0, 10);
  return `https://events.berkeley.edu/live/ical/events/start_date/${key(start)}/end_date/${key(end)}`;
}

/** @type {Array<{ name: string, url: string, validate: (response: Response, body: string) => void }>} */
export const CONTRACTS = [
  {
    // The adapter reads date windows (scripts/sources/livewhale.ts). A
    // one-day window is the smallest one it falls back to, so a cut-off body
    // here means the adapter would fail too.
    name: "livewhale",
    url: liveWhaleDayWindowUrl(),
    validate(_response, body) {
      if (!/BEGIN:VCALENDAR/.test(body)) {
        throw new Error("response is not iCalendar data");
      }
      if (!body.trimEnd().endsWith("END:VCALENDAR")) {
        throw new Error("response is a cut-off iCalendar (no END:VCALENDAR)");
      }
      // Every campus day has events, so an empty calendar means the window
      // URL shape stopped matching.
      if (!body.includes("BEGIN:VEVENT")) {
        throw new Error("response is an iCalendar with no events");
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
    // First calendar in BERKELEY_LUMA_CALENDARS (scripts/sources/luma.ts).
    // We only verify the API shape (`entries` array present), not event count —
    // calendars are intentionally allowed to be empty between terms.
    name: "luma",
    url: "https://api.lu.ma/calendar/get-items?calendar_api_id=cal-4TEeXLXVUtUqg91&pagination_limit=1",
    validate(_response, body) {
      const parsed = JSON.parse(body);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !Array.isArray(parsed.entries)
      ) {
        throw new Error("Luma response missing expected `entries` array");
      }
    },
  },
  {
    // BEGIN (Berkeley Gateway to Innovation) — public iCal feed read by
    // scripts/sources/begin.ts. The old Tribe REST endpoint returns 410.
    name: "begin",
    url: "https://begin.berkeley.edu/api/public/events.ics",
    validate(_response, body) {
      if (!/BEGIN:VCALENDAR/.test(body)) {
        throw new Error("BEGIN response is not iCalendar data");
      }
    },
  },
  {
    name: "ai_risk",
    url: "https://ai-risk.berkeley.edu/events.json",
    validate(_response, body) {
      const parsed = JSON.parse(body);
      if (!parsed || !Array.isArray(parsed.events)) {
        throw new Error("AI Risk events.json missing expected `events` array");
      }
      const [first] = parsed.events;
      if (
        first &&
        (typeof first.slug !== "string" || typeof first.start !== "string")
      ) {
        throw new Error("AI Risk events.json entries missing slug or start");
      }
    },
  },
  {
    name: "brsl",
    url: "https://brsl.berkeley.edu/wp-json/tribe/events/v1/events?per_page=1",
    validate(_response, body) {
      const parsed = JSON.parse(body);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !Array.isArray(parsed.events)
      ) {
        throw new Error("BRSL Tribe response missing expected `events` array");
      }
    },
  },
  {
    name: "cltc",
    url: "https://cltc.berkeley.edu/wp-json/tribe/events/v1/events?per_page=1",
    validate(_response, body) {
      const parsed = JSON.parse(body);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !Array.isArray(parsed.events)
      ) {
        throw new Error("CLTC Tribe response missing expected `events` array");
      }
    },
  },
];

export async function checkContract(contract) {
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
  } finally {
    clearTimeout(timeoutId);
  }
}

export function writeGithubOutputs(
  outputs,
  {
    outputPath = process.env.GITHUB_OUTPUT,
    appendFileSync = fs.appendFileSync,
  } = {},
) {
  if (!outputPath) return { attempted: false, ok: true };

  try {
    const lines = Object.entries(outputs).map(
      ([key, value]) => `${key}=${value}`,
    );
    appendFileSync(outputPath, `${lines.join("\n")}\n`);
    return { attempted: true, ok: true };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Run every contract and partition the failures by severity.
 * Never throws — a contract that blows up is recorded, not propagated, so one
 * dead endpoint cannot abort the checks for the sources after it.
 */
export async function runAllContracts(
  contracts = CONTRACTS,
  check = checkContract,
) {
  const criticalFailures = [];
  const supplementaryFailures = [];

  for (const contract of contracts) {
    try {
      await check(contract);
      console.log(`[contracts] ok ${contract.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failure = { name: contract.name, message };
      if (CRITICAL_CONTRACT_SOURCES.has(contract.name)) {
        criticalFailures.push(failure);
      } else {
        supplementaryFailures.push(failure);
      }
      console.error(`[contracts] fail ${contract.name}: ${message}`);
    }
  }

  return { criticalFailures, supplementaryFailures, total: contracts.length };
}
