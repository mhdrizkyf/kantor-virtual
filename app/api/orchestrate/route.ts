import { NextResponse } from "next/server";
import { createIssue, kantorSettings, setIssueMeta } from "@/lib/multica";
import { PARK_KEY } from "@/lib/office-control";
import { addChain } from "@/lib/chain";

export const dynamic = "force-dynamic";

type StepInput = {
  title: string;
  detail?: string;
  agentId: string;
};

type OrchestrateBody = {
  ws?: string;
  goal: string;
  mode: "chain" | "parallel";
  projectId?: string;
  due?: string;
  steps: StepInput[];
};

/**
 * Create a multi-step delegated workflow in Multica.
 * - "parallel": starts every step in `todo` right away (or parks if office is closed).
 * - "chain": starts Step 1 now, queues Steps 2..N in `backlog`, and registers a task chain
 *   so each subsequent step kicks off automatically once the previous step is approved.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as OrchestrateBody;
    const goal = (body.goal ?? "").trim();
    const steps = (body.steps ?? []).filter(s => s.title?.trim() && s.agentId);
    if (!steps.length) {
      return NextResponse.json({ error: "Add at least one step with a title and assigned agent." }, { status: 400 });
    }
    const ws = body.ws ?? null;
    const mode = body.mode === "parallel" ? "parallel" : "chain";
    const closed = (await kantorSettings(ws)).open === false;
    const created: { id: string; title: string; agentId: string; status: string }[] = [];

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const startNow = mode === "parallel" || i === 0;
      const status = !startNow || closed ? "backlog" : "todo";
      const issue = await createIssue(ws, {
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
        await setIssueMeta(ws, issue.id, PARK_KEY, "todo");
      }
      created.push({ id: issue.id, title: s.title.trim(), agentId: s.agentId, status });
    }

    if (mode === "chain" && created.length > 1 && ws) {
      addChain({
        id: `orch-${Date.now()}`,
        ws,
        title: goal.slice(0, 80) || created[0].title,
        issues: created.map(c => c.id),
        started: closed ? [] : [created[0].id],
        message: `Previous step is approved — you're up for the next step of: ${goal || created[0].title}`,
      });
    }

    return NextResponse.json({ created, mode, parked: closed });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
