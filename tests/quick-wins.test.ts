import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Top 5 Quick Wins: CSS .p-done polish, quick-search, cached workspace-summary, and integrations health/webhook test", async t => {
  await t.test(".p-done pill is clean success style without strikethrough, while .p-cancelled keeps strikethrough", () => {
    const css = readFileSync(join(process.cwd(), "app", "styles", "01-tokens-base.css"), "utf8");
    const doneBlock = css.match(/\.p-done\s*\{[^}]*\}/)?.[0] ?? "";
    const cancelBlock = css.match(/\.p-cancelled\s*\{[^}]*\}/)?.[0] ?? "";
    assert.ok(doneBlock.length > 0, "expected .p-done rule");
    assert.doesNotMatch(doneBlock, /line-through/);
    assert.match(doneBlock, /--ok-soft/);
    assert.match(cancelBlock, /line-through/);
  });

  await t.test("quick-search, workspace-summary (cached), and integrations health/webhook test endpoints work cleanly", async () => {
    const before = process.cwd();
    const dir = mkdtempSync(join(tmpdir(), "kantor-qw-"));
    process.chdir(dir);
    process.env.MULTICA_TOKEN = "test-token";
    process.env.MULTICA_API_URL = "http://multica.test";
    const prevHookUrl = process.env.KANTOR_WEBHOOK_URL;
    const prevHookSecret = process.env.KANTOR_WEBHOOK_SECRET;
    process.env.KANTOR_WEBHOOK_URL = "http://webhook.test/hook";
    process.env.KANTOR_WEBHOOK_SECRET = "super-secret-xyz";

    const nowIso = new Date("2026-11-27T04:00:00Z").toISOString();
    let webhookPayloads: { headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    let issueCalls = 0;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const respond = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

      if (url.origin === "http://webhook.test") {
        const hdrs: Record<string, string> = {};
        new Headers(init?.headers).forEach((v, k) => { hdrs[k.toLowerCase()] = v; });
        webhookPayloads.push({ headers: hdrs, body: JSON.parse(String(init?.body ?? "{}")) });
        return respond({ received: true }, 200);
      }

      const path = url.pathname;
      if (path === "/api/workspaces") return respond({ workspaces: [{ id: "w1", name: "Main HQ", slug: "main" }] });
      if (path === "/api/agents") return respond({ agents: [{ id: "a1", name: "Rara", description: "Research", avatar_url: null, runtime_id: "rt1", status: "active", model: "claude", archived_at: null }] });
      if (path === "/api/projects") return respond({ projects: [{ id: "p1", title: "Launch", icon: null, status: "active", due_date: null, issue_count: 1, done_count: 0 }] });
      if (path === "/api/runtimes") return respond({ runtimes: [{ id: "rt1", name: "Laptop", provider: "claude", status: "online", last_seen_at: nowIso, owner_id: "u1" }] });
      if (path.endsWith("/members")) return respond({ members: [{ id: "m1", user_id: "u1", name: "Owner", email: "o@example.com", role: "owner" }] });
      if (path === "/api/workspaces/w1") return respond({ id: "w1", settings: { kantor: { open: true } } });
      if (path === "/api/issues") {
        issueCalls++;
        return respond({
          issues: [{ id: "t1", identifier: "W1-1", title: "Polish launch deck", status: "in_review", priority: "high", due_date: null, start_date: null, project_id: "p1", assignee_type: "agent", assignee_id: "a1", updated_at: nowIso, last_activity_at: nowIso, created_at: nowIso, metadata: {} }],
          has_more: false,
        });
      }
      if (/^\/api\/agents\/[^/]+\/tasks$/.test(path)) return respond({ tasks: [] });
      if (path === "/api/issues/t1/comments") return respond({ comments: [] });
      return respond({ error: `unmocked ${path}` }, 500);
    }) as typeof fetch;

    try {
      const { GET: quickSearchGet } = await import("../app/api/quick-search/route");
      const { GET: summaryGet } = await import("../app/api/workspace-summary/route");
      const { GET: integrationsGet, POST: integrationsPost } = await import("../app/api/integrations/route");

      // 1. Quick search index returns agents + open tasks
      const qsRes = await quickSearchGet(new Request("http://localhost/api/quick-search?ws=w1"));
      assert.equal(qsRes.status, 200);
      const qsJson = await qsRes.json();
      assert.equal(qsJson.agents.length, 1);
      assert.equal(qsJson.agents[0].name, "Rara");
      assert.equal(qsJson.tasks.length, 1);
      assert.equal(qsJson.tasks[0].title, "Polish launch deck");

      // 2. Workspace summary reuses warm cache instead of re-fetching Multica uncached
      const callsBeforeSummary = issueCalls;
      const sumRes = await summaryGet(new Request("http://localhost/api/workspace-summary?ws=w1"));
      assert.equal(sumRes.status, 200);
      const sumJson = await sumRes.json();
      assert.equal(sumJson.attention, 1);
      assert.equal(issueCalls, callsBeforeSummary);

      // 3. Integrations GET returns all 5 systems without leaking secret values
      const intRes = await integrationsGet(new Request("http://localhost/api/integrations?ws=w1"));
      assert.equal(intRes.status, 200);
      const intJson = await intRes.json();
      assert.equal(intJson.items.length, 5);
      const serialized = JSON.stringify(intJson);
      assert.doesNotMatch(serialized, /super-secret-xyz/);
      const hookItem = intJson.items.find((x: { id: string }) => x.id === "webhook");
      assert.equal(hookItem.status, "connected");
      assert.equal(hookItem.canTest, true);

      // 4. Integrations POST test-webhook sends signed test ping
      const testRes = await integrationsPost(new Request("http://localhost/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ws: "w1", action: "test-webhook" }),
      }));
      assert.equal(testRes.status, 200);
      const testJson = await testRes.json();
      assert.equal(testJson.ok, true);
      assert.equal(webhookPayloads.length, 1);
      assert.equal(webhookPayloads[0].headers["x-kantor-secret"], "super-secret-xyz");
      assert.equal(webhookPayloads[0].body.event, "webhook.test");
    } finally {
      globalThis.fetch = originalFetch;
      if (prevHookUrl === undefined) delete process.env.KANTOR_WEBHOOK_URL;
      else process.env.KANTOR_WEBHOOK_URL = prevHookUrl;
      if (prevHookSecret === undefined) delete process.env.KANTOR_WEBHOOK_SECRET;
      else process.env.KANTOR_WEBHOOK_SECRET = prevHookSecret;
      process.chdir(before);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
