import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSearchIndex } from './lib/buildIndex.js';
import type { LegacyCalEvent, PublishedSource } from './lib/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const eventsPath = path.join(__dirname, '..', 'public', 'events.json');
const indexPath = path.join(__dirname, '..', 'public', 'search-index.json');

interface EventsPayload {
  events?: LegacyCalEvent[];
  sources?: PublishedSource[];
  lastUpdated?: number;
}

function main(): void {
  if (!fs.existsSync(eventsPath)) {
    throw new Error(`Missing events snapshot at ${eventsPath}`);
  }

  const payload = JSON.parse(fs.readFileSync(eventsPath, 'utf8')) as EventsPayload;
  const events = payload.events ?? [];
  const index = buildSearchIndex(events, payload.lastUpdated);

  fs.writeFileSync(indexPath, JSON.stringify(index));
  console.log(`[search-index] wrote ${events.length} events -> ${indexPath}`);
}

main();
