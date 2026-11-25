import test from "node:test";
import assert from "node:assert/strict";
import { buildOffice } from "../lib/office";
import type { Snapshot } from "../lib/multica";

function baseSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  const now = new Date().toISOString();
  return {
    workspace: { id: "ws1", name: "Demo Office", slug: "demo" },
    agents: [
      { id: "a1", name: "Chief of Staff", description: "", avatar_url: null, runtime_id: "rt-new", status: "idle", model: "", archived_at: null },
    ],
    projects: [],
    runtimes: [
      { id: "rt-new", name: "Codex (Active Laptop)", provider: "codex", status: "online", last_seen_at: now, owner_id: "u1" },
      { id: "rt-old", name: "Hermes (Old Laptop)", provider: "hermes", status: "offline", last_seen_at: now, owner_id: "u1" },
    ],
    members: [{ id: "m1", user_id: "u1", name: "Owner", email: "owner@example.com", role: "owner" }],
    issues: [],
    reminders: [],
    runs: [],
    kantor: { open: true },
    seen: {},
    moved: {},
    asking: new Set<string>(),
    ...overrides,
  };
}

test("stale failure on a previous runtime does not stick after agent switches to an online runtime", () => {
  const now = new Date().toISOString();
  const snap = baseSnapshot({
    issues: [{
      id: "i1", identifier: "D-1", title: "Draft memo", status: "todo", priority: "medium",
      due_date: null, start_date: null, project_id: null, assignee_type: "agent", assignee_id: "a1",
      updated_at: now, last_activity_at: now,
    }],
    runs: [{
      id: "r1", agent_id: "a1", issue_id: "i1", status: "failed",
      error: "hermes provider error: Error code: 401", created_at: now, started_at: now, completed_at: now, runtime_id: "rt-old",
    }],
  });
  const office = buildOffice(snap);
  const desk = office.rooms.flatMap(r => r.desks)[0];
  assert.equal(desk.state, "ready");
  assert.match(desk.bubble, /Ready for 1 task/);
});

test("failure on a closed or reassigned issue does not keep desk in failed state", () => {
  const now = new Date().toISOString();
  const snap = baseSnapshot({
    issues: [{
      id: "i1", identifier: "D-1", title: "Finished task", status: "done", priority: "medium",
      due_date: null, start_date: null, project_id: null, assignee_type: "agent", assignee_id: "a1",
      updated_at: now, last_activity_at: now,
    }],
    runs: [{
      id: "r1", agent_id: "a1", issue_id: "i1", status: "failed",
      error: "temporary error", created_at: now, started_at: now, completed_at: now, runtime_id: "rt-new",
    }],
  });
  const office = buildOffice(snap);
  const desk = office.rooms.flatMap(r => r.desks)[0];
  assert.equal(desk.state, "home");
  assert.equal(desk.bubble, "Standby · ready for tasks");
});

test("recent failure on current runtime for an open assigned issue still surfaces as failed", () => {
  const now = new Date().toISOString();
  const snap = baseSnapshot({
    issues: [{
      id: "i1", identifier: "D-1", title: "Broken task", status: "todo", priority: "medium",
      due_date: null, start_date: null, project_id: null, assignee_type: "agent", assignee_id: "a1",
      updated_at: now, last_activity_at: now,
    }],
    runs: [{
      id: "r1", agent_id: "a1", issue_id: "i1", status: "failed",
      error: "network timeout", created_at: now, started_at: now, completed_at: now, runtime_id: "rt-new",
    }],
  });
  const office = buildOffice(snap);
  const desk = office.rooms.flatMap(r => r.desks)[0];
  assert.equal(desk.state, "failed");
  assert.match(desk.bubble, /Failed:/);
});

test("Multica agent busy status syncs to working and offline unused runtimes do not trigger login alerts", () => {
  const now = new Date().toISOString();
  const snap = baseSnapshot({
    agents: [
      { id: "a1", name: "Chief of Staff", description: "", avatar_url: null, runtime_id: "rt-new", status: "working", model: "", archived_at: null },
    ],
    runs: [{
      id: "r-old-login", agent_id: "a1", issue_id: null, status: "failed",
      error: "oauth login expired", created_at: now, started_at: now, completed_at: now, runtime_id: "rt-old",
    }],
  });
  const office = buildOffice(snap);
  const desk = office.rooms.flatMap(r => r.desks)[0];
  assert.equal(desk.state, "working");
  assert.deepEqual(office.alerts, []);
});
