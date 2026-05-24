/**
 * Post-ingestion health check for CI.
 *
 * When BLOCK_ON_DEGRADED=true (default in the daily pipeline), exits non-zero
 * on blocking feed-health violations so automation cannot merge stale data.
 *
 * Run: BLOCK_ON_DEGRADED=true node scripts/checkFeedHealth.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { evaluateFeedHealth } from "./lib/feedHealthPolicy.mjs";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const statusPath = path.join(rootDir, "public", "status.json");

const BLOCK_ON_DEGRADED = /^(1|true|yes)$/i.test(
  process.env.BLOCK_ON_DEGRADED ?? "true",
);
const STALE_HOURS = Number(process.env.FEED_STALE_HOURS ?? 36);
const MAX_FALLBACK_AGE_HOURS = Number(process.env.MAX_FALLBACK_AGE_HOURS ?? 48);

function warn(message) {
  console.log(`::warning::${message}`);
}

function error(message) {
  console.log(`::error::${message}`);
}

const raw = fs.readFileSync(statusPath, "utf8");
const status = JSON.parse(raw);
const { blocking, warnings } = evaluateFeedHealth(status, {
  staleHours: STALE_HOURS,
  maxFallbackAgeHours: MAX_FALLBACK_AGE_HOURS,
});

for (const message of warnings) {
  warn(message);
}

if (blocking.length > 0) {
  for (const message of blocking) {
    error(message);
  }

  if (BLOCK_ON_DEGRADED) {
    console.error(
      `[checkFeedHealth] blocked — ${blocking.length} blocking issue(s)`,
    );
    process.exit(1);
  }

  warn(
    `Feed health has ${blocking.length} blocking issue(s), but BLOCK_ON_DEGRADED is disabled`,
  );
}

console.log(
  `[checkFeedHealth] ok — ${status.total_events} events, degraded=${Boolean(status.degraded)}, blocking=${blocking.length}, warnings=${warnings.length}`,
);
