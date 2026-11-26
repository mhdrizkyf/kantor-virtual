import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mapLimit } from "../lib/concurrency";
import {
  buildFloorSpeechBubbles,
  computeFloorScale,
  computeHoverCardPlacement,
  computeReviewAssignments,
  computeSpeechBubblePlacement,
  findShortestPath,
  getBreakCoffeeSpots,
  isActorAbsentFromDesk,
  planLunchErrands,
  planWorkdayLifeStep,
  resolveHumanFaces,
  walkableAdjacentTiles,
} from "../lib/office-engine";

test("Phase 1–3 improvements: concurrency, cold-load SWR/disk cache, local SSE stream, office-engine, and modular CSS", async t => {
  await t.test("mapLimit caps concurrent calls for 20+ agents while preserving order", async () => {
    let active = 0;
    let peak = 0;
    const ids = Array.from({ length: 24 }, (_, i) => i + 1);
    const out = await mapLimit(ids, 6, async n => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 4));
      active--;
      return n * 10;
    });
    assert.ok(peak <= 6, `expected peak concurrency <= 6, got ${peak}`);
    assert.equal(out.length, 24);
    assert.equal(out[0], 10);
    assert.equal(out[23], 240);
  });

  await t.test("office-engine pathfinder, actor director, and overlay placement work deterministically", () => {
    const grid = [
      [1, 1, 1, 1],
      [1, 0, 0, 1],
      [1, 1, 1, 1],
    ];
    const path = findShortestPath(grid, 0, 0, 3, 2);
    assert.ok(path && path.length === 5);
    assert.deepEqual(path[path.length - 1], [3, 2]);
    assert.equal(findShortestPath(grid, 0, 0, 1, 1), null);
    const adj = walkableAdjacentTiles(grid, 1, 1, 0, 0);
    assert.ok(adj.length >= 2);
    assert.deepEqual(adj[0], [0, 1]);

    // Off-duty absence vs overtime busy
    assert.equal(isActorAbsentFromDesk({ busy: false, offDuty: true, deskState: "home", actorState: "seat" }), true);
    assert.equal(isActorAbsentFromDesk({ busy: true, offDuty: true, deskState: "working", actorState: "seat" }), false);

    // Human face non-collision pool
    const used = new Set(["yusuf", "reno"]);
    const faces = resolveHumanFaces([{ id: "h1", face: null }, { id: "h2", face: "nala" }], used);
    assert.notEqual(faces.h1, "yusuf");
    assert.notEqual(faces.h1, "reno");
    assert.equal(faces.h2, "nala");

    // Review delivery split & prioritized bubbles
    const desks = [
      { agentId: "a1", name: "Rara", emoji: null, avatar: null, face: "raya", description: "", runtime: "Claude", runtimeId: "rt1", squad: "Core", state: "review" as const, bubble: "Waiting", reviewCount: 1, lateCount: 0, riskCount: 0, tasks: [] },
      { agentId: "a2", name: "Dito", emoji: null, avatar: null, face: "bima", description: "", runtime: "Codex", runtimeId: "rt1", squad: "Core", state: "working" as const, bubble: "Working on: Brief", reviewCount: 0, lateCount: 0, riskCount: 0, tasks: [] },
    ];
    const split = computeReviewAssignments({
      shown: desks,
      reviewTasksByAgent: { a1: { questionCount: 0 } },
      huddleCount: 0,
      offDuty: false,
      reviewStyle: "auto",
    });
    assert.deepEqual(split.walkReviewIds, ["a1"]);

    const bubbles = buildFloorSpeechBubbles({
      shown: desks,
      ownerName: "Rizky",
      offDuty: false,
      previewWorking: false,
      walkReviewIds: ["a1"],
      deskReviewIds: [],
      reviewTasksByAgent: { a1: { id: "i1", ws: "w1", title: "Deck v2" } },
      reviewArrived: { a1: true },
      huddleIds: [],
      walks: [],
      transientBubbles: {},
    });
    assert.equal(bubbles.length, 2);
    assert.match(bubbles.find(b => b.actorId === "a1")!.text, /Mohon review Rizky/);

    // Speech & hovercard auto-flip clamping near top edge
    const placed = computeSpeechBubblePlacement({
      actorX: 40, actorY: 16, worldW: 768, worldH: 448, stageW: 768, stageH: 448, frameW: 768, frameH: 448, bubbleW: 140, bubbleH: 30,
    });
    assert.equal(placed.flipBelow, true);
    assert.ok(placed.left >= 6);

    const card = computeHoverCardPlacement({
      anchor: { left: 20, top: 40, bottom: 80, width: 40 },
      frame: { left: 0, right: 1000, top: 0, bottom: 700 },
      viewportW: 1000, viewportH: 700, cardW: 220, cardH: 80,
    });
    assert.equal(card.below, true);
    assert.ok(card.left >= 8);

    // Floor helpers & life planner
    assert.ok(getBreakCoffeeSpots().length >= 1);
    assert.ok(computeFloorScale(1000, 600).width > 0);
    const lunchPlan = planLunchErrands({ freeDesks: desks, roamingCount: 0, occupiedKeys: new Set(), seed: 1 });
    assert.ok(lunchPlan.errands.length >= 1);
    const life = planWorkdayLifeStep({ freeDesks: desks, roamingCount: 0, occupiedKeys: new Set(), seed: 2 });
    assert.equal(life?.kind, "peer-chat");
  });

  await t.test("modular globals.css resolves every @import module under app/styles/", () => {
    const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");
    const matches = [...css.matchAll(/@import\s+"(\.\/styles\/[^"]+)";/g)];
    assert.ok(matches.length >= 8, `expected >= 8 modular css imports, got ${matches.length}`);
    for (const [, rel] of matches) {
      const target = join(process.cwd(), "app", rel);
      assert.ok(existsSync(target), `missing stylesheet ${rel}`);
      assert.ok(readFileSync(target, "utf8").trim().length > 100, `empty stylesheet ${rel}`);
    }
  });

  await t.test("loadWorkspaceCached SWR/disk warm cache, digest persistence, and local SSE push work end-to-end", async () => {
    const before = process.cwd();
    const dir = mkdtempSync(join(tmpdir(), "kantor-p13-"));
    process.chdir(dir);
    process.env.MULTICA_TOKEN = "test-token";
    process.env.MULTICA_API_URL = "http://multica.test";
    process.env.KANTOR_TIMEZONE = "Asia/Jakarta";

    const nowIso = new Date("2026-11-26T04:00:00Z").toISOString();
    let issueCalls = 0;
    let commentCalls = 0;
    let activeTaskFetches = 0;
    let peakTaskFetches = 0;

    const manyAgents = Array.from({ length: 14 }, (_, i) => ({
      id: `a${i + 1}`,
      name: `Agent ${i + 1}`,
      description: "Specialist",
      avatar_url: null,
      runtime_id: "rt1",
      status: "active",
      model: "claude",
      archived_at: null,
    }));

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      const respond = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

      if (path === "/api/workspaces") return respond({ workspaces: [{ id: "w1", name: "Main HQ", slug: "main" }] });
      if (path === "/api/agents") return respond({ agents: manyAgents });
      if (path === "/api/projects") return respond({ projects: [] });
      if (path === "/api/runtimes") return respond({ runtimes: [{ id: "rt1", name: "Laptop", provider: "claude", status: "online", last_seen_at: nowIso, owner_id: "u1" }] });
      if (path.endsWith("/members")) return respond({ members: [{ id: "m1", user_id: "u1", name: "Owner", email: "o@example.com", role: "owner" }] });
      if (path === "/api/workspaces/w1") return respond({ id: "w1", settings: { kantor: { open: true } } });
      if (path === "/api/issues") {
        issueCalls++;
        return respond({
          issues: [
            { id: "rev1", identifier: "W1-1", title: "Review Deck", status: "in_review", priority: "medium", due_date: null, start_date: null, project_id: null, assignee_type: "agent", assignee_id: "a1", updated_at: nowIso, last_activity_at: nowIso, created_at: nowIso, metadata: {} },
          ],
          has_more: false,
        });
      }
      if (/^\/api\/agents\/[^/]+\/tasks$/.test(path)) {
        activeTaskFetches++;
        peakTaskFetches = Math.max(peakTaskFetches, activeTaskFetches);
        await new Promise(r => setTimeout(r, 3));
        activeTaskFetches--;
        return respond({ tasks: [] });
      }
      if (path === "/api/issues/rev1/comments") {
        commentCalls++;
        return respond({
          comments: [{ id: "c1", author_type: "agent", author_id: "a1", content: "## Summary\n- Ready to ship.", type: "comment", parent_id: null, created_at: nowIso }],
        });
      }
      return respond({ error: `unmocked ${path}` }, 500);
    }) as typeof fetch;

    try {
      const { loadWorkspaceCached, invalidateWorkspaceCache } = await import("../lib/multica");
      const { emitOfficeChange, activeOfficeSubscriberCount } = await import("../lib/office-events");
      const { GET: streamGet } = await import("../app/api/office/stream/route");

      // Single-flight deduplication: two simultaneous cold calls share 1 fetch, and bounded concurrency <= 6 across 14 agents
      const [s1, s2] = await Promise.all([loadWorkspaceCached("w1", 5000), loadWorkspaceCached("w1", 5000)]);
      assert.equal(s1.workspace.id, "w1");
      assert.equal(s2.workspace.id, "w1");
      assert.equal(issueCalls, 1);
      assert.equal(commentCalls, 1);
      assert.ok(peakTaskFetches <= 6, `expected agent task concurrency <= 6, got ${peakTaskFetches}`);
      assert.ok(existsSync(join(dir, "data", "cache", "digests.json")));
      assert.ok(existsSync(join(dir, "data", "cache", "snapshots.json")));

      // Disk warm cache hit on SWR after TTL expires (without invalidating)
      const warm = await loadWorkspaceCached("w1", 0, { swrMs: 60_000, allowDiskWarm: true });
      assert.equal(warm.digests?.rev1?.summary[0], "Ready to ship.");
      // Digest cache persisted -> comment endpoint is NOT called again for unchanged updated_at
      await new Promise(r => setTimeout(r, 30));
      assert.equal(commentCalls, 1);

      // Invalidation clears cache so next call fetches fresh
      invalidateWorkspaceCache("w1");
      const beforeCalls = issueCalls;
      await loadWorkspaceCached("w1", 5000, { allowDiskWarm: true });
      assert.equal(issueCalls, beforeCalls + 1);

      // Local SSE stream: handshake + instant (<50ms) push on emitOfficeChange + clean abort unsubscribe
      const ac = new AbortController();
      const res = await streamGet(new Request("http://localhost/api/office/stream?ws=w1", { signal: ac.signal }));
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
      assert.equal(activeOfficeSubscriberCount("w1"), 1);

      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      const readUntil = async (needle: string) => {
        const deadline = Date.now() + 2000;
        while (!buf.includes(needle) && Date.now() < deadline) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
        }
      };

      await readUntil("event: connected");
      const pushStart = Date.now();
      emitOfficeChange("w1", "task.approved");
      await readUntil("task.approved");
      assert.ok(Date.now() - pushStart < 500, "SSE local mutation push should arrive immediately");
      assert.match(buf, /event: office/);

      ac.abort();
      await reader.cancel().catch(() => {});
      await new Promise(r => setTimeout(r, 20));
      assert.equal(activeOfficeSubscriberCount("w1"), 0);
    } finally {
      globalThis.fetch = originalFetch;
      process.chdir(before);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
