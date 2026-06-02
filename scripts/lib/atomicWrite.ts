import * as fs from "fs";
import * as path from "path";

let renameSyncImpl: typeof fs.renameSync = fs.renameSync.bind(fs);

/**
 * Write file contents atomically via a sibling .tmp file + rename.
 * Readers never see a partial file if the process is killed mid-write.
 */
export function atomicWriteFileSync(filePath: string, contents: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, contents, "utf8");
  try {
    renameSyncImpl(tmpPath, filePath);
  } catch (err) {
    // e.g. EXDEV on a cross-device mount. Don't leak the temp file across
    // repeated cron failures; best-effort cleanup, then surface the error.
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // tmp file already gone or unremovable — nothing more we can do.
    }
    throw err;
  }
}

export function __setRenameSyncImplForTests(
  impl: typeof fs.renameSync = fs.renameSync.bind(fs),
): void {
  renameSyncImpl = impl;
}

export function atomicWriteJsonSync(
  filePath: string,
  value: unknown,
  space?: number,
): void {
  const contents =
    typeof space === "number"
      ? JSON.stringify(value, null, space)
      : JSON.stringify(value);
  atomicWriteFileSync(filePath, contents);
}
