import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("atomicWriteJsonSync writes valid JSON via rename", async () => {
  const { atomicWriteJsonSync } = await import("../lib/atomicWrite.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-write-"));
  const target = path.join(dir, "events.json");

  atomicWriteJsonSync(target, { events: [], ok: true }, 2);

  const contents = fs.readFileSync(target, "utf8");
  assert.deepEqual(JSON.parse(contents), { events: [], ok: true });
  assert.equal(fs.readdirSync(dir).length, 1);
});

test("atomic write leaves the original file intact and cleans up tmp when rename fails", async () => {
  const { atomicWriteFileSync, __setRenameSyncImplForTests } =
    await import("../lib/atomicWrite.ts");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-write-"));
  const target = path.join(dir, "events.json");
  const original = JSON.stringify({ events: [{ id: "stable" }] }, null, 2);
  fs.writeFileSync(target, original, "utf8");

  __setRenameSyncImplForTests(() => {
    throw new Error("rename failed");
  });

  try {
    assert.throws(
      () => atomicWriteFileSync(target, '{"events":[{"id":"partial"'),
      /rename failed/,
    );
  } finally {
    __setRenameSyncImplForTests();
  }

  assert.equal(fs.readFileSync(target, "utf8"), original);
  const leftovers = fs
    .readdirSync(dir)
    .filter((name) => name.includes(".tmp-"));
  assert.equal(
    leftovers.length,
    0,
    "temp file must be cleaned up after a failed rename, not leaked",
  );
});
