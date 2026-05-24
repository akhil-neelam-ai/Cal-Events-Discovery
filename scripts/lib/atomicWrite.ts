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
  renameSyncImpl(tmpPath, filePath);
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
