import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bubbleKindForState,
  buildStandupSummary,
  handoverSpeechPayload,
  interactiveFloorProps,
  meetingSpotsFor,
  ownerReviewSpotsFor,
  parseGoalPlan,
  resolveDropZone,
} from "../lib/munder-workflows";
import { OFFICE_PLAN, OWNER_SEAT } from "../lib/floor-seats";

const AGENTS = [
  { agentId: "a1", name: "Mika", description: "Office manager & planner", squad: "Operations", state: "ready", bubble: "Ready" },
  { agentId: "a2", name: "Sari", description: "Content writer & social copy", squad: "Marketing", state: "working", bubble: "Writing launch copy" },
  { agentId: "a3", name: "Bima", description: "Frontend engineer & UI builder", squad: "Engineering", state: "review", bubble: "Waiting for review" },
  { agentId: "a4", name: "Raya", description: "Market research & competitor analyst", squad: "Strategy", state: "ready", bubble: "Free" },
];

test("bubbleKindForState maps live Multica states to native Munder pixel bubbles", () => {
  assert.equal(bubbleKindForState("working"), "dots");
  assert.equal(bubbleKindForState("review"), "ask");
  assert.equal(bubbleKindForState("break"), "coffee");
  assert.equal(bubbleKindForState("failed"), "drop");
  assert.equal(bubbleKindForState("waiting"), "mail");
  assert.equal(bubbleKindForState("closed"), "zz");
  assert.equal(bubbleKindForState("ready"), null);
});

test("interactiveFloorProps exposes board, server, coffee, and meeting zones inside floor bounds", () => {
  const props = interactiveFloorProps();
  const kinds = props.map(p => p.kind);
  assert.deepEqual(kinds.sort(), ["board", "coffee", "meeting", "server"]);
  for (const p of props) {
    assert.ok(p.x >= 0 && p.x + p.w <= OFFICE_PLAN.cols);
    assert.ok(p.y >= 0 && p.y + p.h <= OFFICE_PLAN.rows);
  }
});

test("meetingSpotsFor returns distinct coordinates around the meeting table", () => {
  const spots = meetingSpotsFor(6);
  assert.equal(spots.length, 6);
  const unique = new Set(spots.map(s => `${s.x},${s.y}`));
  assert.equal(unique.size, 6);
});

test("resolveDropZone identifies target agent desks, meeting room, coffee bar, and open floor", () => {
  const seat0 = OFFICE_PLAN.desks[0];
  const seat1 = OFFICE_PLAN.desks[1];
  const agentDesks = [
    { agentId: "a1", name: "Mika", seatIndex: 0 },
    { agentId: "a2", name: "Sari", seatIndex: 1 },
  ];

  // Dropping a1 onto a2's desk yields a desk handoff
  const onDesk = resolveDropZone((seat1.x + 1) * 16, seat1.y * 16, { draggedAgentId: "a1", agentDesks, humanDesks: [] });
  assert.deepEqual(onDesk, { kind: "desk", agentId: "a2", name: "Sari" });

  // Dropping a1 onto its own desk falls back to floor
  const onSelf = resolveDropZone((seat0.x + 1) * 16, seat0.y * 16, { draggedAgentId: "a1", agentDesks, humanDesks: [] });
  assert.equal(onSelf.kind, "floor");

  // Dropping onto the meeting area triggers meeting huddle
  const onMeeting = resolveDropZone((OFFICE_PLAN.meeting.x + 1) * 16, (OFFICE_PLAN.meeting.y + 1) * 16, {
    draggedAgentId: "a1",
    agentDesks,
    humanDesks: [],
  });
  assert.deepEqual(onMeeting, { kind: "meeting" });

  // Dropping onto the coffee bar triggers coffee break
  const coffeeProp = interactiveFloorProps().find(p => p.kind === "coffee")!;
  const onCoffee = resolveDropZone((coffeeProp.x + 1) * 16, (coffeeProp.y + 1) * 16, {
    draggedAgentId: "a1",
    agentDesks,
    humanDesks: [],
  });
  assert.deepEqual(onCoffee, { kind: "coffee" });
});

