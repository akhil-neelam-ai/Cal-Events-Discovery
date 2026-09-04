/**
 * Guards on the two workflow invariants that keep fresh events reaching
 * production. Both were violated in 2026-08 and the site served six-day-old
 * data as a result, with every test green the whole time:
 *
 *   1. The daily updater must never treat an unvalidated AUTOMATION_PR_TOKEN
 *      as usable. An expired PAT died at `git push` with a credential-prompt
 *      message, discarding a fully validated snapshot.
 *   2. Something must run on a schedule to notice that publishing stopped.
 *      Production Smoke was push-triggered only, so it only ever ran moments
 *      after a successful publish — exactly when data cannot be stale.
 *
 * These assert on workflow text because the repo has no YAML parser and the
 * workflow jobs themselves run bare Node without npm ci.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PublishedEventsPayloadSchema } from "../lib/schema.ts";
import { assignTopicsResiliently } from "../lib/topicAssignmentResilience.ts";
import { TOPIC_VOCABULARY } from "../lib/topics.ts";
import { buildStatusBanner } from "../../utils/statusUi.ts";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const workflowsDir = path.join(rootDir, ".github", "workflows");

function readWorkflow(name) {
  return fs.readFileSync(path.join(workflowsDir, name), "utf8");
}

const updateEvents = readWorkflow("update-events.yml");
const productionSmoke = readWorkflow("production-smoke.yml");

function legacy(overrides = {}) {
  return {
    id: "livewhale_evt-1",
    title: "Sample Event",
    organizer: "Berkeley",
    date: "2026-09-10",
    time: "12:00 PM",
    location: "Campus",
    description: "",
    tags: ["Academic"],
    topics: [],
    url: "https://example.com/events/evt-1",
    source: "livewhale",
    ...overrides,
  };
}

function candidate(event) {
  return { published: event, source: event };
}

test("updater validates AUTOMATION_PR_TOKEN before running the pipeline", () => {
  assert.match(
    updateEvents,
    /id: token_check/,
    "update-events.yml must have a token_check step",
  );

  const checkIndex = updateEvents.indexOf("id: token_check");
  const generateIndex = updateEvents.indexOf("name: Generate events snapshot");

  assert.ok(checkIndex >= 0 && generateIndex >= 0);
  assert.ok(
    checkIndex < generateIndex,
    "token_check must run before the pipeline does its work, so an unusable token is reported in seconds rather than after a full run",
  );
});

test("snapshot PR never uses an unvalidated automation token", () => {
  const tokenLine = updateEvents
    .split("\n")
    .find((line) => line.trim().startsWith("token: "));

  assert.ok(tokenLine, "create-pull-request must pass an explicit token");
  assert.match(
    tokenLine,
    /steps\.token_check\.outputs\.usable == 'true'/,
    "the automation token must be gated on token_check; falling back to github.token keeps the snapshot publishable when the PAT is broken",
  );
  assert.match(
    tokenLine,
    /github\.token/,
    "there must be a GITHUB_TOKEN fallback so a broken PAT does not discard the day's snapshot",
  );
});

test("auto-merge is gated on a validated token, not merely a present one", () => {
  assert.ok(
    !/if: \$\{\{ steps\.create_pr\.outputs\.pull-request-number && env\.AUTOMATION_PR_TOKEN != '' \}\}/.test(
      updateEvents,
    ),
    "a set-but-expired token would satisfy a non-empty check and then fail at the merge",
  );
  assert.match(
    updateEvents,
    /if: \$\{\{ steps\.create_pr\.outputs\.pull-request-number && steps\.token_check\.outputs\.usable == 'true' \}\}/,
  );
});

test("a degraded token run still fails, so notify-failure alerts", () => {
  assert.match(
    updateEvents,
    /name: Fail run when automation token is unusable/,
    "publishing via the GITHUB_TOKEN fallback is a degraded state and must not report success",
  );

  const failIndex = updateEvents.indexOf(
    "name: Fail run when automation token is unusable",
  );
  const createIndex = updateEvents.indexOf("id: create_pr");

  assert.ok(
    createIndex < failIndex,
    "the run must fail only after the snapshot PR is open, so the data is recoverable by a manual merge",
  );
});

test("production staleness is checked on a schedule, not only on push", () => {
  assert.match(
    productionSmoke,
    /^\s{2}schedule:\s*$/m,
    "production-smoke.yml needs a schedule trigger; a push-only check runs when data is freshest by construction and cannot detect that publishing stopped",
  );
  assert.match(
    productionSmoke,
    /- cron: "[^"]+"/,
    "the schedule trigger needs a cron expression",
  );
});

test("failure notifiers can resolve the steps that failed", () => {
  for (const [name, workflow] of [
    ["update-events.yml", updateEvents],
    ["production-smoke.yml", productionSmoke],
  ]) {
    const notifyIndex = workflow.indexOf("notify-failure:");
    assert.ok(notifyIndex >= 0, `${name} must have a notify-failure job`);

    const notifyJob = workflow.slice(notifyIndex);
    assert.match(
      notifyJob,
      /actions: read/,
      `${name} notify-failure needs actions:read, or every failure comment reads identically regardless of cause`,
    );
  }
});

test("topic assignment failure preserves a publishable event snapshot", () => {
  const previous = legacy({ topics: ["law"] });
  const newEvent = legacy({
    id: "livewhale_new",
    title: "New Event",
    url: "https://example.com/events/new",
  });

  const result = assignTopicsResiliently(
    [candidate(legacy()), candidate(newEvent)],
    [previous],
    () => {
      throw new Error("assignment rules unavailable");
    },
  );

  assert.deepEqual(result.events[0].topics, ["law"]);
  assert.deepEqual(result.events[1].topics, []);
  assert.deepEqual(result.status, {
    outcome: "error",
    assigned_count: 0,
    carried_forward_count: 1,
    error: "assignment rules unavailable",
  });

  assert.equal(
    PublishedEventsPayloadSchema.safeParse({
      events: result.events,
      sources: [],
      lastUpdated: Date.now(),
      data_age_hours: 0,
      degraded_sources: [],
      topic_vocabulary: TOPIC_VOCABULARY,
    }).success,
    true,
    "a topic failure must still leave a valid payload for events.json",
  );
});

test("topic assignment failure does not activate degraded-source banners", () => {
  const status = {
    generated_at: "2026-09-04T12:00:00.000Z",
    total_events: 1,
    duplicates_removed: 0,
    past_events_filtered: 0,
    invalid_events_filtered: 0,
    topics: {
      outcome: "error",
      assigned_count: 0,
      carried_forward_count: 1,
      error: "assignment rules unavailable",
    },
    sources: [],
    fallback_used: false,
    degraded: false,
    last_good_used: 0,
    fallback_sources: [],
    degraded_sources: [],
    stale_fallback_sources: [],
  };

  assert.equal(status.degraded, false);
  assert.deepEqual(status.degraded_sources, []);
  assert.equal(buildStatusBanner(status), null);
});

test("an unassigned new event publishes with an empty topics list", () => {
  const event = legacy({
    id: "livewhale_new",
    title: "New Event",
    url: "https://example.com/events/new",
  });
  const result = assignTopicsResiliently([candidate(event)], [], () => []);

  assert.deepEqual(result.events[0].topics, []);
  assert.deepEqual(result.status, {
    outcome: "ok",
    assigned_count: 0,
    carried_forward_count: 0,
  });
});

test("an empty assignment keeps topics for an event seen yesterday", () => {
  const event = legacy({ topics: [] });
  const result = assignTopicsResiliently(
    [candidate(event)],
    [legacy({ topics: ["law"] })],
    () => [],
  );

  assert.deepEqual(result.events[0].topics, ["law"]);
  assert.deepEqual(result.status, {
    outcome: "ok",
    assigned_count: 0,
    carried_forward_count: 1,
  });
});

test("successful topic assignment reports assigned and carry-forward counts", () => {
  const assigned = legacy();
  const result = assignTopicsResiliently(
    [candidate(assigned)],
    [legacy({ topics: ["law"] })],
    () => ["ai-machine-learning"],
  );

  assert.deepEqual(result.events[0].topics, ["ai-machine-learning"]);
  assert.deepEqual(result.status, {
    outcome: "ok",
    assigned_count: 1,
    carried_forward_count: 0,
  });
});

test("topic assignment failures use only the data-quality issue path", () => {
  const topicStepStart = updateEvents.indexOf(
    "name: Read topic assignment status",
  );
  const searchStepStart = updateEvents.indexOf(
    "name: Corpus search-quality checks",
  );

  assert.ok(topicStepStart >= 0 && searchStepStart > topicStepStart);
  const topicRouting = updateEvents.slice(topicStepStart, searchStepStart);

  assert.match(
    topicRouting,
    /steps\.topic_assignment\.outputs\.outcome == 'error'/,
  );
  assert.match(topicRouting, /ISSUE_LABEL: data-quality/);
  assert.doesNotMatch(topicRouting, /ISSUE_LABEL: pipeline-failure/);
  assert.doesNotMatch(
    updateEvents.slice(updateEvents.indexOf("notify-failure:")),
    /topic_assignment|topics\.outcome/,
    "the publish-failure notifier must not treat a topic assignment failure as a pipeline failure",
  );
});
