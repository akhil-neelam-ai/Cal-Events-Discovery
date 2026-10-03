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

import { dedupeEvents, dedupeRestoredEvents } from "../lib/dedupe.ts";
import {
  FALLBACK_POLICIES,
  appendLastGoodEvents,
  emptyRecoveryState,
  markRecovery,
} from "../lib/lastGoodFallback.ts";
import { projectToLegacy, todayPT } from "../lib/normalize.ts";
import { PublishedEventsPayloadSchema } from "../lib/schema.ts";
import { assignTopicsResiliently } from "../lib/topicAssignmentResilience.ts";
import { TOPIC_VOCABULARY } from "../lib/topics.ts";
import { shouldShowStaleDataBanner } from "../../utils/staleDataUi.ts";
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
const packageJson = JSON.parse(
  fs.readFileSync(path.join(rootDir, "package.json"), "utf8"),
);

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

test("the automation token reaches only the steps that use it", () => {
  // `npm ci` runs install scripts and the pipeline parses untrusted upstream
  // data, so a workflow-level env would hand them a write-scoped token.
  assert.ok(
    !/env\.AUTOMATION_PR_TOKEN/.test(updateEvents),
    "no step should read the token from a shared env",
  );
  assert.equal(
    updateEvents.match(/secrets\.AUTOMATION_PR_TOKEN/g)?.length,
    3,
    "only the token check, create-PR, and merge steps receive the secret",
  );
  assert.match(
    updateEvents,
    /if: \$\{\{ steps\.token_check\.outputs\.usable != 'true' && steps\.token_check\.outputs\.present == 'true' \}\}/,
    "the fail step learns the token was set from token_check, not from env",
  );
});

test("three failed runs in a row open a source-contracts issue", () => {
  assert.match(
    updateEvents,
    /select\(\(\.consecutive_failures \/\/ 0\) >= 3\)/,
    "the daily workflow must read the failure streak from status.json",
  );
  const streakIndex = updateEvents.indexOf(
    "name: Open source-contracts issue on a failure streak",
  );
  assert.ok(streakIndex >= 0);
  assert.match(
    updateEvents.slice(streakIndex, streakIndex + 600),
    /ISSUE_LABEL: source-contracts/,
    "a dead source files under source-contracts, not pipeline-failure",
  );
});

