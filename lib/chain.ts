// Task chains: run a list of agent tasks one after another. The next task only starts once the previous one is
// done (approved), so the laptop runs one heavy agent job at a time. Kept in data/chains.json (git-ignored).
import "server-only";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { call_, updateIssue, addComment, cancelRun } from "./multica";
import { ProcessBusyError, withProcessLock } from "./process-lock";

type Chain = { id: string; ws: string; title: string; issues: string[]; message: string; started: string[]; starting?: string[] };
const FILE = join(process.cwd(), "data", "chains.json");
const read = (): Chain[] => {
  try { return JSON.parse(readFileSync(FILE, "utf8")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
};
const write = (c: Chain[]) => { mkdirSync(join(process.cwd(), "data"), { recursive: true }); const tmp = `${FILE}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(c, null, 2)); renameSync(tmp, FILE); };

export function addChain(c: Omit<Chain, "started">) { write([...read().filter(x => x.id !== c.id), { ...c, started: [] }]); }

const FINISHED = /^(done|cancelled|canceled)$/;

/** Start the next task of each chain when the one before it is finished. Returns what happened. */
export async function runChains(opts: { settleMs?: number } = {}) {
  try { return await withProcessLock("chains", async () => {
  const out: string[] = [];
  const chains = read();
  for (const c of chains) {
    for (const id of c.issues) {
      const i = await call_<{ status: string; identifier: string }>("GET", `/api/issues/${id}`, c.ws);
      if (FINISHED.test(i.status)) continue;
      if (!c.started.includes(id)) {
        const recovering = c.starting?.includes(id);
        c.starting ??= [];
        if (!recovering) { c.starting.push(id); write(chains); }
        const marker = `<!-- kantor-chain:${c.id}:${id} -->`;
        const comments = recovering ? await call_<unknown>("GET", `/api/issues/${id}/comments`, c.ws) : [];
        const entries = Array.isArray(comments) ? comments : (comments as { comments?: { content?: string }[] }).comments ?? [];
        if (!entries.some(x => x.content?.includes(marker))) {
          if (i.status === "backlog") await updateIssue(c.ws, id, { status: "todo" });
          await addComment(c.ws, id, `${c.message}\n\n${marker}`); // marker lets the next tick recover after a crash
        }
        // Moving the task to todo and the comment can each wake the agent; keep only the first run.
        await new Promise(r => setTimeout(r, opts.settleMs ?? 8000));
        const act = await call_<{ tasks?: { id: string; created_at: string }[] }>("GET", `/api/issues/${id}/active-task`, c.ws);
        for (const t of (act.tasks ?? []).sort((x, y) => x.created_at.localeCompare(y.created_at)).slice(1)) await cancelRun(c.ws, id, t.id);
        c.started.push(id);
        c.starting = c.starting.filter(x => x !== id);
        write(chains);
        out.push(`${c.title}: started ${i.identifier}`);
      }
      break; // only one task per chain at a time
    }
  }
  return out;
  }); } catch (e) { if (e instanceof ProcessBusyError) return []; throw e; }
}
