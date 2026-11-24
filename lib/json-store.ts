import "server-only";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { withProcessLock } from "./process-lock";

export type WriteJsonOptions = { mode?: number };
export type ReadJsonOptions = { tolerateInvalid?: boolean };

/** Read a JSON file, returning fallback() when missing (and optionally when malformed). */
export function readJsonFile<T>(filePath: string, fallback: () => T, opts?: ReadJsonOptions): T {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT" || opts?.tolerateInvalid) return fallback();
    throw e;
  }
}

/** Write JSON atomically via a unique temp file in the target directory, optionally locking down file permissions before rename. */
export function writeJsonAtomic(filePath: string, data: unknown, opts?: WriteJsonOptions): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2), opts?.mode !== undefined ? { mode: opts.mode } : undefined);
    if (opts?.mode !== undefined) {
      try { chmodSync(tmp, opts.mode); } catch { /* ignore on filesystems without POSIX modes */ }
    }
    renameSync(tmp, filePath);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* ignore cleanup error */ }
    throw e;
  }
}

/** Serialized read-modify-write across processes using data/.locks/ and atomic rename. */
export async function updateJsonLocked<T, R = T>(
  lockName: string,
  filePath: string,
  fallback: () => T,
  mutator: (current: T) => Promise<{ next: T; result: R }> | { next: T; result: R },
  opts?: WriteJsonOptions & ReadJsonOptions,
): Promise<R> {
  return withProcessLock(lockName, async () => {
    const current = readJsonFile(filePath, fallback, opts);
    const { next, result } = await mutator(current);
    writeJsonAtomic(filePath, next, opts);
    return result;
  });
}
