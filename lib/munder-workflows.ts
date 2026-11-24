import { OFFICE_PLAN, OWNER_SEAT } from "./floor-seats";

export type BubbleKind = "dots" | "coffee" | "check" | "ask" | "heart" | "idea" | "sun" | "drop" | "zz" | "mail";

export type SpeechBubbleTone = "working" | "handover" | "review" | "approved" | "revise" | "failed" | "standup" | "coffee";

export type SpeechBubbleItem = {
  actorId: string;
  tone: SpeechBubbleTone;
  badge: string;
  text: string;
  issueId?: string;
  ws?: string;
  clickable?: boolean;
};

export type FloorPropKind = "board" | "server" | "coffee" | "meeting";

export type InteractiveProp = {
  kind: FloorPropKind;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  hint: string;
};

export type DropZone =
  | { kind: "desk"; agentId: string; name: string }
  | { kind: "human"; name: string }
  | { kind: "meeting" }
  | { kind: "coffee" }
  | { kind: "board" }
  | { kind: "server" }
  | { kind: "floor" };

export type ActivityKind = "handoff" | "approve" | "revise" | "delegate" | "standup" | "coffee" | "door" | "drag";

export type ActivityEvent = {
  id: string;
  kind: ActivityKind;
  title: string;
  detail?: string;
  at: string;
  agentId?: string;
  issueId?: string;
  ws?: string;
};

export type GoalStepDraft = {
  id: string;
  title: string;
  detail: string;
  agentId: string;
};

export type AgentBrief = {
  agentId: string;
  name: string;
  description: string;
  squad: string;
  state?: string;
  bubble?: string;
};

export type StandupSummary = {
  working: AgentBrief[];
  review: AgentBrief[];
  available: AgentBrief[];
  overdueCount: number;
  reviewCount: number;
  failedCount: number;
  promptText: string;
};

const T = 16;

/** Map live Multica desk states to native Munder pixel bubbles. */
export function bubbleKindForState(state: string): BubbleKind | null {
  switch (state) {
    case "working":
      return "dots";
    case "review":
      return "ask";
    case "waiting":
    case "human":
      return "mail";
    case "break":
      return "coffee";
    case "failed":
      return "drop";
    case "closed":
    case "home":
    case "off":
      return "zz";
    default:
      return null;
  }
}

/** Interactive floor props derived from the shared campus floor plan. */
export function interactiveFloorProps(): InteractiveProp[] {
  const props = OFFICE_PLAN.props;
  const board = props.find(p => p.k === "board");
  const server = props.find(p => p.k === "server");
  const coffee = props.find(p => p.k === "coffee");
  const out: InteractiveProp[] = [];
  if (board) {
    out.push({
      kind: "board",
      x: board.x,
      y: board.y,
      w: board.w,
      h: board.h,
      title: "Task Board",
      hint: "Open Kanban board & all project tasks",
    });
  }
  if (server) {
    out.push({
      kind: "server",
      x: server.x,
      y: server.y,
      w: server.w,
      h: server.h,
      title: "AI Engine Rack",
      hint: "Inspect live Codex / Claude runtimes & controls",
    });
  }
  if (coffee) {
    out.push({
      kind: "coffee",
      x: coffee.x,
      y: coffee.y,
      w: coffee.w,
      h: coffee.h,
      title: "Coffee Machine Bar",
      hint: "Send free agents to the coffee machine bar or kitchen for a break",
    });
  }
  out.push({
    kind: "meeting",
    x: OFFICE_PLAN.meeting.x,
    y: OFFICE_PLAN.meeting.y,
    w: OFFICE_PLAN.meeting.w,
    h: OFFICE_PLAN.meeting.h,
    title: "Meeting Area",
    hint: "Call a live Team Standup huddle",
  });
  return out;
}

/** Percentage CSS box for any tile-grid rectangle on the campus canvas. */
export function tileRectBounds(r: { x: number; y: number; w: number; h: number }) {
  return {
    left: `${(r.x / OFFICE_PLAN.cols) * 100}%`,
    top: `${(r.y / OFFICE_PLAN.rows) * 100}%`,
    width: `${(r.w / OFFICE_PLAN.cols) * 100}%`,
    height: `${(r.h / OFFICE_PLAN.rows) * 100}%`,
  };
}

