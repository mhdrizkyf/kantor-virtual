// Task chains & stage-based DAG workflows: run agent tasks sequentially or stage-by-stage.
// Each next stage starts once every task in the previous stage is done (approved) or skipped,
// and automatically injects a structured handoff summary + deliverable list from the completed stage.
// Stored in data/chains.json (git-ignored).
import "server-only";
import { join } from "node:path";
import { call_, updateIssue, addComment, cancelRun, kantorSettings, type Comment, type Attachment } from "./multica";
import { ProcessBusyError, withProcessLock } from "./process-lock";
import { readJsonFile, writeJsonAtomic } from "./json-store";
import { digest } from "./digest";
import { appendActivity } from "./activity-log";

export type Chain = {
  id: string;
  ws: string;
  title: string;
  issues: string[];
  /** Optional stage grouping: issues in the same inner array run in parallel; next stage waits for all previous stage issues to finish. */
  stages?: string[][];
  message: string;
  started: string[];
  starting?: string[];
  skipped?: string[];
  paused?: boolean;
  status?: "active" | "paused" | "completed" | "cancelled";
  injectContext?: boolean;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
};

const file = () => join(process.cwd(), "data", "chains.json");
const read = (): Chain[] => readJsonFile<Chain[]>(file(), () => [], { tolerateInvalid: true });
const write = (c: Chain[]) => { writeJsonAtomic(file(), c); };

const FINISHED = /^(done|cancelled|canceled|completed)$/;
const PRUNE_MS = 7 * 86400000;

export function stagesOf(c: Pick<Chain, "issues" | "stages">): string[][] {
  if (c.stages && c.stages.length > 0) {
    return c.stages.map(s => s.filter(Boolean)).filter(s => s.length > 0);
  }
  return c.issues.map(id => [id]);
}

function pruneOld(chains: Chain[]): Chain[] {
  const cutoff = Date.now() - PRUNE_MS;
  return chains.filter(c => {
    if (c.status !== "completed" && c.status !== "cancelled") return true;
    const at = Date.parse(c.completedAt ?? c.updatedAt ?? "");
    return !Number.isFinite(at) || at > cutoff;
  });
}

export function addChain(c: Omit<Chain, "started"> & { started?: string[] }) {
  const now = new Date().toISOString();
  const next: Chain = {
    ...c,
    started: c.started ?? [],
    skipped: c.skipped ?? [],
    paused: c.paused ?? false,
    status: c.paused ? "paused" : (c.status ?? "active"),
    injectContext: c.injectContext ?? true,
    createdAt: c.createdAt ?? now,
    updatedAt: now,
  };
  write(pruneOld([...read().filter(x => x.id !== c.id), next]));
  return next;
}

export function listChains(ws?: string | null): Chain[] {
  const all = read();
  const filtered = ws ? all.filter(c => c.ws === ws) : all;
  return filtered.sort((a, b) => (b.updatedAt ?? b.createdAt ?? "").localeCompare(a.updatedAt ?? a.createdAt ?? ""));
}

export async function updateChainState(
  id: string,
  action: "pause" | "resume" | "cancel" | "skip" | "delete",
  issueId?: string
): Promise<Chain | null> {
  return withProcessLock("chains", async () => {
    const chains = read();
    const idx = chains.findIndex(c => c.id === id);
    if (idx < 0) return null;
    if (action === "delete") {
      chains.splice(idx, 1);
      write(chains);
      return null;
    }
    const c = chains[idx];
    const now = new Date().toISOString();
    if (action === "pause") {
      c.paused = true;
      c.status = "paused";
    } else if (action === "resume") {
      c.paused = false;
      if (c.status === "paused") c.status = "active";
    } else if (action === "cancel") {
      c.paused = false;
      c.status = "cancelled";
      c.completedAt = now;
    } else if (action === "skip" && issueId) {
      c.skipped = [...new Set([...(c.skipped ?? []), issueId])];
    }
    c.updatedAt = now;
    write(pruneOld(chains));
    return c;
  });
}

type IssueBrief = { id: string; identifier: string; title?: string; status: string };

/** Build a concise markdown handoff block from the completed previous stage's issue(s). */
export async function buildHandoffContext(ws: string, prevIssueIds: string[]): Promise<string> {
  if (!prevIssueIds.length) return "";
  const blocks: string[] = [];
  for (const prevId of prevIssueIds) {
    try {
      const [iss, rawComments, rawAttachments] = await Promise.all([
        call_<IssueBrief>("GET", `/api/issues/${prevId}`, ws),
        call_<unknown>("GET", `/api/issues/${prevId}/comments`, ws).catch(() => []),
        call_<unknown>("GET", `/api/issues/${prevId}/attachments`, ws).catch(() => []),
      ]);
      const comments: Comment[] = (Array.isArray(rawComments) ? rawComments : (rawComments as { comments?: Comment[] })?.comments ?? [])
        .filter((c: Comment) => !c.deleted_at)
        .sort((a: Comment, b: Comment) => Date.parse(a.created_at) - Date.parse(b.created_at));
      const attachments: Attachment[] = Array.isArray(rawAttachments) ? rawAttachments : (rawAttachments as { attachments?: Attachment[] })?.attachments ?? [];
      const lastAgent = [...comments].reverse().find(c => c.author_type === "agent" && c.content?.trim());
      const dg = lastAgent ? digest(lastAgent.content) : null;
      const files = [
        ...attachments.map(a => a.filename),
        ...comments.flatMap(c => (c.attachments ?? []).map(a => a.filename)),
      ].filter(Boolean);
      const uniqueFiles = [...new Set(files)].slice(0, 8);
      const lines: string[] = [`- **${iss.identifier}${iss.title ? ` · ${iss.title}` : ""}** (${iss.status})`];
      if (dg?.summary?.length) {
        for (const s of dg.summary.slice(0, 3)) lines.push(`  - ${s}`);
      } else if (lastAgent?.content) {
        const snippet = lastAgent.content.replace(/\s+/g, " ").trim().slice(0, 220);
        if (snippet) lines.push(`  - ${snippet}${lastAgent.content.length > 220 ? "…" : ""}`);
      }
      if (uniqueFiles.length) lines.push(`  - Files: ${uniqueFiles.join(", ")}`);
      blocks.push(lines.join("\n"));
    } catch {
      // If a previous issue was deleted or inaccessible, proceed without blocking the chain.
    }
  }
  if (!blocks.length) return "";
  return `### Handoff context from previous step\n${blocks.join("\n")}`;
}

