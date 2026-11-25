import { NextResponse } from "next/server";
import { createIssue, invalidateWorkspaceCache, kantorSettings, setIssueMeta, workspace } from "@/lib/multica";
import { PARK_KEY } from "@/lib/office-control";
import { addChain } from "@/lib/chain";
import { appendActivity } from "@/lib/activity-log";

export const dynamic = "force-dynamic";

type StepInput = {
  title: string;
  detail?: string;
  agentId: string;
  stage?: number;
};

type OrchestrateBody = {
  ws?: string;
  goal: string;
  mode: "chain" | "parallel" | "staged";
  projectId?: string;
  due?: string;
  injectContext?: boolean;
  steps: StepInput[];
};

/**
 * Create a multi-step delegated workflow in Multica.
 * - "parallel": starts every step in `todo` right away (or parks if office is closed).
 * - "chain": starts Step 1 now, queues Steps 2..N in `backlog`, and registers a sequential task chain.
 * - "staged": groups steps by `stage` number; Stage 1 runs in parallel right away, and each next stage
 *   kicks off automatically with combined handoff context once every step in the previous stage is approved.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as OrchestrateBody;
    const goal = (body.goal ?? "").trim();
    const steps = (body.steps ?? []).filter(s => s.title?.trim() && s.agentId);
    if (!steps.length) {
      return NextResponse.json({ error: "Add at least one step with a title and assigned agent." }, { status: 400 });
    }
    const ws = await workspace(body.ws ?? null);
    const mode: "chain" | "parallel" | "staged" = body.mode === "parallel" ? "parallel" : body.mode === "staged" ? "staged" : "chain";
    const closed = (await kantorSettings(ws.id)).open === false;

    // Normalize stage buckets for staged mode
    const stageOrder = mode === "staged"
      ? [...new Set(steps.map((s, idx) => (Number.isInteger(s.stage) && (s.stage ?? 0) >= 1 ? s.stage! : idx + 1)))].sort((a, b) => a - b)
      : [];
    const firstStage = stageOrder[0] ?? 1;

    const created: { id: string; title: string; agentId: string; status: string; stage: number }[] = [];
    const stageBuckets = new Map<number, string[]>();

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const stageNum = mode === "staged"
        ? (Number.isInteger(s.stage) && (s.stage ?? 0) >= 1 ? s.stage! : i + 1)
        : mode === "parallel"
          ? 1
          : i + 1;
      const startNow = mode === "parallel" || (mode === "staged" ? stageNum === firstStage : i === 0);
      const status = !startNow || closed ? "backlog" : "todo";
      const issue = await createIssue(ws.id, {
        title: s.title.trim().slice(0, 120),
        description: (s.detail ?? "").trim() || (goal ? `Part of goal: ${goal}` : null),
        status,
        priority: "medium",
        assignee_type: "agent",
        assignee_id: s.agentId,
        project_id: body.projectId || null,
        due_date: body.due || null,
      });
      if (closed && startNow) {
        await setIssueMeta(ws.id, issue.id, PARK_KEY, "todo");
      }
      created.push({ id: issue.id, title: s.title.trim(), agentId: s.agentId, status, stage: stageNum });
      const bucket = stageBuckets.get(stageNum) ?? [];
      bucket.push(issue.id);
      stageBuckets.set(stageNum, bucket);
    }

    let chainId: string | null = null;
    if ((mode === "chain" || mode === "staged") && created.length > 1) {
      const stages = mode === "staged"
        ? [...stageBuckets.entries()].sort(([a], [b]) => a - b).map(([, ids]) => ids)
        : created.map(c => [c.id]);
      if (stages.length > 1) {
        chainId = `orch-${Date.now()}`;
        const startedNow = closed ? [] : stages[0];
        addChain({
          id: chainId,
          ws: ws.id,
          title: goal.slice(0, 80) || created[0].title,
          issues: created.map(c => c.id),
          stages,
          started: startedNow,
          injectContext: body.injectContext ?? true,
          message: `Previous stage is approved — you're up for the next step of: ${goal || created[0].title}`,
        });
      }
    }

    invalidateWorkspaceCache(ws.id);
    void appendActivity(ws.id, {
      kind: "delegate",
      title: `Delegated ${created.length} task${created.length === 1 ? "" : "s"} (${mode})`,
      detail: goal || created[0].title,
      agentId: created[0]?.agentId,
      issueId: created[0]?.id,
      source: "api",
    }).catch(() => {});

    return NextResponse.json({ created, mode, chainId, parked: closed });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
