import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bubbleKindForState,
  buildStandupSummary,
  buildTwoWayDialog,
  handoverSpeechPayload,
  interactiveFloorProps,
  meetingSpotsFor,
  NATURAL_ACTIVITIES,
  OWNER_ACTIVITIES,
  ownerReviewSpotsFor,
  parseGoalPlan,
  partitionReviewDelivery,
  pickNaturalActivity,
  pickOwnerInteraction,
  resolveDropZone,
  resolveHandoverDelivery,
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

test("assignUniqueFaces assigns 24 distinct faces without hash collisions and honors saved choices", () => {
  assert.equal(FACES.length, 24);
  const ids = Array.from({ length: FACES.length }, (_, i) => `agent-${i + 1}`);
  const assigned = assignUniqueFaces(ids, { "agent-1": "yusuf", "agent-2": "mira", "agent-3": "faris" });
  assert.equal(assigned["agent-1"], "yusuf");
  assert.equal(assigned["agent-2"], "mira");
  assert.equal(assigned["agent-3"], "faris");
  const unique = new Set(Object.values(assigned));
  assert.equal(unique.size, FACES.length);
});

test("all 24 Retina character presets have distinct 44x64 sprites and matching portraits on disk", () => {
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
  assert.equal(hashes.size, 24);
});

test("2-way workflow dialogs, dual handover/review delivery modes, and natural human activities", () => {
  const ho = buildTwoWayDialog({ kind: "handoff", fromName: "Mika", toName: "Sari", title: "Deck Review" });
  assert.match(ho.senderText, /Task dihandover ke Sari/);
  assert.match(ho.replyText, /task diterima/i);

  const appr = buildTwoWayDialog({ kind: "approve", fromName: "Owner", toName: "Bima", title: "Landing Page" });
  assert.match(appr.senderText, /approved/i);
  assert.match(appr.replyText, /terima kasih/i);

  assert.equal(resolveHandoverDelivery("walk", 2), "walk");
  assert.equal(resolveHandoverDelivery("bubble", 0), "bubble");
  assert.equal(resolveHandoverDelivery("auto", 0), "walk");
  assert.equal(resolveHandoverDelivery("auto", 1), "bubble");

  // Review partitioning: questions stay at desk with bubble in auto mode, up to 3 walk to owner
  const partAuto = partitionReviewDelivery(
    ["a1", "a2", "a3", "a4", "a5"],
    { a2: { questionCount: 1 } },
    "auto"
  );
  assert.deepEqual(partAuto.walkToOwner, ["a1", "a3", "a4"]);
  assert.deepEqual(partAuto.deskBubbleOnly, ["a2", "a5"]);
  assert.deepEqual(partitionReviewDelivery(["a1", "a2"], {}, "bubble").walkToOwner, []);
  assert.deepEqual(partitionReviewDelivery(["a1", "a2"], {}, "walk").walkToOwner, ["a1", "a2"]);

  // All natural human activity coordinates lie inside campus bounds and filter cleanly for lunch
  for (const act of NATURAL_ACTIVITIES) {
    assert.ok(act.x >= 2 && act.x < OFFICE_PLAN.cols - 2);
    assert.ok(act.y >= 3 && act.y < OFFICE_PLAN.rows - 2);
  }
  const lunchPick = pickNaturalActivity({ lunch: true, seed: 3 });
  assert.ok(lunchPick && lunchPick.spot.lunchFriendly);
  const workPick = pickNaturalActivity({ lunch: false, seed: 5 });
  assert.ok(workPick && workPick.line.length > 0);
});

