import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Multica workflow advancements (chains, DAG, watchdog, schedule, hooks, playbooks, sync, metrics)", async t => {
  const before = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "kantor-adv-"));
  process.chdir(dir);
  process.env.MULTICA_TOKEN = "test-token";
  process.env.MULTICA_API_URL = "http://multica.test";
  process.env.KANTOR_TIMEZONE = "Asia/Jakarta";

  const now = new Date("2026-11-24T04:00:00Z"); // 11:00 Asia/Jakarta (Tuesday)
  const nowIso = now.toISOString();
  const twoHoursAgo = new Date(now.getTime() - 120 * 60000).toISOString();
  const tenMinsAgo = new Date(now.getTime() - 10 * 60000).toISOString();

  type Item = Record<string, any>;
  const issues: Record<string, Item[]> = {
    w1: [
      { id: "st1", identifier: "W1-10", title: "Stage 1 Research", status: "done", assignee_type: "agent", assignee_id: "a1", priority: "medium", due_date: null, start_date: null, project_id: "p1", updated_at: nowIso, last_activity_at: nowIso, created_at: nowIso, metadata: {}, description: "" },
      { id: "st2a", identifier: "W1-11", title: "Stage 2 Design", status: "backlog", assignee_type: "agent", assignee_id: "a1", priority: "medium", due_date: null, start_date: null, project_id: "p1", updated_at: nowIso, last_activity_at: nowIso, created_at: nowIso, metadata: {}, description: "" },
      { id: "st2b", identifier: "W1-12", title: "Stage 2 Copy", status: "backlog", assignee_type: "agent", assignee_id: "a2", priority: "medium", due_date: null, start_date: null, project_id: "p1", updated_at: nowIso, last_activity_at: nowIso, created_at: nowIso, metadata: {}, description: "" },
      { id: "st3", identifier: "W1-13", title: "Stage 3 QA", status: "backlog", assignee_type: "agent", assignee_id: "a2", priority: "medium", due_date: null, start_date: null, project_id: "p1", updated_at: nowIso, last_activity_at: nowIso, created_at: nowIso, metadata: {}, description: "" },
      { id: "rev1", identifier: "W1-20", title: "Launch Deck Draft", status: "in_review", assignee_type: "agent", assignee_id: "a1", priority: "high", due_date: null, start_date: null, project_id: "p1", updated_at: nowIso, last_activity_at: nowIso, created_at: nowIso, metadata: {}, description: "" },
      { id: "stuck1", identifier: "W1-21", title: "Long Running Job", status: "in_progress", assignee_type: "agent", assignee_id: "a1", priority: "medium", due_date: null, start_date: null, project_id: null, updated_at: twoHoursAgo, last_activity_at: twoHoursAgo, created_at: twoHoursAgo, metadata: {}, description: "" },
      { id: "trans1", identifier: "W1-22", title: "Transient Failure Job", status: "in_progress", assignee_type: "agent", assignee_id: "a2", priority: "medium", due_date: null, start_date: null, project_id: null, updated_at: tenMinsAgo, last_activity_at: tenMinsAgo, created_at: tenMinsAgo, metadata: {}, description: "" },
    ],
    w2: [
      { id: "w2-rev", identifier: "W2-1", title: "Other Office Review", status: "in_review", assignee_type: "agent", assignee_id: "b1", priority: "medium", due_date: null, start_date: null, project_id: null, updated_at: nowIso, last_activity_at: nowIso, created_at: nowIso, metadata: {}, description: "" },
    ],
  };

  const comments: Record<string, Item[]> = {
    st1: [
      {
        id: "c-st1",
        author_type: "agent",
        author_id: "a1",
        content: "## Summary\n- Target audience is SME founders.\n- Key value prop is 1-click automation.",
        type: "comment",
        parent_id: null,
        created_at: nowIso,
        attachments: [{ id: "att-1", filename: "research-brief.pdf", url: "/f/1", download_url: "/f/1" }],
      },
    ],
    rev1: [
      {
        id: "c-rev1",
        author_type: "agent",
        author_id: "a1",
        content: "## Summary\n- Finished 10-slide launch deck.\n\n## Questions\n1. Should we include pricing on slide 8? Options: Yes / No",
        type: "comment",
        parent_id: null,
        created_at: nowIso,
        attachments: [{ id: "att-2", filename: "launch-deck.pptx", url: "/f/2", download_url: "/f/2" }],
      },
    ],
  };

  const agents: Record<string, Item[]> = {
    w1: [
      { id: "a1", name: "Rara Research", description: "Research & design", avatar_url: null, runtime_id: "rt1", status: "active", model: "claude-sonnet", archived_at: null, instructions: "You are Rara." },
      { id: "a2", name: "Dito Delivery", description: "Delivery & QA", avatar_url: null, runtime_id: "rt1", status: "active", model: "gpt-5", archived_at: null, instructions: "You are Dito." },
    ],
    w2: [
      { id: "b1", name: "Budi", description: "Ops", avatar_url: null, runtime_id: "rt2", status: "active", model: "", archived_at: null, instructions: "You are Budi." },
    ],
  };

  const runs: Record<string, Item[]> = {
    a1: [
      { id: "run-stuck", agent_id: "a1", issue_id: "stuck1", status: "running", error: null, created_at: twoHoursAgo, started_at: twoHoursAgo, completed_at: null, runtime_id: "rt1" },
      { id: "run-ok", agent_id: "a1", issue_id: "rev1", status: "completed", error: null, created_at: twoHoursAgo, started_at: twoHoursAgo, completed_at: new Date(Date.parse(twoHoursAgo) + 6 * 60000).toISOString(), runtime_id: "rt1" },
    ],
    a2: [
      { id: "run-trans", agent_id: "a2", issue_id: "trans1", status: "failed", error: "socket hang up ECONNRESET", created_at: tenMinsAgo, started_at: tenMinsAgo, completed_at: tenMinsAgo, runtime_id: "rt1" },
    ],
    b1: [],
  };

  const settings: Record<string, Item> = {
    w1: { kantor: { open: true, autoHealStuck: true } },
    w2: { kantor: { open: true } },
  };
  const reruns: string[] = [];
  const cancelledRuns: string[] = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const method = init?.method ?? "GET";
    const ws = new Headers(init?.headers).get("X-Workspace-ID") ?? "w1";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const respond = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

    if (path === "/api/workspaces" && method === "GET") return respond({ workspaces: [{ id: "w1", name: "Main HQ", slug: "main" }, { id: "w2", name: "Labs", slug: "labs" }] });
    if (path === "/api/me") return respond({ id: "u1", name: "Owner" });
    if (/^\/api\/workspaces\/w[12]$/.test(path)) {
      const id = path.split("/").pop()!;
      if (method === "PATCH") settings[id] = body.settings;
      return respond({ id, settings: settings[id] });
    }
    if (path.endsWith("/members")) return respond({ members: [{ id: "m1", user_id: "u1", name: "Owner", email: "owner@example.com", role: "owner" }] });
    if (path === "/api/agents" && method === "GET") return respond({ agents: agents[ws] ?? [] });
    if (/^\/api\/agents\/[^/]+$/.test(path)) {
      const aid = path.split("/").pop()!;
      const ag = (agents[ws] ?? []).find(a => a.id === aid);
      if (!ag) return respond({ error: "missing" }, 404);
      if (method === "PUT") Object.assign(ag, body);
      return respond(ag);
    }
    if (/^\/api\/agents\/[^/]+\/tasks$/.test(path)) {
      const aid = path.split("/")[3];
      return respond({ tasks: runs[aid] ?? [] });
    }
    if (path === "/api/projects") return respond({ projects: [{ id: "p1", title: "Launch", icon: null, status: "active", due_date: null, issue_count: 5, done_count: 1 }] });
    if (path === "/api/runtimes") return respond({ runtimes: [{ id: ws === "w1" ? "rt1" : "rt2", name: "Laptop", provider: "claude", status: "online", last_seen_at: nowIso, owner_id: "u1" }] });
    if (path === "/api/autopilots") return respond({ autopilots: [] });
    if (path === "/api/issues" && method === "GET") return respond({ issues: issues[ws] ?? [], has_more: false });
    if (path === "/api/issues" && method === "POST") {
      const created = {
        id: `created-${(issues[ws] ?? []).length + 1}`,
        identifier: `${ws.toUpperCase()}-${(issues[ws] ?? []).length + 50}`,
        priority: "medium",
        due_date: null,
        start_date: null,
        project_id: null,
        updated_at: nowIso,
        last_activity_at: nowIso,
        created_at: nowIso,
        metadata: {},
        description: "",
        ...body,
      };
      (issues[ws] ??= []).push(created);
      return respond(created);
    }
    const parts = path.split("/");
    if (parts[1] === "api" && parts[2] === "issues" && parts[3]) {
      const id = parts[3];
      const issue = (issues[ws] ?? []).find(i => i.id === id);
      if (!issue) return respond({ error: "missing" }, 404);
      if (parts[4] === "comments") {
        if (method === "GET") return respond({ comments: comments[id] ?? [] });
        const c = { id: `c-${(comments[id] ?? []).length + 1}`, author_type: "member", author_id: "u1", content: body.content, type: "comment", parent_id: null, created_at: nowIso };
        (comments[id] ??= []).push(c);
        return respond(c);
      }
      if (parts[4] === "attachments") return respond({ attachments: [] });
      if (parts[4] === "active-task") return respond({ tasks: [] });
      if (parts[4] === "tasks" && parts[6] === "cancel") {
        cancelledRuns.push(parts[5]);
        return respond({ ok: true });
      }
      if (parts[4] === "metadata") {
        if (method === "DELETE") delete issue.metadata[parts[5]];
        else issue.metadata[parts[5]] = body.value;
        return respond({ ok: true });
      }
      if (parts[4] === "rerun") {
        reruns.push(id);
        return respond({ ok: true });
      }
      if (method === "PUT") {
        Object.assign(issue, body);
        issue.updated_at = new Date().toISOString();
        return respond(issue);
      }
      if (method === "GET") return respond(issue);
    }
    return respond({ error: `unmocked ${method} ${path}` }, 500);
  }) as typeof fetch;

  try {
    const { addChain, runChains, listChains, updateChainState } = await import("../lib/chain");
    const { evaluateOfficeSchedule } = await import("../lib/office-schedule");
    const { findStuckRuns, isTransientError, runWatchdog } = await import("../lib/watchdog");
    const { registerWorkflowHook } = await import("../lib/workflow-hooks");
    const { listPlaybooks, savePlaybook, deletePlaybook } = await import("../lib/playbooks");
    const { computeSyncedInstructions, inspectWorkspaceInstructions, syncWorkspaceInstructions } = await import("../lib/agent-instructions");
    const { appendActivity, readActivity } = await import("../lib/activity-log");
    const { computeWorkspaceMetrics } = await import("../lib/metrics");
    const { loadWorkspace } = await import("../lib/multica");
    const { buildOffice } = await import("../lib/office");
    const { POST: taskPost } = await import("../app/api/task/[id]/route");
    const { GET: syncGet } = await import("../app/api/office/sync/route");
    const { GET: unifiedAttnGet } = await import("../app/api/workspaces/attention/route");

    await t.test("staged DAG chain injects handoff context and waits for all stage steps", async () => {
      addChain({
        id: "dag-1",
        ws: "w1",
        title: "Staged Launch",
        issues: ["st1", "st2a", "st2b", "st3"],
        stages: [["st1"], ["st2a", "st2b"], ["st3"]],
        started: ["st1"],
        message: "Stage ready",
      });
      const out1 = await runChains({ settleMs: 0 });
      assert.equal(out1.length, 2);
      assert.equal(issues.w1.find(i => i.id === "st2a")!.status, "todo");
      assert.equal(issues.w1.find(i => i.id === "st2b")!.status, "todo");
      assert.equal(issues.w1.find(i => i.id === "st3")!.status, "backlog");
      // Handoff comment contains Stage 1 summary & deliverable filename
      assert.match(comments.st2a[0].content, /Handoff context from previous step/);
      assert.match(comments.st2a[0].content, /Target audience is SME founders/);
      assert.match(comments.st2a[0].content, /research-brief\.pdf/);

      // Completing only st2a must NOT launch st3 yet
      issues.w1.find(i => i.id === "st2a")!.status = "done";
      await runChains({ settleMs: 0 });
      assert.equal(issues.w1.find(i => i.id === "st3")!.status, "backlog");

      // Skipping st2b allows Stage 3 to start
      await updateChainState("dag-1", "skip", "st2b");
      await runChains({ settleMs: 0 });
      assert.equal(issues.w1.find(i => i.id === "st3")!.status, "todo");

      // Pausing prevents further progression; completing marks chain completed
      await updateChainState("dag-1", "pause");
      assert.equal(listChains("w1").find(c => c.id === "dag-1")?.status, "paused");
      await updateChainState("dag-1", "resume");
      issues.w1.find(i => i.id === "st3")!.status = "done";
      await runChains({ settleMs: 0 });
      assert.equal(listChains("w1").find(c => c.id === "dag-1")?.status, "completed");
    });

    await t.test("office schedule respects hours, holidays, extra work dates, and daily dedup", () => {
      const sched = { enabled: true, openTime: "08:30", closeTime: "18:00", days: [1, 2, 3, 4, 5], stopRunningOnClose: false };
      // Tuesday 09:00 Asia/Jakarta (02:00 UTC), currently closed -> open
      const openDec = evaluateOfficeSchedule(sched, { open: false, timeZone: "Asia/Jakarta", now: new Date("2026-11-24T02:00:00Z") });
      assert.equal(openDec?.action, "open");
      // Same day already auto-opened -> do not fight manual close
      assert.equal(evaluateOfficeSchedule({ ...sched, lastAutoOpenDate: "2026-11-24" }, { open: false, timeZone: "Asia/Jakarta", now: new Date("2026-11-24T03:00:00Z") }), null);
      // Holiday -> close if open
      const holDec = evaluateOfficeSchedule(sched, { open: true, timeZone: "Asia/Jakarta", now: new Date("2026-11-24T03:00:00Z"), calendar: { holidays: ["2026-11-24"] } });
      assert.equal(holDec?.action, "close");
      // Sunday with extraWorkDates -> open if closed
      const extraDec = evaluateOfficeSchedule(sched, { open: false, timeZone: "Asia/Jakarta", now: new Date("2026-11-22T03:00:00Z"), calendar: { extraWorkDates: ["2026-11-22"] } });
      assert.equal(extraDec?.action, "open");
      // After 18:00 -> close
      const closeDec = evaluateOfficeSchedule(sched, { open: true, timeZone: "Asia/Jakarta", now: new Date("2026-11-24T11:30:00Z") });
      assert.equal(closeDec?.action, "close");
    });

    await t.test("watchdog detects & auto-heals stuck runs and performs bounded transient retries", async () => {
      assert.equal(isTransientError("socket hang up ECONNRESET"), true);
      assert.equal(isTransientError("You've hit your 5-hour limit"), false);
      assert.equal(isTransientError("oauth login expired"), false);
      assert.equal(findStuckRuns(runs.a1 as any, now.getTime(), 60).length, 1);

      const report = await runWatchdog({ notify: false, now });
      assert.ok(cancelledRuns.includes("run-stuck"), "stuck run cancelled");
      assert.ok(reruns.includes("stuck1"), "stuck task rerun");
      assert.ok(reruns.includes("trans1"), "transient failure retried");
      assert.ok(report.some(r => r.includes("auto-heal stuck")));
      assert.ok(report.some(r => r.includes("retry transient")));
    });

    await t.test("review task digest summary & question count flow to Office QuickApprovalBar data", async () => {
      const snap = await loadWorkspace("w1");
      const office = buildOffice(snap);
      const item = office.attention.review.find(r => r.id === "rev1");
      assert.ok(item);
      assert.ok(item.summary?.some(s => s.includes("10-slide launch deck")));
      assert.equal(item.questionCount, 1);
    });

    await t.test("approve-handoff closes current task, spawns follow-up with context, and isolates hook errors", async () => {
      const seenHooks: string[] = [];
      const u1 = registerWorkflowHook("ok-hook", "task.handoff", p => { seenHooks.push(p.toTitle); });
      const u2 = registerWorkflowHook("bad-hook", "task.approved", () => { throw new Error("boom"); });
      try {
        const res = await taskPost(
          new Request("http://localhost/api/task/rev1", {
            method: "POST",
            body: JSON.stringify({
              ws: "w1",
              action: "approve-handoff",
              handoff: { assigneeType: "agent", assigneeId: "a2", title: "Publish Launch Deck", detail: "Polish and export PDF", startNow: true },
            }),
          }),
          { params: Promise.resolve({ id: "rev1" }) }
        );
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(issues.w1.find(i => i.id === "rev1")!.status, "done");
        assert.equal(json.handoff.title, "Publish Launch Deck");
        const followUp = issues.w1.find(i => i.id === json.handoff.id)!;
        assert.equal(followUp.assignee_id, "a2");
        assert.equal(followUp.status, "todo");
        assert.match(followUp.description, /Finished 10-slide launch deck/);
        assert.match(followUp.description, /launch-deck\.pptx/);
        assert.deepEqual(seenHooks, ["Publish Launch Deck"]);
      } finally {
        u1();
        u2();
      }
    });

    await t.test("playbooks, agent instruction sync, activity log, metrics, delta sync, and unified attention work end-to-end", async () => {
      // Playbooks
      const saved = await savePlaybook("w1", {
        name: "Custom Bug Squash",
        mode: "staged",
        steps: [
          { title: "Reproduce bug", detail: "Capture repro", stage: 1 },
          { title: "Fix & add test", detail: "Patch code", stage: 2 },
        ],
      });
      assert.ok(listPlaybooks("w1").some(p => p.id === saved.id));
      assert.equal(await deletePlaybook("w1", saved.id), true);

      // Agent instruction health-check & sync
      const diff = computeSyncedInstructions("You are Rara.");
      assert.equal(diff.upToDate, false);
      assert.equal(diff.missing.length, 5);
      const beforeHealth = await inspectWorkspaceInstructions("w1");
      assert.equal(beforeHealth.outdatedCount, 2);
      const synced = await syncWorkspaceInstructions("w1");
      assert.equal(synced.updated.length, 2);
      const afterHealth = await inspectWorkspaceInstructions("w1");
      assert.equal(afterHealth.outdatedCount, 0);

      // Persistent activity log & metrics
      await appendActivity("w1", { kind: "approve", title: "Approved test", source: "api" });
      await appendActivity("w1", { kind: "revise", title: "Revised test", source: "api" });
      const act = readActivity("w1", 20);
      assert.ok(act.length >= 2);
      const metrics = computeWorkspaceMetrics(await loadWorkspace("w1"), act, now);
      assert.equal(metrics.runs.completed, 1);
      assert.equal(metrics.runs.failed, 1);
      assert.equal(metrics.runs.successRate, 50);
      assert.equal(metrics.runs.avgDurationMin, 6);
      assert.ok(metrics.review.firstPassRate !== null);

      // Lightweight delta sync returns 200 then 304 when unchanged
      const sync1 = await syncGet(new Request("http://localhost/api/office/sync?ws=w1"));
      assert.equal(sync1.status, 200);
      const { fp } = await sync1.json();
      assert.ok(fp);
      const sync2 = await syncGet(new Request(`http://localhost/api/office/sync?ws=w1&fp=${fp}`));
      assert.equal(sync2.status, 304);

      // Cross-workspace Unified Attention Hub aggregates both w1 and w2
      issues.w1.find(i => i.id === "rev1")!.status = "in_review";
      const { invalidateWorkspaceCache } = await import("../lib/multica");
      invalidateWorkspaceCache();
      const unified = await unifiedAttnGet();
      assert.equal(unified.status, 200);
      const uJson = await unified.json();
      assert.equal(uJson.workspaces.length, 2);
      assert.ok(uJson.attention.review.some((r: any) => r.ws === "w1"));
      assert.ok(uJson.attention.review.some((r: any) => r.ws === "w2"));
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(before);
    rmSync(dir, { recursive: true, force: true });
  }
});
