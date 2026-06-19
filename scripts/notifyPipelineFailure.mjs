/**
 * Open or update a GitHub issue when an automation workflow fails.
 *
 * Requires `gh` CLI and GITHUB_TOKEN with issues:write.
 */

import { execFileSync } from "node:child_process";

const REPO = process.env.GITHUB_REPOSITORY;
const RUN_ID = process.env.GITHUB_RUN_ID;
const SERVER_URL = process.env.GITHUB_SERVER_URL ?? "https://github.com";
const WORKFLOW_NAME = process.env.WORKFLOW_NAME ?? "Events pipeline";
const FAILURE_CONTEXT = process.env.FAILURE_CONTEXT ?? "unknown step";
const ISSUE_LABEL = process.env.ISSUE_LABEL ?? "pipeline-failure";
const ISSUE_LABEL_COLOR = process.env.ISSUE_LABEL_COLOR ?? "B60205";
const ISSUE_LABEL_DESCRIPTION =
  process.env.ISSUE_LABEL_DESCRIPTION ??
  "Automated pipeline failure requiring operator attention";

// This script is the safety net that tells operators a workflow broke. It must
// never fail the workflow itself — a crashing failure-notifier means the team
// gets no signal precisely when something is already wrong. Every exit path
// below is exit(0); problems are logged as warnings only.
if (!REPO || !RUN_ID) {
  console.warn(
    "[notifyPipelineFailure] GITHUB_REPOSITORY and GITHUB_RUN_ID are required; skipping notification",
  );
  process.exit(0);
}

function gh(args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

const runUrl = `${SERVER_URL}/${REPO}/actions/runs/${RUN_ID}`;
const title = `${WORKFLOW_NAME} failed — ${new Date().toISOString().slice(0, 10)}`;
const body = [
  `${WORKFLOW_NAME} failed during **${FAILURE_CONTEXT}**.`,
  "",
  `- Workflow run: ${runUrl}`,
  `- Repository: ${REPO}`,
  "",
  "Check the run logs, fix the upstream source or pipeline issue, then re-run the workflow.",
].join("\n");

try {
  const listed = gh([
    "label",
    "list",
    "--repo",
    REPO,
    "--search",
    ISSUE_LABEL,
    "--json",
    "name",
  ]);
  const labels = JSON.parse(listed || "[]");
  const exists = labels.some((l) => l.name === ISSUE_LABEL);
  if (!exists) {
    gh([
      "label",
      "create",
      ISSUE_LABEL,
      "--repo",
      REPO,
      "--color",
      ISSUE_LABEL_COLOR,
      "--description",
      ISSUE_LABEL_DESCRIPTION,
    ]);
  }
} catch (labelError) {
  console.warn(
    `[notifyPipelineFailure] could not ensure pipeline-failure label: ${labelError instanceof Error ? labelError.message : labelError}`,
  );
}

let issueNumber;
try {
  const listed = gh([
    "issue",
    "list",
    "--repo",
    REPO,
    "--label",
    ISSUE_LABEL,
    "--state",
    "open",
    "--limit",
    "1",
    "--json",
    "number",
  ]);
  const parsed = JSON.parse(listed || "[]");
  issueNumber = parsed[0]?.number;
} catch (listError) {
  console.warn(
    `[notifyPipelineFailure] could not list open failure issues: ${listError instanceof Error ? listError.message : listError}`,
  );
}

try {
  if (issueNumber) {
    gh([
      "issue",
      "comment",
      String(issueNumber),
      "--repo",
      REPO,
      "--body",
      body,
    ]);
    console.log(
      `[notifyPipelineFailure] commented on existing issue #${issueNumber}`,
    );
  } else {
    const createdUrl = gh([
      "issue",
      "create",
      "--repo",
      REPO,
      "--title",
      title,
      "--body",
      body,
      "--label",
      ISSUE_LABEL,
    ]);
    console.log(`[notifyPipelineFailure] created ${createdUrl}`);
  }
} catch (notifyError) {
  // Best-effort: log but never fail the workflow. An undelivered notification
  // is bad; a crashing notifier that hides the original failure is worse.
  console.warn(
    `[notifyPipelineFailure] failed to deliver operator notification: ${notifyError instanceof Error ? notifyError.message : notifyError}`,
  );
  process.exit(0);
}
