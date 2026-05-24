/**
 * Post-ingestion health check for CI. Emits GitHub Actions warnings when the
 * feed is degraded or stale. Always exits 0 so warnings do not block the PR.
 *
 * Run: node scripts/checkFeedHealth.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const statusPath = path.join(rootDir, "public", "status.json");

const STALE_HOURS = Number(process.env.FEED_STALE_HOURS ?? 36);

function warn(message) {
  console.log(`::warning::${message}`);
}

const raw = fs.readFileSync(statusPath, "utf8");
const status = JSON.parse(raw);

if (status.degraded) {
  const detail =
    status.degraded_reason ??
    (Array.isArray(status.degraded_sources)
      ? status.degraded_sources.join(", ")
      : "unknown");
  warn(`Feed degraded after ingestion: ${detail}`);
}

if (status.fallback_used) {
  const sources = Array.isArray(status.fallback_sources)
    ? status.fallback_sources.join(", ")
    : "unknown";
  const age =
    typeof status.fallback_age_hours === "number"
      ? `${status.fallback_age_hours}h`
      : "unknown age";
  warn(`Fallback data in use for: ${sources} (${age})`);
}

if (status.data_quality_blocked) {
  warn("Data quality gate blocked publishing fresh events");
}

const generatedAt = Date.parse(status.generated_at);
if (Number.isFinite(generatedAt)) {
  const ageHours = (Date.now() - generatedAt) / 3_600_000;
  if (ageHours > STALE_HOURS) {
    warn(
      `status.json is ${Math.round(ageHours)}h old (threshold ${STALE_HOURS}h)`,
    );
  }
}

console.log(
  `[checkFeedHealth] ok — ${status.total_events} events, degraded=${Boolean(status.degraded)}`,
);
