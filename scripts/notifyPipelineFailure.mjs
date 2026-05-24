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

if (!REPO || !RUN_ID) {
  console.error(
    "[notifyPipelineFailure] GITHUB_REPOSITORY and GITHUB_RUN_ID are required",
  );
  process.exit(1);
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
  gh(["label", "list", "--repo", REPO, "--limit", "200"]);
} catch {
  try {
    gh([
      "label",
      "create",
      "pipeline-failure",
      "--repo",
      REPO,
      "--color",
      "B60205",
      "--description",
      "Automated pipeline failure requiring operator attention",
    ]);
  } catch (labelError) {
    console.warn(
      `[notifyPipelineFailure] could not ensure pipeline-failure label: ${labelError instanceof Error ? labelError.message : labelError}`,
    );
  }
}

let issueNumber;
try {
  const listed = gh([
    "issue",
    "list",
    "--repo",
    REPO,
    "--label",
    "pipeline-failure",
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

if (issueNumber) {
  gh(["issue", "comment", String(issueNumber), "--repo", REPO, "--body", body]);
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
    "pipeline-failure",
  ]);
  console.log(`[notifyPipelineFailure] created ${createdUrl}`);
}