test("Human owner natural interactions cover all studio areas and 2-way agent check-ins", () => {
  // Every owner spot lies inside walkable floor bounds and covers coffee, pantry, washroom, lounge, board, hub, boardroom
  const kinds = new Set(OWNER_ACTIVITIES.map(s => s.kind));
  for (const required of ["coffee", "pantry", "washroom", "lounge", "board", "hub", "boardroom"] as const) {
    assert.ok(kinds.has(required), `Missing owner activity kind: ${required}`);
  }
  for (const spot of OWNER_ACTIVITIES) {
    assert.ok(spot.x >= 2 && spot.x < OFFICE_PLAN.cols - 2);
    assert.ok(spot.y >= 3 && spot.y < OFFICE_PLAN.rows - 2);
    assert.ok(spot.departLines.length > 0 && spot.arriveLines.length > 0);
  }

  // Real BFS walkability check from OWNER_SEAT to every single Owner activity spot
  const grid = Array.from({ length: OFFICE_PLAN.rows }, (_, y) =>
    Array.from({ length: OFFICE_PLAN.cols }, (_, x) => (x >= 2 && x < 46 && y >= 3 && y < 24 ? 1 : 0))
  );
  const block = (x: number, y: number, w: number, h: number) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (grid[j]?.[i] !== undefined) grid[j][i] = 0;
  };
  OFFICE_PLAN.walls.forEach(p => block(p.x, p.y, p.w, p.h));
  OFFICE_PLAN.props.forEach(p => {
    if (p.k === "lounge") {
      ([[11, 19, 1, 4], [13, 19, 2, 4], [15, 20, 2, 3], [18, 19, 2, 2], [18, 22, 2, 2]] as const).forEach(([a, b, c, d]) => block(a, b, c, d));
    } else block(p.x, p.y, p.w, p.h);
  });
  OFFICE_PLAN.desks.forEach(d => block(d.x, d.y, 2, 1));
  const bfsSteps = (sx: number, sy: number, tx: number, ty: number) => {
    const q: [number, number, number][] = [[sx, sy, 0]];
    const seen = new Set([`${sx},${sy}`]);
    while (q.length) {
      const [cx, cy, dist] = q.shift()!;
      if (cx === tx && cy === ty) return dist;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, k = `${nx},${ny}`;
        if (!seen.has(k) && grid[ny]?.[nx]) { seen.add(k); q.push([nx, ny, dist + 1]); }
      }
    }
    return -1;
  };
  const ownerDesk = OFFICE_PLAN.desks[OWNER_SEAT];
  const ox = ownerDesk.x, oy = ownerDesk.seat === "n" ? ownerDesk.y - 1 : ownerDesk.y + 1;
  for (const spot of OWNER_ACTIVITIES) {
    assert.equal(grid[spot.y][spot.x], 1, `${spot.id} (${spot.x},${spot.y}) must be walkable`);
    assert.ok(bfsSteps(ox, oy, spot.x, spot.y) > 0, `${spot.id} (${spot.x},${spot.y}) must be reachable from OWNER_SEAT`);
  }

  // Explicit preferredKind routes directly to Coffee Bar, Pantry, Washroom, Lounge, and Agent visits
  const coffee = pickOwnerInteraction({ lunch: false, seed: 1, agents: AGENTS, preferredKind: "coffee" });
  assert.equal(coffee?.type, "spot");
  assert.equal(coffee.spot.kind, "coffee");

  const washroom = pickOwnerInteraction({ lunch: false, seed: 2, agents: AGENTS, preferredKind: "washroom" });
  assert.equal(washroom?.type, "spot");
  assert.equal(washroom.spot.kind, "washroom");

  const visit = pickOwnerInteraction({ lunch: false, seed: 1, agents: AGENTS, preferredKind: "agent" });
  assert.equal(visit?.type, "visit-agent");
  assert.ok(visit.ownerLine.length > 0 && visit.agentReply.length > 0);
  assert.ok(!visit.ownerLine.includes("{agent}"));

  // Autonomous rotation produces both room strolls and agent visits, avoiding immediate repeats
  const seenTypes = new Set<string>();
  let lastKey: string | null = null;
  for (let seed = 1; seed <= 12; seed++) {
    const plan = pickOwnerInteraction({ lunch: false, seed, agents: AGENTS, lastTargetKey: lastKey });
    assert.ok(plan);
    seenTypes.add(plan.type);
    const key = plan.type === "visit-agent" ? `agent:${plan.agent.agentId}` : `spot:${plan.spot.id}`;
    assert.notEqual(key, lastKey);
    lastKey = key;
  }
  assert.ok(seenTypes.has("spot") && seenTypes.has("visit-agent"));
});