/**
 * Distinct walkable gathering tiles around the meeting table so agents stand
 * in a clean ring during a Standup Huddle without overlapping.
 */
export function meetingSpotsFor(count: number, isWalkable?: (x: number, y: number) => boolean): { x: number; y: number; face: "up" | "down" }[] {
  const m = OFFICE_PLAN.meeting;
  const candidates: { x: number; y: number; face: "up" | "down" }[] = [
    { x: m.x, y: m.y, face: "down" },
    { x: m.x + 1, y: m.y, face: "down" },
    { x: m.x + 2, y: m.y, face: "down" },
    { x: m.x + 3, y: m.y, face: "down" },
    { x: m.x - 1, y: m.y + 1, face: "down" },
    { x: m.x + m.w, y: m.y + 1, face: "down" },
    { x: m.x, y: m.y + m.h, face: "up" },
    { x: m.x + 2, y: m.y + m.h, face: "up" },
    { x: m.x + 1, y: m.y - 1, face: "down" },
    { x: m.x + 3, y: m.y - 1, face: "down" },
  ];
  const valid = isWalkable ? candidates.filter(c => isWalkable(c.x, c.y)) : candidates;
  const pool = valid.length ? valid : candidates;
  const result: { x: number; y: number; face: "up" | "down" }[] = [];
  for (let i = 0; i < count; i++) result.push(pool[i % pool.length]);
  return result;
}

/**
 * Distinct walkable waiting positions directly in front of and beside the human owner's desk
 * so agents awaiting approval queue neatly inside the owner's office facing the owner.
 */
export function ownerReviewSpotsFor(
  count: number,
  isWalkable?: (x: number, y: number) => boolean
): { x: number; y: number; face: "up" | "down" }[] {
  const desk = OFFICE_PLAN.desks[OWNER_SEAT] ?? { x: 6, y: 22, seat: "n" };
  const candidates: { x: number; y: number; face: "up" | "down" }[] = [
    { x: desk.x, y: desk.y + 1, face: "up" },
    { x: desk.x + 1, y: desk.y + 1, face: "up" },
    { x: desk.x + 2, y: desk.y, face: "down" },
    { x: desk.x - 1, y: desk.y, face: "down" },
    { x: desk.x + 2, y: desk.y - 1, face: "down" },
    { x: desk.x + 2, y: desk.y + 1, face: "up" },
    { x: desk.x - 1, y: desk.y + 1, face: "up" },
    { x: desk.x + 3, y: desk.y, face: "down" },
  ];
  const valid = isWalkable ? candidates.filter(c => isWalkable(c.x, c.y)) : candidates;
  const pool = valid.length ? valid : candidates;
  const result: { x: number; y: number; face: "up" | "down" }[] = [];
  for (let i = 0; i < count; i++) result.push(pool[i % pool.length]);
  return result;
}

export function compactLabel(text: string, max = 36): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

/** Generate an informative live speech bubble payload for an active handover walk. */
export function handoverSpeechPayload(h: {
  from: string;
  to: string;
  fromName: string;
  toName: string;
  title: string;
  kind?: "assign" | "revise" | "review" | "handoff";
}): { badge: string; text: string; tone: SpeechBubbleTone } {
  const short = compactLabel(h.title, 34);
  if (h.kind === "revise") {
    return { badge: "Revision", text: `Revise → ${h.toName}: ${short}`, tone: "revise" };
  }
  if (h.kind === "review" || h.to.startsWith("person:")) {
    return { badge: "Handover", text: `Delivering to ${h.toName}: ${short}`, tone: "handover" };
  }
  if (h.from.startsWith("person:") || h.kind === "assign") {
    return { badge: "Assigning", text: `Handover → ${h.toName}: ${short}`, tone: "handover" };
  }
  return { badge: "Handover", text: `Handing off to ${h.toName}: ${short}`, tone: "handover" };
}

