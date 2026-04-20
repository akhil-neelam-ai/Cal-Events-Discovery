import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSearchIndex } from './lib/buildIndex.js';
import type { LegacyCalEvent, PublishedSource, StatusReport } from './lib/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const eventsPath = path.join(__dirname, '..', 'public', 'events.json');
const indexPath = path.join(__dirname, '..', 'public', 'search-index.json');
const statusPath = path.join(__dirname, '..', 'public', 'status.json');

interface EventsPayload {
  events?: LegacyCalEvent[];
  sources?: PublishedSource[];
  lastUpdated?: number;
}

function readStatusTimestamp(): string | undefined {
  if (!fs.existsSync(statusPath)) {
    return undefined;
  }

  const status = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as Partial<StatusReport>;
  return typeof status.generated_at === 'string' ? status.generated_at : undefined;
}

function main(): void {
  if (!fs.existsSync(eventsPath)) {
    throw new Error(`Missing events snapshot at ${eventsPath}`);
  }

  const payload = JSON.parse(fs.readFileSync(eventsPath, 'utf8')) as EventsPayload;
  const events = payload.events ?? [];
  const buildAt = readStatusTimestamp()
    ?? (typeof payload.lastUpdated === 'number' ? new Date(payload.lastUpdated).toISOString() : undefined);
  const index = buildSearchIndex(events, buildAt);

  fs.writeFileSync(indexPath, JSON.stringify(index));
  console.log(`[search-index] wrote ${events.length} events -> ${indexPath}`);
}

main();
