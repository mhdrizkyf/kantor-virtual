import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOfficeFeedItems,
  countUnreadFeedEvents,
  filterOfficeFeed,
  summarizeOfficeFeedPill,
} from "../lib/office-feed";
import type { Desk, Office } from "../lib/office";
import type { ActivityEvent } from "../lib/munder-workflows";

const sampleDesks: Desk[] = [
  {
    agentId: "a1",
    name: "Rara",
    emoji: null,
    avatar: null,
    face: "raya",
    description: "Product",
    runtime: "Claude",
    runtimeId: "rt1",
    squad: "Delivery",
    state: "working",
    bubble: "Working on: Finalize KR3 milestone",
    reviewCount: 0,
    lateCount: 0,
    riskCount: 0,
    tasks: [
      {
        id: "t1",
        key: "KV-1",
        title: "Finalize KR3 milestone",
        status: "in_progress",
        statusLabel: "In progress",
        due: null,
        dueFlag: null,
        dueText: null,
        url: "https://example.test/t1",
        ws: "ws1",
        wsName: "HQ",
        assignee: "Rara",
        assigneeId: "a1",
        assigneeType: "agent",
        project: "Launch",
        projectId: "p1",
      },
    ],
  },
  {
    agentId: "a2",
    name: "Bima",
    emoji: null,
    avatar: null,
    face: "bima",
    description: "Engineering",
    runtime: "Codex",
    runtimeId: "rt2",
    squad: "Operations",
    state: "review",
    bubble: "Needs review",
    reviewCount: 1,
    lateCount: 0,
    riskCount: 0,
    tasks: [],
  },
];

const sampleAttention: Office["attention"] = {
  overdue: [],
  human: [],
  review: [
    {
      id: "t2",
      key: "KV-2",
      title: "Review onboarding copy",
      status: "in_review",
      statusLabel: "Needs review",
      due: null,
      dueFlag: null,
      dueText: "Today",
      url: "https://example.test/t2",
      ws: "ws1",
      wsName: "HQ",
      assignee: "Bima",
      assigneeId: "a2",
      assigneeType: "agent",
      project: "Growth",
      projectId: "p2",
      summary: ["Ready for final approval"],
      questionCount: 0,
    },
  ],
  failed: [
    {
      id: "r1",
      issueId: "t3",
      ws: "ws1",
      agent: "Bima",
      status: "failed",
      when: "3m ago",
      error: "AI quota used up",
      issueTitle: "Sync analytics job",
      url: null,
    },
  ],
};

const sampleEvents: ActivityEvent[] = [
  { id: "e3", kind: "chat", title: "Chat → Rara", detail: "Tolong cek copy landing page", at: "14:55", agentId: "a1", ws: "ws1" },
  { id: "e2", kind: "approve", title: "Approved: Q4 deck", detail: "Bima", at: "14:40", agentId: "a2", issueId: "t9", ws: "ws1" },
  { id: "e1", kind: "standup", title: "Morning standup", at: "09:00", ws: "ws1" },
];

test("buildOfficeFeedItems merges failed, review, live working desks, and persisted history in priority order", () => {
  const items = buildOfficeFeedItems({
    desks: sampleDesks,
    attention: sampleAttention,
    events: sampleEvents,
    wsId: "ws1",
  });
  assert.equal(items.length, 6);
  assert.equal(items[0].kind, "live-failed");
  assert.equal(items[1].kind, "live-review");
  assert.equal(items[1].face, "bima");
  assert.equal(items[2].kind, "live-working");
  assert.equal(items[2].face, "raya");
  assert.equal(items[3].kind, "event");
  assert.equal(items[3].face, "raya");
});

test("filterOfficeFeed filters by operational tab and search query cleanly", () => {
  const items = buildOfficeFeedItems({
    desks: sampleDesks,
    attention: sampleAttention,
    events: sampleEvents,
    wsId: "ws1",
  });
  assert.equal(filterOfficeFeed(items, "active", "").length, 1);
  assert.equal(filterOfficeFeed(items, "attention", "").length, 2);
  assert.equal(filterOfficeFeed(items, "history", "").length, 3);
  assert.equal(filterOfficeFeed(items, "all", "onboarding").length, 1);
  assert.equal(filterOfficeFeed(items, "all", "rara").length, 2);
});

test("countUnreadFeedEvents and summarizeOfficeFeedPill compute accurate unread counts and live pill status", () => {
  assert.equal(countUnreadFeedEvents(sampleEvents, "e3"), 0);
  assert.equal(countUnreadFeedEvents(sampleEvents, "e2"), 1);
  assert.equal(countUnreadFeedEvents(sampleEvents, "e1"), 2);
  assert.equal(countUnreadFeedEvents([], null), 0);

  const failedPill = summarizeOfficeFeedPill({ workingCount: 1, reviewCount: 2, failedCount: 1, unreadCount: 3 });
  assert.equal(failedPill.tone, "failed");
  assert.equal(failedPill.summary, "1 gagal · 2 review");
  assert.equal(failedPill.badgeCount, 3);

  const workingPill = summarizeOfficeFeedPill({ workingCount: 2, reviewCount: 0, failedCount: 0, unreadCount: 0 });
  assert.equal(workingPill.tone, "working");
  assert.equal(workingPill.summary, "2 aktif");
  assert.equal(workingPill.badgeCount, 0);

  const idlePill = summarizeOfficeFeedPill({ workingCount: 0, reviewCount: 0, failedCount: 0, unreadCount: 0 });
  assert.equal(idlePill.tone, "idle");
  assert.equal(idlePill.summary, null);
});