/** Resolve a world-pixel drop coordinate to an interactive desk, prop, or open floor. */
export function resolveDropZone(
  worldX: number,
  worldY: number,
  opts: {
    draggedAgentId: string;
    agentDesks: { agentId: string; name: string; seatIndex: number }[];
    humanDesks: { name: string; seatIndex: number }[];
  }
): DropZone {
  const tx = worldX / T;
  const ty = worldY / T;

  // Check other agents' desks first (generous 2.4x2.4 tile hit area around desk+seat)
  for (const d of opts.agentDesks) {
    if (d.agentId === opts.draggedAgentId) continue;
    const seat = OFFICE_PLAN.desks[d.seatIndex];
    if (!seat) continue;
    const minX = seat.x - 0.3;
    const maxX = seat.x + 2.3;
    const minY = seat.seat === "n" ? seat.y - 1.5 : seat.y - 0.4;
    const maxY = seat.seat === "n" ? seat.y + 1.4 : seat.y + 2.3;
    if (tx >= minX && tx <= maxX && ty >= minY && ty <= maxY) {
      return { kind: "desk", agentId: d.agentId, name: d.name };
    }
  }

  for (const h of opts.humanDesks) {
    const seat = OFFICE_PLAN.desks[h.seatIndex];
    if (!seat) continue;
    const minX = seat.x - 0.3;
    const maxX = seat.x + 2.3;
    const minY = seat.seat === "n" ? seat.y - 1.5 : seat.y - 0.4;
    const maxY = seat.seat === "n" ? seat.y + 1.4 : seat.y + 2.3;
    if (tx >= minX && tx <= maxX && ty >= minY && ty <= maxY) {
      return { kind: "human", name: h.name };
    }
  }

  // Check interactive props (with a 0.5-tile generous margin)
  for (const prop of interactiveFloorProps()) {
    if (tx >= prop.x - 0.5 && tx <= prop.x + prop.w + 0.5 && ty >= prop.y - 0.5 && ty <= prop.y + prop.h + 0.5) {
      return { kind: prop.kind };
    }
  }

  return { kind: "floor" };
}

const ROLE_KEYWORDS: { pattern: RegExp; tags: string[] }[] = [
  { pattern: /\b(research|riset|analis|analysis|data|audit|cari|survey|benchmark|competitor|market)\b/i, tags: ["research", "analyst", "data", "strategy", "riset"] },
  { pattern: /\b(design|desain|ui|ux|visual|mockup|wireframe|brand|poster|slide|banner|ilustrasi|layout)\b/i, tags: ["design", "desain", "ui", "ux", "creative", "brand", "art"] },
  { pattern: /\b(code|kode|build|implement|fix|bug|api|backend|frontend|deploy|script|feature|dev|refactor|test)\b/i, tags: ["engineer", "dev", "code", "tech", "frontend", "backend", "qa", "programmer"] },
  { pattern: /\b(write|tulis|copy|caption|blog|artikel|post|email|newsletter|draft|script|content|konten|sosmed|social)\b/i, tags: ["writer", "copy", "content", "marketing", "social", "editor", "konten"] },
  { pattern: /\b(review|qa|uji|test|check|cek|verif|approve|quality|summary|ringkas|report|laporan)\b/i, tags: ["qa", "review", "manager", "lead", "ops", "pm", "editor"] },
  { pattern: /\b(plan|rencana|jadwal|schedule|meeting|agenda|koordinasi|ops|admin|finance|budget|invoice)\b/i, tags: ["manager", "ops", "pm", "admin", "secretary", "coordinator", "lead"] },
];

