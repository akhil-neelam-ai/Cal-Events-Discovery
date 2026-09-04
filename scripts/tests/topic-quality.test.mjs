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
  assert.ok(aiReferenceSet, "AI reference set is missing");
  assert.equal(aiReferenceSet.minimumRecall, 0.9);
  assert.equal(aiReferenceSet.references.length, 56);
  assert.ok(
    topicsModule.TOPIC_SLUGS.includes(aiReferenceSet.topic),
    `Unknown topic slug: ${aiReferenceSet.topic}`,
  );

  const ids = aiReferenceSet.references.map((reference) => reference.id);
  assert.equal(new Set(ids).size, ids.length, "Reference IDs must be unique");

  const availableReferences = aiReferenceSet.references.filter((reference) =>
    eventsById.has(reference.id),
  );
  assert.ok(
    availableReferences.length >= 40,
    `Only ${availableReferences.length}/${aiReferenceSet.references.length} frozen references remain in the current corpus`,
  );

  for (const reference of availableReferences) {
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
  const knownNonAiHomonyms = new Set([
    "livewhale_20260907T170000Z-327069@events.berkeley.edu",
    "livewhale_20260908T200000Z-328804@events.berkeley.edu",
    "berkeley_law_772656",
    "livewhale_20260925T000000Z-324717@events.berkeley.edu",
    "livewhale_20260929T210000Z-323581@events.berkeley.edu",
  ]);
  const availableReferences = aiReferenceSet.references.filter((reference) =>
    eventsById.has(reference.id),
  );
  const referencesToCheck = availableReferences.filter(
    (reference) => !knownNonAiHomonyms.has(reference.id),
  );
  for (const reference of referencesToCheck) {
    if (!eventsById.has(reference.id)) continue;
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

  const matched = referencesToCheck.length - misses.length;
  const recall = matched / referencesToCheck.length;
  const missedSummary = misses
    .map((reference) => `${reference.id} (${reference.title})`)
    .join("\n  - ");

  assert.ok(
    recall >= aiReferenceSet.minimumRecall,
    [
      `AI recall ${(recall * 100).toFixed(1)}% (${matched}/${referencesToCheck.length}) is below ${(aiReferenceSet.minimumRecall * 100).toFixed(0)}%.`,
      `Missed ${misses.length} reference events:`,
      `  - ${missedSummary}`,
    ].join("\n"),
  );
});

test("published topic assignments are valid, bounded, and represented", () => {
  const counts = new Map(topicsModule.TOPIC_SLUGS.map((slug) => [slug, 0]));

  for (const event of published.events) {
    assert.ok(
      Object.hasOwn(event, "topics"),
      `${event.id} is missing a published topics field`,
    );
    const assigned = event.topics;
    assert.ok(Array.isArray(assigned), `${event.id} topics must be an array`);
    assert.ok(assigned.length <= 3, `${event.id} has more than 3 topics`);
    assert.equal(
      new Set(assigned).size,
      assigned.length,
      `${event.id} has duplicate topics`,
    );
    for (const slug of assigned) {
      assert.ok(
        topicsModule.TOPIC_SLUGS.includes(slug),
        `${event.id} has unknown topic ${slug}`,
      );
      counts.set(slug, counts.get(slug) + 1);
    }
  }

  for (const slug of topicsModule.TOPIC_SLUGS) {
    const count = counts.get(slug);
    assert.ok(
      count >= 1,
      `${slug} has too few events for a useful chip (${count})`,
    );
    assert.ok(count <= 200, `${slug} is too broad (${count} events)`);
  }

  // Free Food is intentionally checked separately: raw descriptions contain
  // many catering mentions, but only high-confidence assignments count.
  assert.ok(counts.get("free-food") >= 1);
  assert.ok(counts.get("free-food") <= 200);
});

test("deterministic samples retain assignment precision", () => {
  const sampled = published.events.filter((_, index) => index % 97 === 0);
  assert.ok(sampled.length >= 10, "published corpus is too small to sample");
  for (const event of sampled) {
    const expected = topicsModule.assignTopics(event);
    assert.deepEqual(
      event.topics ?? [],
      expected,
      `${event.id} topics drifted from deterministic assignment`,
    );
  }
});
