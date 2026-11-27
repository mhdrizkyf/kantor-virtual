import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pickContinuitySession } from "../lib/chat-continuity";

test("Chat vs Task separation and conversation continuity", async t => {
  const before = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "kantor-chat-sep-"));
  process.chdir(dir);
  process.env.MULTICA_TOKEN = "test-token";
  process.env.MULTICA_API_URL = "http://multica.test";
  process.env.KANTOR_TIMEZONE = "Asia/Jakarta";

  const now = new Date("2026-11-25T04:00:00Z");
  const nowIso = now.toISOString();
  const minAgo = new Date(now.getTime() - 60_000).toISOString();
  const twoMinAgo = new Date(now.getTime() - 120_000).toISOString();

  let sessions = [
    { id: "s-old", agent_id: "a1", project_id: null, title: "Old brainstorm", status: "active", updated_at: twoMinAgo, created_at: twoMinAgo },
    { id: "s-latest", agent_id: "a1", project_id: null, title: "Ongoing thread", status: "active", updated_at: minAgo, created_at: minAgo },
    { id: "s-arch", agent_id: "a1", project_id: null, title: "Archived thread", status: "archived", updated_at: nowIso, created_at: nowIso },
  ];
  let createdSessionCalls = 0;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const respond = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

    if (path === "/api/workspaces" && method === "GET") {
      return respond({ workspaces: [{ id: "w1", name: "Main HQ", slug: "main" }] });
    }
    if (path === "/api/chat/sessions" && method === "GET") {
      return respond({ sessions });
    }
    if (path === "/api/chat/sessions" && method === "POST") {
      createdSessionCalls++;
      const created = {
        id: `s-new-${createdSessionCalls}`,
        agent_id: body.agent_id,
        project_id: body.project_id ?? null,
        title: body.title,
        status: "active",
        updated_at: nowIso,
        created_at: nowIso,
      };
      sessions = [created, ...sessions];
      return respond(created);
    }
    return respond({ error: `unmocked ${method} ${path}` }, 500);
  }) as typeof fetch;

  try {
    const { buildOffice } = await import("../lib/office");
    const { computeWorkspaceMetrics } = await import("../lib/metrics");
    const { POST: chatPost } = await import("../app/api/chat/route");

    const baseSnapshot = () => ({
      workspace: { id: "w1", name: "Main HQ", slug: "main" },
      agents: [
        { id: "a1", name: "Rara", description: "Research", avatar_url: null, runtime_id: "rt1", status: "active", model: "claude", archived_at: null },
        { id: "a2", name: "Dito", description: "Delivery", avatar_url: null, runtime_id: "rt1", status: "active", model: "codex", archived_at: null },
      ],
      projects: [],
      runtimes: [{ id: "rt1", name: "Laptop", provider: "claude", status: "online", last_seen_at: nowIso, owner_id: "u1" }],
      members: [{ id: "m1", user_id: "u1", name: "Owner", email: "o@example.com", role: "owner" }],
      issues: [
        { id: "i1", identifier: "W1-1", title: "Write launch brief", status: "todo", priority: "medium", due_date: null, start_date: null, project_id: null, assignee_type: "agent" as const, assignee_id: "a1", updated_at: nowIso, last_activity_at: nowIso, created_at: nowIso, metadata: {} },
      ],
      reminders: [],
      runs: [
        // Chat reply run (issue_id === null) — must NOT appear as a Task run or mark desk failed!
        { id: "r-chat-running", agent_id: "a2", issue_id: null, status: "running", error: null, created_at: nowIso, started_at: nowIso, completed_at: null, runtime_id: "rt1" },
        { id: "r-chat-failed", agent_id: "a1", issue_id: null, status: "failed", error: "temporary chat error", created_at: nowIso, started_at: nowIso, completed_at: nowIso, runtime_id: "rt1" },
        { id: "r-task-ok", agent_id: "a1", issue_id: "i1", status: "completed", error: null, created_at: minAgo, started_at: twoMinAgo, completed_at: minAgo, runtime_id: "rt1" },
      ],
      kantor: { open: true },
      seen: {},
      moved: {},
      asking: new Set<string>(),
    });

    await t.test("chat runs (issue_id=null) are excluded from Recent task runs, do not mark desks failed, and show chatting bubble", () => {
      const office = buildOffice(baseSnapshot());
      const desks = office.rooms.flatMap(r => r.desks);
      const rara = desks.find(d => d.agentId === "a1")!;
      const dito = desks.find(d => d.agentId === "a2")!;

      // Rara's Recent task runs only include real issue runs, never the failed chat run
      assert.equal(office.agentsDetail.a1.runs.length, 1);
      assert.equal(office.agentsDetail.a1.runs[0].id, "r-task-ok");
      assert.equal(office.agentsDetail.a1.runs[0].kind, "task");
      // Failed chat-only run must NOT flip Rara's desk into "failed"
      assert.notEqual(rara.state, "failed");

      // Dito replying to a chat shows a chatting bubble (not "Working on: a task") and 0 task runs
      assert.equal(dito.state, "working");
      assert.match(dito.bubble, /Chatting/i);
      assert.doesNotMatch(dito.bubble, /a task/i);
      assert.equal(office.agentsDetail.a2.runs.length, 0);
    });

    await t.test("multiple revision runs on the same task collapse into one Recent task run with runCount", () => {
      const snap = baseSnapshot();
      snap.issues.push({
        id: "i2", identifier: "W1-2", title: "Older distinct task", status: "done", priority: "medium",
        due_date: null, start_date: null, project_id: null, assignee_type: "agent" as const, assignee_id: "a1",
        updated_at: twoMinAgo, last_activity_at: twoMinAgo, created_at: twoMinAgo, metadata: {},
      });
      const office = buildOffice({
        ...snap,
        runs: [
          // 3 revision rounds on i1 + 1 older run on i2 + 1 chat run
          { id: "r-rev-3", agent_id: "a1", issue_id: "i1", status: "completed", error: null, created_at: nowIso, started_at: nowIso, completed_at: nowIso, runtime_id: "rt1" },
          { id: "r-rev-2", agent_id: "a1", issue_id: "i1", status: "completed", error: null, created_at: minAgo, started_at: minAgo, completed_at: minAgo, runtime_id: "rt1" },
          { id: "r-rev-1", agent_id: "a1", issue_id: "i1", status: "failed", error: "old error", created_at: twoMinAgo, started_at: twoMinAgo, completed_at: twoMinAgo, runtime_id: "rt1" },
          { id: "r-i2", agent_id: "a1", issue_id: "i2", status: "completed", error: null, created_at: twoMinAgo, started_at: twoMinAgo, completed_at: twoMinAgo, runtime_id: "rt1" },
          { id: "r-chat", agent_id: "a1", issue_id: null, status: "completed", error: null, created_at: nowIso, started_at: nowIso, completed_at: nowIso, runtime_id: "rt1" },
        ],
      });
      const runs = office.agentsDetail.a1.runs;
      assert.equal(runs.length, 2);
      assert.equal(runs[0].issueId, "i1");
      assert.equal(runs[0].id, "r-rev-3");
      assert.equal(runs[0].status, "completed");
      assert.equal(runs[0].runCount, 3);
      assert.equal(runs[1].issueId, "i2");
      assert.equal(runs[1].runCount, 1);
    });

    await t.test("workspace metrics count real task runs separately from chat replies", () => {
      const m = computeWorkspaceMetrics(baseSnapshot(), [], now);
      assert.equal(m.runs.total, 1);
      assert.equal(m.runs.completed, 1);
      assert.equal(m.runs.failed, 0);
      assert.equal(m.runs.active, 0);
      assert.equal(m.runs.chatRuns, 2);
      assert.equal(m.runs.successRate, 100);
      const raraMetric = m.agents.find(a => a.agentId === "a1")!;
      assert.equal(raraMetric.completedRuns, 1);
      assert.equal(raraMetric.failedRuns, 0);
    });

    await t.test("pickContinuitySession resumes one ongoing conversation per agent unless startFresh is true", () => {
      const list = [
        { id: "s1", agentId: "a1", title: "Older", updatedAt: twoMinAgo },
        { id: "s2", agentId: "a1", title: "Latest", updatedAt: minAgo },
        { id: "s3", agentId: "a2", title: "Dito chat", updatedAt: nowIso },
      ];
      // Default: picks latest session for that agent
      assert.equal(pickContinuitySession(list, "a1")?.id, "s2");
      // Saved active session for that agent takes precedence over newer timestamp
      assert.equal(pickContinuitySession(list, "a1", { savedId: "s1" })?.id, "s1");
      // Stale savedId falls back cleanly to latest for that agent
      assert.equal(pickContinuitySession(list, "a1", { savedId: "deleted-id" })?.id, "s2");
      // Explicit preferredId wins
      assert.equal(pickContinuitySession(list, "a1", { preferredId: "s3", savedId: "s1" })?.id, "s3");
      // Explicit startFresh returns null for a brand-new topic
      assert.equal(pickContinuitySession(list, "a1", { savedId: "s1", startFresh: true }), null);
    });

    await t.test("POST /api/chat with reuseLatest=true continues latest active non-archived session instead of spawning duplicates", async () => {
      const resReuse = await chatPost(new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ws: "w1", agentId: "a1", title: "Follow-up message", reuseLatest: true }),
      }));
      assert.equal(resReuse.status, 200);
      const reusedJson = await resReuse.json();
      assert.equal(reusedJson.id, "s-latest");
      assert.equal(reusedJson.reused, true);
      assert.equal(createdSessionCalls, 0);

      // Explicit new topic (reuseLatest omitted/false) creates a new session
      const resNew = await chatPost(new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ws: "w1", agentId: "a1", title: "Brand new topic" }),
      }));
      assert.equal(resNew.status, 200);
      const newJson = await resNew.json();
      assert.equal(newJson.id, "s-new-1");
      assert.equal(newJson.reused, false);
      assert.equal(createdSessionCalls, 1);

      // Agent with no existing sessions creates one even when reuseLatest=true
      const resFirst = await chatPost(new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ws: "w1", agentId: "a2", title: "First chat with Dito", reuseLatest: true }),
      }));
      assert.equal(resFirst.status, 200);
      const firstJson = await resFirst.json();
      assert.equal(firstJson.id, "s-new-2");
      assert.equal(firstJson.reused, false);
      assert.equal(createdSessionCalls, 2);
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(before);
    rmSync(dir, { recursive: true, force: true });
  }
});