function scoreAgentForStep(stepText: string, agent: AgentBrief): number {
  const haystack = `${agent.name} ${agent.description} ${agent.squad}`.toLowerCase();
  let score = 0;
  // Direct name mention wins immediately
  if (agent.name.trim().length >= 2 && new RegExp(`\\b${agent.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(stepText)) {
    score += 50;
  }
  for (const rule of ROLE_KEYWORDS) {
    if (rule.pattern.test(stepText)) {
      for (const tag of rule.tags) {
        if (haystack.includes(tag)) score += 6;
      }
    }
  }
  // Slight preference for free/ready agents over overloaded ones
  if (agent.state === "ready" || agent.state === "home") score += 1;
  return score;
}

/**
 * Split a high-level goal into structured, editable sub-tasks matched to workspace agents.
 * Supports explicit lists (newlines, numbered items, arrows `->`/`→`, Indonesian/English
 * connectors `lalu`/`kemudian`/`then`), or generates a 3-stage Studio workflow for a single goal.
 */
export function parseGoalPlan(goal: string, agents: AgentBrief[]): GoalStepDraft[] {
  const clean = goal.trim();
  if (!clean || !agents.length) return [];

  const lines = clean
    .split(/\r?\n/)
    .map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);

  let rawSteps: string[] = [];
  if (lines.length >= 2) {
    rawSteps = lines;
  } else {
    const splitConnectors = clean
      .split(/\s*(?:→|->|;|\bthen\b|\blalu\b|\bkemudian\b|\bsetelah itu\b)\s*/i)
      .map(s => s.trim())
      .filter(s => s.length >= 4);
    if (splitConnectors.length >= 2) {
      rawSteps = splitConnectors;
    } else if (agents.length >= 2) {
      // Single high-level goal: propose a clean 3-stage Munder-style delegation plan
      const shortGoal = clean.length > 72 ? `${clean.slice(0, 69)}…` : clean;
      rawSteps = [
        `Research & outline plan for: ${shortGoal}`,
        `Execute main deliverable: ${shortGoal}`,
        `Review, polish & summarize results for: ${shortGoal}`,
      ];
    } else {
      rawSteps = [clean];
    }
  }

  const used = new Map<string, number>();
  return rawSteps.slice(0, 8).map((step, idx) => {
    const ranked = [...agents].sort((a, b) => {
      const sa = scoreAgentForStep(step, a) - (used.get(a.agentId) ?? 0) * 2;
      const sb = scoreAgentForStep(step, b) - (used.get(b.agentId) ?? 0) * 2;
      return sb - sa;
    });
    const pick = ranked[0] ?? agents[idx % agents.length];
    used.set(pick.agentId, (used.get(pick.agentId) ?? 0) + 1);
    const title = step.length > 80 ? `${step.slice(0, 77)}…` : step;
    return {
      id: `step-${idx + 1}`,
      title,
      detail: `Part ${idx + 1} of goal: ${clean}\n\nYour step: ${step}`,
      agentId: pick.agentId,
    };
  });
}

/** Build a live structured standup briefing from current office desks and attention counts. */
export function buildStandupSummary(
  desks: AgentBrief[],
  counts: { overdue: number; review: number; failed: number }
): StandupSummary {
  const working = desks.filter(d => d.state === "working");
  const review = desks.filter(d => d.state === "review" || d.state === "failed" || d.state === "waiting");
  const available = desks.filter(d => !working.includes(d) && !review.includes(d));

  const lines = [
    "Team Standup Check-in:",
    `- Actively working (${working.length}): ${working.length ? working.map(d => `${d.name}${d.bubble ? ` (${d.bubble})` : ""}`).join(", ") : "none"}`,
    `- Needs review / attention (${review.length}): ${review.length ? review.map(d => `${d.name}${d.bubble ? ` (${d.bubble})` : ""}`).join(", ") : "none"}`,
    `- Available for new work (${available.length}): ${available.length ? available.map(d => d.name).join(", ") : "none"}`,
    `- Workspace queue: ${counts.review} waiting review, ${counts.overdue} overdue/at-risk, ${counts.failed} failed.`,
    "",
    "Please summarize our top priorities, flag any bottlenecks, and suggest the next 2–3 actions.",
  ];

  return {
    working,
    review,
    available,
    overdueCount: counts.overdue,
    reviewCount: counts.review,
    failedCount: counts.failed,
    promptText: lines.join("\n"),
  };
}

export function formatClockNow(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}