/** Start the next ready issue/stage of each active chain when the previous stage is finished. */
export async function runChains(opts: { settleMs?: number } = {}) {
  try {
    return await withProcessLock("chains", async () => {
      const out: string[] = [];
      const chains = read();
      let dirty = false;

      for (const c of chains) {
        if (c.paused || c.status === "paused" || c.status === "completed" || c.status === "cancelled") continue;
        if ((await kantorSettings(c.ws)).open === false) continue;

        const stages = stagesOf(c);
        const skipped = new Set(c.skipped ?? []);
        let allFinished = true;

        for (let sIdx = 0; sIdx < stages.length; sIdx++) {
          const stageIds = stages[sIdx];
          const statuses = new Map<string, IssueBrief>();
          for (const id of stageIds) {
            if (skipped.has(id)) continue;
            const i = await call_<IssueBrief>("GET", `/api/issues/${id}`, c.ws);
            statuses.set(id, i);
          }
          const pendingIds = stageIds.filter(id => !skipped.has(id) && !FINISHED.test(statuses.get(id)?.status ?? ""));
          if (!pendingIds.length) continue;

          allFinished = false;
          const prevStageIds = sIdx > 0 ? stages[sIdx - 1].filter(id => !skipped.has(id)) : [];
          let handoffBlock: string | null = null;

          for (const id of pendingIds) {
            const i = statuses.get(id)!;
            if (c.started.includes(id)) continue;

            const recovering = c.starting?.includes(id);
            c.starting ??= [];
            if (!recovering) {
              c.starting.push(id);
              c.updatedAt = new Date().toISOString();
              write(chains);
              dirty = true;
            }
            const marker = `<!-- kantor-chain:${c.id}:${id} -->`;
            const rawComments = recovering ? await call_<unknown>("GET", `/api/issues/${id}/comments`, c.ws) : [];
            const entries = Array.isArray(rawComments) ? rawComments : (rawComments as { comments?: { content?: string }[] }).comments ?? [];
            if (!entries.some(x => x.content?.includes(marker))) {
              if (c.injectContext !== false && prevStageIds.length && handoffBlock === null) {
                handoffBlock = await buildHandoffContext(c.ws, prevStageIds);
              }
              if (i.status === "backlog") await updateIssue(c.ws, id, { status: "todo" });
              const body = [c.message, handoffBlock || "", marker].filter(Boolean).join("\n\n");
              await addComment(c.ws, id, body);
            }
            // Moving the task to todo and the comment can each wake the agent; keep only the first run.
            await new Promise(r => setTimeout(r, opts.settleMs ?? 8000));
            const act = await call_<{ tasks?: { id: string; created_at: string }[] }>("GET", `/api/issues/${id}/active-task`, c.ws);
            for (const t of (act.tasks ?? []).sort((x, y) => x.created_at.localeCompare(y.created_at)).slice(1)) {
              await cancelRun(c.ws, id, t.id);
            }
            c.started.push(id);
            c.starting = c.starting.filter(x => x !== id);
            c.updatedAt = new Date().toISOString();
            write(chains);
            dirty = true;
            out.push(`${c.title}: started ${i.identifier}`);
            void appendActivity(c.ws, {
              kind: "chain",
              title: `Chain started ${i.identifier}`,
              detail: `${c.title}${i.title ? ` · ${i.title}` : ""}`,
              issueId: id,
              source: "chain",
            }).catch(() => {});
          }
          break; // wait for this stage to finish before starting the next stage
        }

        if (allFinished) {
          const now = new Date().toISOString();
          c.status = "completed";
          c.completedAt = now;
          c.updatedAt = now;
          dirty = true;
          out.push(`${c.title}: completed`);
          void appendActivity(c.ws, {
            kind: "chain",
            title: `Chain completed: ${c.title}`,
            detail: `${c.issues.length} step(s) finished`,
            source: "chain",
          }).catch(() => {});
        }
      }

      if (dirty) write(pruneOld(chains));
      return out;
    });
  } catch (e) {
    if (e instanceof ProcessBusyError) return [];
    throw e;
  }
}
