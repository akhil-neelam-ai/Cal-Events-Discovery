/**
 * Run Node script tests under scripts/tests/, optionally excluding files.
 *
 * Usage:
 *   node scripts/runScriptTests.mjs
 *   node scripts/runScriptTests.mjs --exclude=search-quality.test.mjs
 */

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const testsDir = path.join(rootDir, "scripts", "tests");

const exclude = new Set(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--exclude="))
    .map((arg) => arg.slice("--exclude=".length)),
);

const files = readdirSync(testsDir)
  .filter((name) => name.endsWith(".test.mjs"))
  .filter((name) => !exclude.has(name))
  .sort()
  .map((name) => path.join("scripts", "tests", name));

if (files.length === 0) {
  console.error("[runScriptTests] no test files matched");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx/esm", "--test", ...files],
  { stdio: "inherit", cwd: rootDir },
);

process.exit(result.status ?? 1);
