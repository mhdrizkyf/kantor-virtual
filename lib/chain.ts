// Task chains: run a list of agent tasks one after another. The next task only starts once the previous one is
// done (approved), so the laptop runs one heavy agent job at a time. Kept in data/chains.json (git-ignored).
import "server-only";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { call_, updateIssue, addComment, cancelRun } from "./multica";

type Chain = { id: string; ws: string; title: string; issues: string[]; message: string; started: string[] };
const FILE = join(process.cwd(), "data", "chains.json");
const read = (): Chain[] => { try { return JSON.parse(readFileSync(FILE, "utf8")); } catch { return []; } };
const write = (c: Chain[]) => { mkdirSync(join(process.cwd(), "data"), { recursive: true }); writeFileSync(FILE, JSON.stringify(c, null, 2)); };

export function addChain(c: Omit<Chain, "started">) { write([...read().filter(x => x.id !== c.id), { ...c, started: [] }]); }

const FINISHED = /^(done|cancelled|canceled)$/;

/** Start the next task of each chain when the one before it is finished. Returns what happened. */
export async function runChains() {
  const out: string[] = [];
  const chains = read();
  let changed = false;
  for (const c of chains) {
    for (const id of c.issues) {
      const i = await call_<{ status: string; identifier: string }>("GET", `/api/issues/${id}`, c.ws);
      if (FINISHED.test(i.status)) continue;
      if (!c.started.includes(id)) {
        await updateIssue(c.ws, id, { status: "todo" });
        await addComment(c.ws, id, c.message); // a member comment wakes the assigned agent
        // Moving the task to todo and the comment can each wake the agent; keep only the first run.
        await new Promise(r => setTimeout(r, 8000));
        const act = await call_<{ tasks?: { id: string; created_at: string }[] }>("GET", `/api/issues/${id}/active-task`, c.ws).catch(() => ({ tasks: [] }));
        for (const t of (act.tasks ?? []).sort((x, y) => x.created_at.localeCompare(y.created_at)).slice(1)) await cancelRun(c.ws, id, t.id).catch(() => {});
        c.started.push(id); changed = true;
        out.push(`${c.title}: started ${i.identifier}`);
      }
      break; // only one task per chain at a time
    }
  }
  if (changed) write(chains);
  return out;
}
