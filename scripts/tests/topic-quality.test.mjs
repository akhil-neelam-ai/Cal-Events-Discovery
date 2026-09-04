/**
 * Frozen topic quality checks against the published corpus.
 *
 * The fixture was selected independently of assignTopics. Keep it frozen when
 * assignment weights change so recall tuning cannot move its own target.
 *
 * Run: node --import tsx/esm --test scripts/tests/topic-quality.test.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as topicsModule from "../../scripts/lib/topics.ts";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const published = JSON.parse(
  fs.readFileSync(path.join(rootDir, "public", "events.json"), "utf8"),
);
const fixture = JSON.parse(
  fs.readFileSync(
    path.join(
      rootDir,
      "scripts",
      "tests",
      "fixtures",
      "topic-reference-sets.json",
    ),
    "utf8",
  ),
);

const eventsById = new Map(published.events.map((event) => [event.id, event]));
const aiReferenceSet = fixture.referenceSets.find(
  (referenceSet) => referenceSet.topic === "ai-machine-learning",
);

test("frozen AI reference fixture is complete and matches the source corpus", () => {
  assert.equal(fixture.version, 1);
  assert.equal(fixture.selectedFrom.artifact, "public/events.json");
  assert.equal(fixture.selectedFrom.eventCount, published.events.length);
  assert.equal(fixture.selectedFrom.lastUpdated, published.lastUpdated);
  assert.ok(aiReferenceSet, "AI reference set is missing");
  assert.equal(aiReferenceSet.minimumRecall, 0.9);
  assert.equal(aiReferenceSet.references.length, 56);
  assert.ok(
    topicsModule.TOPIC_SLUGS.includes(aiReferenceSet.topic),
    `Unknown topic slug: ${aiReferenceSet.topic}`,
  );

  const ids = aiReferenceSet.references.map((reference) => reference.id);
  assert.equal(new Set(ids).size, ids.length, "Reference IDs must be unique");

  const missingIds = ids.filter((id) => !eventsById.has(id));
  assert.deepEqual(
    missingIds,
    [],
    `Reference IDs missing from public/events.json: ${missingIds.join(", ")}`,
  );

  for (const reference of aiReferenceSet.references) {
    const event = eventsById.get(reference.id);
    assert.equal(event.title, reference.title, `${reference.id} title drifted`);
    assert.equal(event.date, reference.date, `${reference.id} date drifted`);
    assert.equal(
      event.source,
      reference.source,
      `${reference.id} source drifted`,
    );
    assert.ok(
      Array.isArray(reference.signals) && reference.signals.length > 0,
      `${reference.id} needs human-readable selection evidence`,
    );
  }
});

test("AI topic assignment reaches at least 90% of the frozen reference set", () => {
  assert.equal(
    typeof topicsModule.assignTopics,
    "function",
    "Topic assignment capability is missing: export assignTopics(event) from scripts/lib/topics.ts",
  );

  const misses = [];
  for (const reference of aiReferenceSet.references) {
    const assignedTopics = topicsModule.assignTopics(
      eventsById.get(reference.id),
    );
    assert.ok(
      Array.isArray(assignedTopics),
      `assignTopics must return an array for ${reference.id}`,
    );
    if (!assignedTopics.includes(aiReferenceSet.topic)) {
      misses.push(reference);
    }
  }

  const matched = aiReferenceSet.references.length - misses.length;
  const recall = matched / aiReferenceSet.references.length;
  const missedSummary = misses
    .map((reference) => `${reference.id} (${reference.title})`)
    .join("\n  - ");

  assert.ok(
    recall >= aiReferenceSet.minimumRecall,
    [
      `AI recall ${(recall * 100).toFixed(1)}% (${matched}/${aiReferenceSet.references.length}) is below ${(aiReferenceSet.minimumRecall * 100).toFixed(0)}%.`,
      `Missed ${misses.length} reference events:`,
      `  - ${missedSummary}`,
    ].join("\n"),
  );
});
