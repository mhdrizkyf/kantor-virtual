import { NextResponse } from "next/server";
import { loadWorkspaceCached, workspace } from "@/lib/multica";
import { emitOfficeChange } from "@/lib/office-events";
import { listChains, runChains, stagesOf, updateChainState } from "@/lib/chain";
import { friendlyTitle } from "@/lib/titles";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const wsPick = new URL(req.url).searchParams.get("ws");
  try {
    const snap = await loadWorkspaceCached(wsPick, 4000);
    const issueMap = new Map(snap.issues.map(i => [i.id, i]));
    const agentMap = new Map(snap.agents.map(a => [a.id, a.name]));
    const chains = listChains(snap.workspace.id).map(c => {
      const stages = stagesOf(c);
      const skipped = new Set(c.skipped ?? []);
      const steps = stages.flatMap((stageIds, stageIdx) =>
        stageIds.map(id => {
          const iss = issueMap.get(id);
          return {
            id,
            stage: stageIdx + 1,
            key: iss?.identifier ?? id.slice(0, 8),
            title: iss ? friendlyTitle(iss) : "Task",
            status: skipped.has(id) ? "skipped" : (iss?.status ?? "unknown"),
            assignee: iss?.assignee_type === "agent" && iss.assignee_id ? (agentMap.get(iss.assignee_id) ?? "Agent") : null,
            started: c.started.includes(id),
          };
        })
      );
      const doneCount = steps.filter(s => /^(done|cancelled|canceled|completed|skipped)$/.test(s.status)).length;
      return {
        id: c.id,
        ws: c.ws,
        title: c.title,
        status: c.status ?? (c.paused ? "paused" : "active"),
        paused: !!c.paused,
        stageCount: stages.length,
        totalSteps: steps.length,
        doneSteps: doneCount,
        createdAt: c.createdAt ?? null,
        updatedAt: c.updatedAt ?? null,
        steps,
      };
    });
    return NextResponse.json({ workspaceId: snap.workspace.id, chains });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const b = (await req.json()) as { ws?: string; id?: string; action?: "pause" | "resume" | "cancel" | "skip" | "delete" | "run"; issueId?: string };
    const resolvedWs = await workspace(b.ws ?? null);
    if (b.action === "run") {
      const started = await runChains({ settleMs: 1500 });
      if (started.length) emitOfficeChange(resolvedWs.id, "chain.advanced");
      return NextResponse.json({ ok: true, started });
    }
    if (!b.id || !b.action || !["pause", "resume", "cancel", "skip", "delete"].includes(b.action)) {
      return NextResponse.json({ error: "Valid chain id and action are required." }, { status: 400 });
    }
    const updated = await updateChainState(b.id, b.action, b.issueId);
    if (b.action === "resume" || b.action === "skip") {
      void runChains({ settleMs: 1500 }).catch(() => {});
    }
    emitOfficeChange(resolvedWs.id, `chain.${b.action}`);
    return NextResponse.json({ ok: true, chain: updated });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