test("parseGoalPlan splits connector/arrow goals and matches steps to specialized agents", () => {
  const steps = parseGoalPlan("Research competitor pricing → Write launch blog post → Build landing page UI", AGENTS);
  assert.equal(steps.length, 3);
  assert.equal(steps[0].agentId, "a4"); // Raya (research)
  assert.equal(steps[1].agentId, "a2"); // Sari (writer)
  assert.equal(steps[2].agentId, "a3"); // Bima (frontend/UI)
});

test("parseGoalPlan generates a 3-stage plan for a single high-level goal", () => {
  const steps = parseGoalPlan("Launch Q4 virtual office campaign", AGENTS);
  assert.equal(steps.length, 3);
  assert.ok(steps[0].title.includes("Research"));
  assert.ok(steps[1].title.includes("Execute"));
  assert.ok(steps[2].title.includes("Review"));
});

test("buildStandupSummary groups working, review, and available agents cleanly", () => {
  const summary = buildStandupSummary(AGENTS, { overdue: 1, review: 2, failed: 0 });
  assert.equal(summary.working.map(a => a.name).join(","), "Sari");
  assert.equal(summary.review.map(a => a.name).join(","), "Bima");
  assert.equal(summary.available.length, 2);
  assert.ok(summary.promptText.includes("Team Standup Check-in:"));
  assert.ok(summary.promptText.includes("2 waiting review"));
});

test("ownerReviewSpotsFor queues agents in distinct tiles around the owner's desk", () => {
  const spots = ownerReviewSpotsFor(5);
  assert.equal(spots.length, 5);
  const unique = new Set(spots.map(s => `${s.x},${s.y}`));
  assert.equal(unique.size, 5);
  const ownerDesk = OFFICE_PLAN.desks[OWNER_SEAT];
  for (const s of spots) {
    assert.ok(Math.abs(s.x - ownerDesk.x) <= 3);
    assert.ok(Math.abs(s.y - ownerDesk.y) <= 2);
  }
});

test("handoverSpeechPayload creates informative labels for agent, owner, and revision handoffs", () => {
  const agentToAgent = handoverSpeechPayload({ from: "a1", to: "a2", fromName: "Mika", toName: "Sari", title: "Draft launch announcement" });
  assert.equal(agentToAgent.badge, "Handover");
  assert.match(agentToAgent.text, /Handing off to Sari/);

  const toOwner = handoverSpeechPayload({ from: "a2", to: "person:u1", fromName: "Sari", toName: "Ferianda", title: "Launch copy" });
  assert.equal(toOwner.badge, "Handover");
  assert.match(toOwner.text, /Delivering to Ferianda/);

  const revise = handoverSpeechPayload({ from: "person:u1", to: "a2", fromName: "Ferianda", toName: "Sari", title: "Launch copy", kind: "revise" });
  assert.equal(revise.badge, "Revision");
  assert.equal(revise.tone, "revise");
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assignUniqueFaces, FACES } from "../lib/character-presets";

test("assignUniqueFaces assigns 12 distinct faces without hash collisions and honors saved choices", () => {
  const ids = Array.from({ length: 12 }, (_, i) => `agent-${i + 1}`);
  const assigned = assignUniqueFaces(ids, { "agent-1": "yusuf", "agent-2": "mira" });
  assert.equal(assigned["agent-1"], "yusuf");
  assert.equal(assigned["agent-2"], "mira");
  const unique = new Set(Object.values(assigned));
  assert.equal(unique.size, 12);
});

test("all 12 Retina character presets have distinct 44x64 sprites and matching portraits on disk", () => {
  const hashes = new Set<string>();
  for (const f of FACES) {
    const front = readFileSync(resolve(process.cwd(), `public/art/retina-v2.7/characters/presets/${f.id}/front-0@2x.png`));
    const portrait = readFileSync(resolve(process.cwd(), `public/art/retina-v2.7/characters/presets/${f.id}/portrait@2x.png`));
    assert.equal(front.readUInt32BE(16), 44);
    assert.equal(front.readUInt32BE(20), 64);
    assert.equal(portrait.readUInt32BE(16), 44);
    assert.equal(portrait.readUInt32BE(20), 44);
    hashes.add(front.toString("base64"));
  }
  assert.equal(hashes.size, 12);
});
