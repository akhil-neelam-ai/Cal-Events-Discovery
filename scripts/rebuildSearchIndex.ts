/**
 * Rebuild public/search-index.json from the committed public/events.json.
 * Run it after a change to the stemmer, the tokenizer, or the venue aliases,
 * so the index matches the query side without waiting for the daily run.
 *
 * Usage: npm run rebuild-index
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { atomicWriteJsonSync } from "./lib/atomicWrite.js";
import { buildSearchIndex } from "./lib/buildIndex.js";
import type { LegacyCalEvent } from "./lib/schema.js";

const publicDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
);
const payload = JSON.parse(
  fs.readFileSync(path.join(publicDir, "events.json"), "utf8"),
) as { events?: LegacyCalEvent[] };

if (!Array.isArray(payload.events) || payload.events.length === 0) {
  console.error("[rebuild-index] public/events.json has no events");
  process.exit(1);
}

const index = buildSearchIndex(payload.events);
atomicWriteJsonSync(path.join(publicDir, "search-index.json"), index);
console.log(
  `[rebuild-index] ${payload.events.length} events → ${Object.keys(index.t).length} title stems`,
);
