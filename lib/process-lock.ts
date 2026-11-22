import "server-only";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

export class ProcessBusyError extends Error {
  constructor(name: string) { super(`${name} is already running on this computer.`); }
}

/** Atomic lock for the app and its scheduled scripts on the same computer. */
export async function withProcessLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  const root = join(process.cwd(), "data", ".locks");
  mkdirSync(root, { recursive: true });
  const dir = join(root, encodeURIComponent(name));
  const acquire = () => { mkdirSync(dir); writeFileSync(join(dir, "owner.json"), JSON.stringify({ pid: process.pid, host: hostname(), at: Date.now() })); };
  try { acquire(); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const owner = (() => { try { return JSON.parse(readFileSync(join(dir, "owner.json"), "utf8")) as { pid: number; host: string; at: number }; } catch { return null; } })();
    let alive = false;
    if (owner?.host === hostname() && Number.isInteger(owner.pid)) {
      try { process.kill(owner.pid, 0); alive = true; } catch (err) { alive = (err as NodeJS.ErrnoException).code === "EPERM"; }
    }
    // Keep an unknown owner briefly; a competing process may still be writing owner.json.
    const freshUnknown = !owner && (() => { try { return Date.now() - statSync(dir).mtimeMs < 30_000; } catch { return true; } })();
    if (alive || freshUnknown || (owner ? owner.host !== hostname() && Date.now() - owner.at < 30 * 60_000 : false)) throw new ProcessBusyError(name);
    try { rmSync(dir, { recursive: true, force: true }); acquire(); }
    catch { throw new ProcessBusyError(name); }
  }
  try { return await work(); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
