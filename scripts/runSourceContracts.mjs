/**
 * Lightweight live contract checks against Berkeley source endpoints.
 * Does not run full adapters — only verifies endpoints are reachable and
 * still return parseable payloads.
 *
 * Exit policy: only a CRITICAL source (livewhale, the campus-calendar backbone)
 * failing its contract exits non-zero. A supplementary source going dark is
 * reported, annotated, and flagged for operator notification via GITHUB_OUTPUT,
 * but does not fail the check — one dead scraper must not turn the whole
 * contract suite red and hide the health of the other ten sources.
 *
 * Run: node scripts/runSourceContracts.mjs
 */

import {
  CONTRACTS,
  runAllContracts,
  writeGithubOutputs,
} from "./lib/sourceContracts.mjs";

const { criticalFailures, supplementaryFailures, total } =
  await runAllContracts(CONTRACTS);

for (const { name, message } of supplementaryFailures) {
  console.log(
    `::warning::Supplementary source contract failed: ${name} (${message})`,
  );
}

const failed = [...criticalFailures, ...supplementaryFailures];
const outputResult = writeGithubOutputs({
  failed_sources: failed.map((f) => f.name).join(","),
  has_failures: failed.length > 0 ? "true" : "false",
});
if (!outputResult.ok) {
  console.warn(
    `[contracts] could not write GITHUB_OUTPUT: ${outputResult.error}`,
  );
}

if (criticalFailures.length > 0) {
  for (const { name, message } of criticalFailures) {
    console.log(
      `::error::Critical source contract failed: ${name} (${message})`,
    );
  }
  console.error(
    `[contracts] ${criticalFailures.length} critical source contract(s) failed: ${criticalFailures
      .map((f) => f.name)
      .join(", ")}`,
  );
  process.exit(1);
}

if (failed.length > 0 && outputResult.attempted && !outputResult.ok) {
  console.log(
    "::error::Source contract failures were detected, but workflow outputs could not be written for notification",
  );
  process.exit(1);
}

if (supplementaryFailures.length > 0) {
  console.warn(
    `[contracts] ${supplementaryFailures.length}/${total} supplementary source contract(s) failed: ${supplementaryFailures
      .map((f) => f.name)
      .join(", ")} — not blocking`,
  );
  process.exit(0);
}

console.log(`[contracts] all ${total} source contracts passed`);
