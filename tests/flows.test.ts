import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

test("Office loading and critical Multica flows", async t => {
  const before = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "kantor-test-"));
  process.chdir(dir);
  process.env.MULTICA_TOKEN = "test-token";
  process.env.MULTICA_API_URL = "http://multica.test";
  const now = new Date().toISOString();
  type Item = Record<string, any>;
  const issues: Record<string, Item[]> = {
    w1: [
      { id: "review", identifier: "W1-1", title: "Review report", status: "in_review", assignee_type: "agent", assignee_id: "a1" },
      { id: "revise", identifier: "W1-2", title: "Revise report", status: "in_review", assignee_type: "agent", assignee_id: "a1" },
      { id: "queue", identifier: "W1-3", title: "Queued work", status: "todo", assignee_type: "agent", assignee_id: "a1" },
      { id: "first", identifier: "W1-4", title: "First chain step", status: "done", assignee_type: "agent", assignee_id: "a1" },
      { id: "second", identifier: "W1-5", title: "Second chain step", status: "backlog", assignee_type: "agent", assignee_id: "a1" },
    ],
    w2: [{ id: "other", identifier: "W2-1", title: "Other work", status: "todo", assignee_type: "agent", assignee_id: "a2" }],
  };
  for (const list of Object.values(issues)) for (const i of list) Object.assign(i, { priority: "none", due_date: null, start_date: null, project_id: null, updated_at: now, last_activity_at: now, created_at: now, metadata: {}, description: "" });
  const comments: Record<string, Item[]> = {};
  const settings: Record<string, Item> = { w1: {}, w2: {} };
  const autopilots: Record<string, Item[]> = { w1: [{ id: "auto", title: "Daily", status: "active" }], w2: [] };
  let fileHeaders: Headers | null = null;
  let calls = 0, failPath = "", failCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    const url = new URL(String(input));
    const path = url.pathname, method = init?.method ?? "GET";
    const ws = new Headers(init?.headers).get("X-Workspace-ID") ?? "w1";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const respond = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
    if (path === "/api/attachments/fixture/download") {
      fileHeaders = new Headers(init?.headers);
      const partial = fileHeaders.get("range") === "bytes=0-0";
      return new Response(partial ? "#" : "# Preview", { status: partial ? 206 : 200, headers: {
        "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": 'attachment; filename="weekly-report.md"',
        "Accept-Ranges": "bytes", ...(partial ? { "Content-Range": "bytes 0-0/9" } : {}),
      } });
    }
    if (failCount && `${method} ${path}` === failPath) { failCount--; return respond({ error: "injected failure" }, 500); }
    if (path === "/api/workspaces" && method === "GET") return respond({ workspaces: [{ id: "w1", name: "Main", slug: "main" }, { id: "w2", name: "Other", slug: "other" }] });
    if (path === "/api/me") return respond({ id: "user", name: "Owner" });
    if (/^\/api\/workspaces\/w[12]$/.test(path)) {
      const id = path.split("/").pop()!;
      if (method === "PATCH") settings[id] = body.settings;
      return respond({ id, settings: settings[id] });
    }
    if (path.endsWith("/members")) return respond({ members: [{ id: "m1", user_id: "user", name: "Owner", email: "owner@example.com", role: "owner", avatar_url: null }] });
    if (path === "/api/agents") return respond({ agents: [{ id: ws === "w1" ? "a1" : "a2", name: "Agent", description: "", avatar_url: null, runtime_id: "rt", status: "active", model: "", archived_at: null }] });
    if (path === "/api/projects") return respond({ projects: [] });
    if (path === "/api/runtimes") return respond({ runtimes: [{ id: "rt", name: "Laptop", provider: "codex", status: "online", last_seen_at: now, owner_id: "user" }] });
    if (/^\/api\/agents\/[^/]+\/tasks$/.test(path)) return respond({ tasks: [] });
    if (path === "/api/issues" && method === "GET") return respond({ issues: issues[ws], has_more: false });
    if (path === "/api/issues" && method === "POST") {
      const created = { id: `created-${issues[ws].length + 1}`, identifier: `W1-${issues[ws].length + 1}`, priority: "medium", due_date: null, start_date: null, project_id: null, updated_at: now, last_activity_at: now, created_at: now, metadata: {}, description: "", ...body };
      issues[ws].push(created);
      return respond(created);
    }
    if (path === "/api/autopilots") return respond({ autopilots: autopilots[ws] });
    if (path.startsWith("/api/autopilots/") && method === "PATCH") { autopilots[ws][0].status = body.status; return respond({ ok: true }); }
    const parts = path.split("/");
    if (parts[1] === "api" && parts[2] === "issues" && parts[3]) {
      const id = parts[3], issue = issues[ws].find(i => i.id === id);
      if (!issue) return respond({ error: "missing" }, 404);
      if (parts[4] === "comments") {
        if (method === "GET") return respond({ comments: comments[id] ?? [] });
        const c = { id: `c${(comments[id] ?? []).length + 1}`, author_type: "member", author_id: "user", content: body.content, type: "comment", parent_id: null, created_at: now };
        (comments[id] ??= []).push(c); return respond(c);
      }
      if (parts[4] === "attachments") return respond({ attachments: [] });
      if (parts[4] === "active-task") return respond({ tasks: [] });
      if (parts[4] === "metadata") {
        if (method === "DELETE") delete issue.metadata[parts[5]];
        else issue.metadata[parts[5]] = body.value;
        return respond({ ok: true });
      }
      if (parts[4] === "rerun") return respond({ ok: true });
      if (method === "PUT") { Object.assign(issue, body); issue.updated_at = new Date().toISOString(); return respond(issue); }
      if (method === "GET") return respond(issue);
    }
    return respond({ error: `unmocked ${method} ${path}` }, 500);
  }) as typeof fetch;

  try {
    const multica = await import("../lib/multica");
    const { buildOffice } = await import("../lib/office");
    const { POST } = await import("../app/api/task/[id]/route");
    const { POST: createTask } = await import("../app/api/task/route");
    const { closeOffice, openOffice } = await import("../lib/office-control");
    const { addChain, runChains } = await import("../lib/chain");
    const { withProcessLock, ProcessBusyError } = await import("../lib/process-lock");
    const { GET: getFile } = await import("../app/api/file/[id]/route");
    const { attachmentName, localAttachmentHref } = await import("../lib/attachment-meta");
    const { readCharacters, saveCharacter, memberCharacterKey } = await import("../lib/characters");
    const { buildTeam } = await import("../lib/crew");
    const { PATCH: patchCrew } = await import("../app/api/crew/route");
    const { detectTransfers } = await import("../lib/workflow-transitions");
    const { suggestedSquad } = await import("../lib/squad-plan");
    const { readSquads, saveSquad } = await import("../lib/squads");
    const { PATCH: patchSquad } = await import("../app/api/squad/route");
    const { isLunchHour } = await import("../lib/office-time");
    const action = (id: string, action: string, text = "") => POST(new Request(`http://localhost/api/task/${id}`, { method: "POST", body: JSON.stringify({ ws: "w1", action, text }) }), { params: Promise.resolve({ id }) });

    await t.test("workflow transitions show only real handoffs", () => {
      const before = new Map([
        ["review", { who: "a1", status: "in_progress", title: "Review report" }],
        ["delegate", { who: "a1", status: "todo", title: "Delegate task" }],
        ["steady", { who: "a1", status: "todo", title: "Unchanged task" }],
      ]);
      const after = new Map([
        ["review", { who: "a1", status: "in_review", title: "Review report" }],
        ["delegate", { who: "a2", status: "todo", title: "Delegate task" }],
        ["steady", { who: "a1", status: "todo", title: "Unchanged task" }],
        ["new", { who: "a2", status: "todo", title: "New task" }],
      ]);
      const nameOf = (id: string) => ({ a1: "Agent One", a2: "Agent Two", "person:Owner": "Owner" })[id] ?? id;
      assert.deepEqual(detectTransfers(before, after, "Owner", nameOf), [
        { from: "a1", to: "person:Owner", title: "Review report", fromName: "Agent One", toName: "Owner" },
        { from: "a1", to: "a2", title: "Delegate task", fromName: "Agent One", toName: "Agent Two" },
      ]);
      assert.deepEqual(detectTransfers(new Map(), after, "Owner", nameOf), []);
      assert.deepEqual(detectTransfers(after, after, "Owner", nameOf), []);
    });
    await t.test("squad rooms follow role, then a workspace-local desk assignment", async () => {
      assert.equal(suggestedSquad("Delivery & Execution Specialist", "Helps with QA evidence"), "Delivery");
      assert.equal(suggestedSquad("Runtime QA Agent", "Checks delivery"), "Quality & Governance");
      await saveSquad("w1", "a1", "Operations");
      assert.equal(readSquads("w1").a1, "Operations");
      assert.equal(readSquads("w2").a1, undefined);
      const changed = await patchSquad(new Request("http://localhost/api/squad", { method: "PATCH", body: JSON.stringify({ ws: "w1", agentId: "a1", squad: "Research" }) }));
      assert.equal(changed.status, 200);
      assert.equal(readSquads("w1").a1, "Research");
      const office = buildOffice(await multica.loadWorkspace("w1"));
      assert.equal(office.rooms.find(r => r.name === "Research")?.desks[0].agentId, "a1");
      assert.equal(office.idleDesks.length, 0);
      const invalid = await patchSquad(new Request("http://localhost/api/squad", { method: "PATCH", body: JSON.stringify({ ws: "w1", agentId: "a1", squad: "" }) }));
      assert.equal(invalid.status, 400);
    });
    await t.test("breakout hour uses office timezone and closes at 13:00", () => {
      assert.equal(isLunchHour("Asia/Jakarta", new Date("2026-11-23T04:59:00Z")), false);
      assert.equal(isLunchHour("Asia/Jakarta", new Date("2026-11-23T05:00:00Z")), true);
      assert.equal(isLunchHour("Asia/Jakarta", new Date("2026-11-23T05:59:00Z")), true);
      assert.equal(isLunchHour("Asia/Jakarta", new Date("2026-11-23T06:00:00Z")), false);
    });

    await t.test("character choices persist per workspace and reject unknown faces", async () => {
      await saveCharacter("w1", "a1", "mira");
      assert.equal(readCharacters("w1").a1, "mira");
      assert.equal(readCharacters("w2").a1, undefined);
      await assert.rejects(() => saveCharacter("w1", "a1", "unknown"));
      assert.equal(readCharacters("w1").a1, "mira");
    });
    await t.test("changing only a character does not update the Multica agent profile", async () => {
      const res = await patchCrew(new Request("http://localhost/api/crew", { method: "PATCH", body: JSON.stringify({ ws: "w1", agentId: "a1", face: "nala" }) }));
      assert.equal(res.status, 200);
      assert.equal(readCharacters("w1").a1, "nala");
      const bad = await patchCrew(new Request("http://localhost/api/crew", { method: "PATCH", body: JSON.stringify({ ws: "w1", agentId: "a1", face: "not-a-face" }) }));
      assert.equal(bad.status, 400);
      assert.equal(readCharacters("w1").a1, "nala");
    });
    await t.test("human member avatar choices persist per workspace and flow to office and team views", async () => {
      const res = await patchCrew(new Request("http://localhost/api/crew", { method: "PATCH", body: JSON.stringify({ ws: "w1", memberId: "user", face: "raya" }) }));
      assert.equal(res.status, 200);
      assert.equal(readCharacters("w1")[memberCharacterKey("user")], "raya");
      assert.equal(readCharacters("w2")[memberCharacterKey("user")], undefined);

      const badFace = await patchCrew(new Request("http://localhost/api/crew", { method: "PATCH", body: JSON.stringify({ ws: "w1", memberId: "user", face: "nope" }) }));
      assert.equal(badFace.status, 400);
      const unknownMember = await patchCrew(new Request("http://localhost/api/crew", { method: "PATCH", body: JSON.stringify({ ws: "w1", memberId: "missing-user", face: "raya" }) }));
      assert.equal(unknownMember.status, 404);

      const snap = await multica.loadWorkspace("w1");
      const office = buildOffice(snap);
      assert.equal(office.members.find(m => m.id === "user")?.face, "raya");
      const team = buildTeam(snap, [], "user");
      assert.equal(team.humans.find(h => h.id === "user")?.face, "raya");
    });

    await t.test("selected Office uses fewer API calls than loading every workspace", async () => {
      calls = 0;
      const baselineStart = performance.now();
      await Promise.all(["w1", "w2"].map(async ws => buildOffice(await multica.loadWorkspace(ws))));
      const baseline = calls, baselineMs = performance.now() - baselineStart;
      calls = 0;
      const selectedStart = performance.now();
      buildOffice(await multica.loadWorkspace("w1"));
      const selectedMs = performance.now() - selectedStart;
      assert.ok(calls < baseline, `selected ${calls}, baseline ${baseline}`);
      t.diagnostic(`mock API: baseline ${baseline} calls / ${baselineMs.toFixed(1)}ms, selected ${calls} calls / ${selectedMs.toFixed(1)}ms`);
    });
    await t.test("board moves validate destinations and protect running or finished tasks", async () => {
      const move = (status: string) => POST(new Request("http://localhost/api/task/queue", {method:"POST",body:JSON.stringify({ws:"w1",action:"move",status})}), {params:Promise.resolve({id:"queue"})});
      assert.equal((await move("backlog")).status, 200);
      assert.equal(issues.w1.find(i=>i.id==="queue")!.status, "backlog");
      assert.equal((await move("invalid")).status, 400);
      issues.w1.find(i=>i.id==="queue")!.status="in_progress";
      assert.equal((await move("todo")).status, 409);
      issues.w1.find(i=>i.id==="queue")!.status="done";
      assert.equal((await move("todo")).status, 409);
      issues.w1.find(i=>i.id==="queue")!.status="todo";
    });

    await t.test("agent desk drawer can assign existing cards and create prioritized project tasks", async () => {
      issues.w1.push({ id: "unassigned-1", identifier: "W1-9", title: "Draft launch email", status: "backlog", assignee_type: null, assignee_id: null, priority: "medium", due_date: null, start_date: null, project_id: "p1", updated_at: now, last_activity_at: now, created_at: now, metadata: {}, description: "" });
      const office = buildOffice(await multica.loadWorkspace("w1"));
      const openCard = office.openTasks.find(x => x.id === "unassigned-1");
      assert.ok(openCard);
      assert.equal(openCard.assigneeId, null);
      assert.equal(openCard.projectId, "p1");
      assert.equal(office.rooms.flatMap(r => r.desks).find(d => d.agentId === "a1")?.runtimeId, "rt");

      const assign = (id: string, body: Record<string, unknown>) =>
        POST(new Request(`http://localhost/api/task/${id}`, { method: "POST", body: JSON.stringify({ ws: "w1", action: "assign", ...body }) }), { params: Promise.resolve({ id }) });

      assert.equal((await assign("unassigned-1", { assigneeType: "agent", assigneeId: "a1", startNow: true })).status, 200);
      const card = issues.w1.find(i => i.id === "unassigned-1")!;
      assert.equal(card.assignee_type, "agent");
      assert.equal(card.assignee_id, "a1");
      assert.equal(card.status, "todo");
      assert.match(comments["unassigned-1"][0].content, /Assigned to Agent/);

      assert.equal((await assign("unassigned-1", { assigneeType: "agent", assigneeId: "a1", startNow: false })).status, 200);
      assert.equal(card.status, "backlog");

      card.status = "in_progress";
      assert.equal((await assign("unassigned-1", { assigneeType: "agent", assigneeId: "a1", startNow: true })).status, 409);
      card.status = "backlog";

      const createdRes = await createTask(new Request("http://localhost/api/task", {
        method: "POST",
        body: JSON.stringify({ ws: "w1", agentId: "a1", title: "Build KPI deck", projectId: "p1", priority: "high", now: true }),
      }));
      assert.equal(createdRes.status, 200);
      const createdJson = await createdRes.json();
      const created = issues.w1.find(i => i.id === createdJson.id)!;
      assert.equal(created.assignee_id, "a1");
      assert.equal(created.project_id, "p1");
      assert.equal(created.priority, "high");
      assert.equal(created.status, "todo");
    });

    await t.test("approve closes task; revise records feedback and queues work", async () => {
      assert.equal((await action("review", "approve")).status, 200);
      assert.equal(issues.w1.find(i => i.id === "review")!.status, "done");
      assert.equal((comments.review ?? []).length, 1);
      assert.equal((await action("revise", "revise", "Fix the summary")).status, 200);
      assert.equal(issues.w1.find(i => i.id === "revise")!.status, "todo");
      assert.match(comments.revise[0].content, /Fix the summary/);
    });
    await t.test("close resumes after failure and open restores parked work", async () => {
      failPath = "PUT /api/issues/queue"; failCount = 1;
      await assert.rejects(closeOffice("w1", false));
      assert.equal(settings.w1.kantor.transition.action, "close");
      assert.equal(autopilots.w1[0].status, "paused");
      await closeOffice("w1", false);
      assert.equal(issues.w1.find(i => i.id === "queue")!.status, "backlog");
      assert.equal(settings.w1.kantor.transition, undefined);
      await openOffice("w1");
      assert.equal(issues.w1.find(i => i.id === "queue")!.status, "todo");
      assert.equal(autopilots.w1[0].status, "active");
      assert.equal(settings.w1.kantor.open, true);
    });
    await t.test("chain recovers after comment failure without duplicate start", async () => {
      addChain({ id: "chain", ws: "w1", title: "Sequence", issues: ["first", "second"], message: "Begin work" });
      failPath = "POST /api/issues/second/comments"; failCount = 1;
      await assert.rejects(runChains({ settleMs: 0 }));
      assert.deepEqual(JSON.parse(readFileSync(join(dir, "data/chains.json"), "utf8"))[0].starting, ["second"]);
      await runChains({ settleMs: 0 });
      await runChains({ settleMs: 0 });
      assert.equal(comments.second.length, 1);
      assert.match(comments.second[0].content, /kantor-chain:chain:second/);
    });
    await t.test("second process cannot enter a held critical section", async () => {
      let release!: () => void;
      const held = withProcessLock("same-work", () => new Promise<void>(r => { release = r; }));
      await assert.rejects(withProcessLock("same-work", async () => {}), ProcessBusyError);
      release(); await held;
      await withProcessLock("same-work", async () => {});
    });
    await t.test("attachment preview and download use the server-side Multica login", async () => {
      assert.equal(attachmentName('attachment; filename="weekly-report.md"', "text/plain", "fixture"), "weekly-report.md");
      assert.equal(localAttachmentHref("https://multica.ai/api/attachments/fixture/download", "w1"), "/lampiran/fixture?ws=w1");
      assert.equal(localAttachmentHref("https://example.org/report", "w1"), "https://example.org/report");
      const ctx = { params: Promise.resolve({ id: "fixture" }) };
      const preview = await getFile(new Request("http://localhost/api/file/fixture?ws=w1"), ctx);
      assert.equal(preview.status, 200);
      assert.equal(await preview.text(), "# Preview");
      assert.equal(fileHeaders?.get("authorization"), "Bearer test-token");
      assert.equal(fileHeaders?.get("x-workspace-id"), "w1");
      const download = await getFile(new Request("http://localhost/api/file/fixture?ws=w1&download=1", { headers: { Range: "bytes=0-0" } }), ctx);
      assert.equal(download.status, 206);
      assert.equal(download.headers.get("content-range"), "bytes 0-0/9");
      assert.match(download.headers.get("content-disposition") ?? "", /attachment; filename\*=UTF-8''weekly-report\.md/);
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(before);
    rmSync(dir, { recursive: true, force: true });
  }
});