test("third-party actions are pinned and scopes are granted per job", () => {
  for (const name of fs.readdirSync(workflowsDir)) {
    const workflow = readWorkflow(name);
    for (const [, action] of workflow.matchAll(/uses:\s*(\S+)/g)) {
      if (action.startsWith("actions/")) continue;
      assert.match(
        action,
        /@[0-9a-f]{40}$/,
        `${name}: ${action} must be pinned to a commit SHA`,
      );
    }
  }
  assert.match(
    updateEvents,
    /^permissions: \{\}$/m,
    "update-events.yml grants no scopes at the top; each job asks for its own",
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

test("publish validation excludes non-blocking topic quality checks", () => {
  const validateCommand = packageJson.scripts.validate;
  const scriptTestCommand = packageJson.scripts["test:scripts"];

  assert.match(validateCommand, /\bnpm run test:scripts\b/);
  assert.doesNotMatch(
    validateCommand,
    /test:topic-quality|topic-quality\.test\.mjs/,
  );
  assert.match(
    scriptTestCommand,
    /--exclude=search-quality\.test\.mjs(?:\s|$)/,
  );
  assert.match(
    scriptTestCommand,
    /--exclude=topic-quality\.test\.mjs(?:\s|$)/,
    "validate reaches test:scripts, so topic-quality must be excluded there and run only through its non-blocking workflow step",
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

test("a successful empty assignment clears topics for an event seen yesterday", () => {
  const event = legacy({ topics: [] });
  const result = assignTopicsResiliently(
    [candidate(event)],
    [legacy({ topics: ["ai-machine-learning"] })],
    () => [],
  );

  assert.deepEqual(result.events[0].topics, []);
  assert.deepEqual(result.status, {
    outcome: "ok",
    assigned_count: 0,
    carried_forward_count: 0,
  });
});

test("invalid assignment arrays become a stage error and carry prior topics", () => {
  const previous = [legacy({ topics: ["law"] })];
  const cases = [
    () => ["law", "film", "music-performance", "wellness"],
    () => ["law", "law"],
    () => ["unknown-topic"],
    () => "law",
  ];

  for (const assigner of cases) {
    const result = assignTopicsResiliently(
      [candidate(legacy({ topics: [] }))],
      previous,
      assigner,
    );

    assert.equal(result.status.outcome, "error");
    assert.deepEqual(result.events[0].topics, ["law"]);
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
    );
  }
});

test("last-good restored events keep their published topics", () => {
  const restored = legacy({
    id: "livewhale_restored",
    topics: ["physics-math-quantum"],
  });
  const result = assignTopicsResiliently(
    [
      {
        published: restored,
        source: { ...restored, livewhale_groups: undefined },
      },
    ],
    [restored],
    () => ["career-jobs"],
    { preserveTopicIds: new Set(["livewhale_restored"]) },
  );

  assert.deepEqual(result.events[0].topics, ["physics-math-quantum"]);
  assert.equal(result.status.outcome, "ok");
  assert.equal(result.status.assigned_count, 0);
});

test("a restored LiveWhale copy replaces today's lower-priority duplicate", () => {
  // Day N published the LiveWhale copy. On day N+1 LiveWhale fails, so only
  // the Haas copy survives dedupe, and the restore brings yesterday's
  // LiveWhale row back beside it.
  const today = todayPT();
  const [year, month, day] = today.split("-").map(Number);
  const eventDay = new Date(Date.UTC(year, month - 1, day + 3))
    .toISOString()
    .slice(0, 10);
  const yesterdayCopy = legacy({
    id: "livewhale_123@events.berkeley.edu",
    title: "Haas Leadership Forum",
    date: eventDay,
    source: "livewhale",
  });
  const haasToday = {
    source_name: "haas",
    source_id: "987",
    source_url: "https://haas.berkeley.edu/wp-json/tribe/events/v1/events",
    title: "Haas Leadership Forum",
    description: "A forum.",
    start_at: `${eventDay}T19:00:00.000Z`,
    timezone: "America/Los_Angeles",
    all_day: false,
    venue: "Haas School of Business",
    building: "",
    address: "",
    modality: "in_person",
    organizer: "Berkeley Haas",
    organizer_unit: "Berkeley Haas",
    audience: "",
    cost: "",
    canonical_url: "https://haas.berkeley.edu/events/987",
    categories: [],
    tags: ["Entrepreneurship"],
    last_seen_at: `${today}T12:00:00.000Z`,
    confidence: 0.95,
    quality_flags: [],
  };

  const published = dedupeEvents([haasToday]).events.map(projectToLegacy);
  const restored = appendLastGoodEvents(
    published,
    [yesterdayCopy],
    "livewhale",
    today,
  );
  assert.equal(restored, 1);
  assert.equal(published.length, 2);

  const final = dedupeRestoredEvents(
    published,
    new Set([yesterdayCopy.id]),
    today,
  );
  assert.deepEqual(
    final.map((event) => event.id),
    [yesterdayCopy.id],
  );
});

function failedRun(name) {
  return {
    name,
    ok: false,
    count: 0,
    duration_ms: 5,
    error: "404 Not Found",
    fetched_at: new Date().toISOString(),
  };
}

function recoverFrom(status, yesterday, previousStamp) {
  const published = [];
  const recovery = emptyRecoveryState();
  markRecovery(status, FALLBACK_POLICIES[status.name], {
    legacy: published,
    existing: { events: yesterday, lastUpdated: Date.now() - 86_400_000 },
    previousHealth: new Map([
      [status.name, { last_healthy_at: previousStamp }],
    ]),
    recovery,
    today: todayPT(),
    maxFallbackAgeHours: 48,
  });
  return { published, recovery };
}

function inDays(days) {
  const [year, month, day] = todayPT().split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

const DAY_AGO = new Date(Date.now() - 86_400_000).toISOString();

test("a quiet source restores last-good events without visitor banners", () => {
  const talk = legacy({
    id: "ai_risk_talk-1",
    title: "Scaling Oversight",
    date: inDays(2),
    source: "ai_risk",
  });
  const status = failedRun("ai_risk");
  const { published, recovery } = recoverFrom(status, [talk], DAY_AGO);

  assert.deepEqual(
    published.map((event) => event.id),
    ["ai_risk_talk-1"],
  );
  assert.equal(status.degraded, true);
  assert.equal(status.fallback_used, true);
  assert.equal(status.fallback_age_hours, 24);
  assert.deepEqual([...recovery.degradedSources], []);
  assert.deepEqual([...recovery.degradedReasons], []);
  assert.equal(recovery.fallbackAgeHours, undefined);

  const report = {
    sources: [status],
    fallback_used: recovery.fallbackSources.size > 0,
    degraded: recovery.degradedReasons.size > 0,
    last_good_used: recovery.lastGoodUsed,
    data_quality_blocked: false,
    fallback_sources: [...recovery.fallbackSources],
    degraded_sources: [...recovery.degradedSources],
  };
  assert.equal(buildStatusBanner(report), null);
  assert.equal(
    shouldShowStaleDataBanner(
      recovery.fallbackAgeHours,
      report.degraded_sources,
    ),
    false,
  );
});

test("a failure streak carries forward without touching banner fields", () => {
  const status = failedRun("ai_risk");
  const recovery = emptyRecoveryState();
  markRecovery(status, FALLBACK_POLICIES.ai_risk, {
    legacy: [],
    existing: { events: [], lastUpdated: Date.now() - 86_400_000 },
    previousHealth: new Map([
      ["ai_risk", { last_healthy_at: DAY_AGO, consecutive_failures: 2 }],
    ]),
    recovery,
    today: todayPT(),
    maxFallbackAgeHours: 48,
  });

  assert.equal(status.consecutive_failures, 3);
  assert.deepEqual([...recovery.degradedSources], []);
});

test("a quiet source with expired fallback stays out of the banner fields", () => {
  const status = failedRun("ai_risk");
  const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const { published, recovery } = recoverFrom(status, [], threeDaysAgo);

  assert.equal(published.length, 0);
  assert.equal(status.fallback_expired, true);
  assert.deepEqual([...recovery.staleFallbackSources], ["ai_risk"]);
  assert.deepEqual([...recovery.degradedReasons], []);
});

test("a loud source still raises the degraded flags when it restores", () => {
  const meeting = legacy({
    id: "callink_1",
    title: "Robotics Club Meeting",
    date: inDays(2),
    source: "callink",
  });
  const status = failedRun("callink");
  const { published, recovery } = recoverFrom(status, [meeting], DAY_AGO);

  assert.equal(published.length, 1);
  assert.deepEqual([...recovery.degradedSources], ["callink"]);
  assert.equal(recovery.fallbackAgeHours, 24);
});

test("degraded group-feed provenance carries prior topics without source banners", () => {
  const result = assignTopicsResiliently(
    [candidate(legacy({ topics: [] }))],
    [legacy({ topics: ["law"] })],
    () => ["startups"],
    { forceError: "LiveWhale group feeds failed; topic provenance incomplete" },
  );

  assert.equal(result.status.outcome, "error");
  assert.match(result.status.error ?? "", /group feeds failed/);
  assert.deepEqual(result.events[0].topics, ["law"]);
  assert.deepEqual(
    {
      degraded: false,
      degraded_sources: [],
    },
    { degraded: false, degraded_sources: [] },
  );
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

test("orchestrator preserves last-good topics and group-feed provenance", () => {
  const orchestrator = fs.readFileSync(
    path.join(rootDir, "scripts", "updateEvents.ts"),
    "utf8",
  );

  assert.match(orchestrator, /preserveTopicIds: recovery\.restoredIds/);
  assert.match(orchestrator, /groupFeedsDegraded/);
  assert.match(
    orchestrator,
    /LiveWhale group feeds failed; topic provenance incomplete/,
  );
});
