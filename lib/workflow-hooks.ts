// Modular, event-driven workflow hook pipeline for Virtual Office × Multica.
// Decouples side effects (Taiga daily review flow, chain advancement, persistent activity logging,
// and optional outbound webhooks) from core API routes.
import "server-only";
import type { Comment } from "./multica";
import { afterReviewApproved } from "./taiga-flow";
import { appendActivity } from "./activity-log";

export type WorkflowHookPayloads = {
  "task.approved": {
    wsId: string;
    issue: { id: string; identifier: string; title: string; status: string; assignee_type?: string | null; assignee_id?: string | null; description?: string | null };
    comments: Comment[];
    memberId: string;
    memberName: string;
    officeClosed: boolean;
    note?: string;
  };
  "task.revised": {
    wsId: string;
    issueId: string;
    title: string;
    assigneeId?: string | null;
    memberName: string;
    feedback: string;
  };
  "task.handoff": {
    wsId: string;
    fromIssueId: string;
    fromTitle: string;
    toIssueId: string;
    toTitle: string;
    toAssigneeId?: string | null;
    toAssigneeName: string;
    memberName: string;
  };
  "task.failed": {
    wsId: string;
    issueId: string;
    title: string;
    agentId?: string;
    reason: string;
    retried: boolean;
  };
  "office.toggled": {
    wsId: string;
    action: "open" | "close";
    actor: string;
    source: "api" | "schedule" | "watchdog";
    summary: string;
  };
};

export type WorkflowEventName = keyof WorkflowHookPayloads;
export type WorkflowHookHandler<E extends WorkflowEventName> = (payload: WorkflowHookPayloads[E]) => Promise<void> | void;

type RegisteredHook = {
  name: string;
  event: WorkflowEventName;
  handler: (payload: unknown) => Promise<void> | void;
};

const customHooks: RegisteredHook[] = [];

/** Register a custom hook handler (useful for plugins and unit tests). Returns an unregister callback. */
export function registerWorkflowHook<E extends WorkflowEventName>(
  name: string,
  event: E,
  handler: WorkflowHookHandler<E>
): () => void {
  const entry: RegisteredHook = { name, event, handler: handler as (payload: unknown) => Promise<void> | void };
  customHooks.push(entry);
  return () => {
    const idx = customHooks.indexOf(entry);
    if (idx >= 0) customHooks.splice(idx, 1);
  };
}

/** Optional fire-and-forget outbound webhook (set KANTOR_WEBHOOK_URL in .env.local). */
async function postOutboundWebhook<E extends WorkflowEventName>(event: E, payload: WorkflowHookPayloads[E]) {
  const url = process.env.KANTOR_WEBHOOK_URL?.trim();
  if (!url || !/^https?:\/\//i.test(url)) return;
  const secret = process.env.KANTOR_WEBHOOK_SECRET?.trim();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "X-Kantor-Secret": secret } : {}),
      },
      body: JSON.stringify({ event, at: new Date().toISOString(), payload }),
    });
  } finally {
    clearTimeout(timer);
  }
}

async function runBuiltInHooks<E extends WorkflowEventName>(event: E, payload: WorkflowHookPayloads[E]) {
  const errors: { hook: string; error: string }[] = [];
  const safe = async (hook: string, fn: () => Promise<unknown> | unknown) => {
    try { await fn(); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ hook, error: msg });
      console.warn(`[hook:${event}:${hook}]`, msg.slice(0, 200));
    }
  };

  if (event === "task.approved") {
    const p = payload as WorkflowHookPayloads["task.approved"];
    await safe("activity", () => appendActivity(p.wsId, {
      kind: "approve",
      title: `Approved: ${p.issue.title}`,
      detail: p.note || `Approved by ${p.memberName}`,
      issueId: p.issue.id,
      agentId: p.issue.assignee_type === "agent" ? (p.issue.assignee_id ?? undefined) : undefined,
      source: "api",
    }));
    await safe("taiga-review", () => afterReviewApproved(p.wsId, p.issue, p.comments, p.memberId, p.memberName));
    if (!p.officeClosed) {
      // Dynamic import avoids circular dependency between chain.ts and workflow-hooks.ts
      await safe("chain-advance", async () => {
        const { runChains } = await import("./chain");
        void runChains().catch(e => console.warn("[chain] after approve:", e));
      });
    }
  } else if (event === "task.revised") {
    const p = payload as WorkflowHookPayloads["task.revised"];
    await safe("activity", () => appendActivity(p.wsId, {
      kind: "revise",
      title: `Revision requested: ${p.title}`,
      detail: p.feedback.slice(0, 180),
      issueId: p.issueId,
      agentId: p.assigneeId ?? undefined,
      source: "api",
    }));
  } else if (event === "task.handoff") {
    const p = payload as WorkflowHookPayloads["task.handoff"];
    await safe("activity", () => appendActivity(p.wsId, {
      kind: "handoff",
      title: `Approved & handed off → ${p.toAssigneeName}`,
      detail: `${p.fromTitle} → ${p.toTitle}`,
      issueId: p.toIssueId,
      agentId: p.toAssigneeId ?? undefined,
      source: "api",
    }));
  } else if (event === "task.failed") {
    const p = payload as WorkflowHookPayloads["task.failed"];
    await safe("activity", () => appendActivity(p.wsId, {
      kind: "watchdog",
      title: p.retried ? `Auto-retried: ${p.title}` : `Task failed: ${p.title}`,
      detail: p.reason,
      issueId: p.issueId,
      agentId: p.agentId,
      source: "watchdog",
    }));
  } else if (event === "office.toggled") {
    const p = payload as WorkflowHookPayloads["office.toggled"];
    await safe("activity", () => appendActivity(p.wsId, {
      kind: p.source === "schedule" ? "schedule" : "door",
      title: p.action === "close" ? "Office closed" : "Office opened",
      detail: p.summary,
      source: p.source,
    }));
  }

  await safe("webhook", () => postOutboundWebhook(event, payload));
  return errors;
}

/** Emit a workflow lifecycle event through all built-in and registered custom hooks with error isolation. */
export async function emitWorkflowHook<E extends WorkflowEventName>(
  event: E,
  payload: WorkflowHookPayloads[E]
): Promise<{ errors: { hook: string; error: string }[] }> {
  const errors = await runBuiltInHooks(event, payload);
  for (const h of customHooks.filter(x => x.event === event)) {
    try {
      await h.handler(payload as never);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ hook: h.name, error: msg });
      console.warn(`[hook:${event}:${h.name}]`, msg.slice(0, 200));
    }
  }
  return { errors };
}
