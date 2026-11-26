// Pure actor director: decides off-duty visibility, human face assignment, review delivery splits,
// lunch break roaming, and natural workday micro-activities independently of the Canvas renderer.
import type { Desk } from "../office";
import {
  partitionReviewDelivery,
  PEER_CHAT_SCRIPTS,
  pickNaturalActivity,
  type BubbleKind,
  type NaturalActivitySpot,
  type ReviewStyle,
} from "../munder-workflows";

export const ALL_RETINA_FACE_IDS = [
  "yusuf", "reno", "mira", "danu", "lia", "tari",
  "raya", "niko", "sari", "bima", "ardi", "nala",
] as const;

/** Determine whether a seated agent should be hidden (absent from desk) during off-duty/offline hours. */
export function isActorAbsentFromDesk(opts: {
  busy: boolean;
  huddleHold?: boolean;
  reviewHold?: boolean;
  offDuty: boolean;
  deskState: Desk["state"];
  actorState?: string;
}): boolean {
  if (opts.busy || opts.huddleHold || opts.reviewHold) return false;
  if (opts.actorState && opts.actorState !== "seat") return false;
  return opts.offDuty || opts.deskState === "off" || opts.deskState === "closed";
}

/** Assign non-colliding Retina faces to visible human members given the faces already used by agents. */
export function resolveHumanFaces(
  humans: readonly { id: string; face?: string | null }[],
  usedAgentFaces: ReadonlySet<string>
): Record<string, string> {
  const pool = [
    ...ALL_RETINA_FACE_IDS.filter(id => !usedAgentFaces.has(id)),
    ...ALL_RETINA_FACE_IDS.filter(id => usedAgentFaces.has(id)),
  ];
  const out: Record<string, string> = {};
  humans.forEach((h, i) => {
    out[h.id] = h.face || pool[i % pool.length];
  });
  return out;
}

/** Compute which agents walk to Owner's desk for review vs display a clickable review bubble at their desk. */
export function computeReviewAssignments(opts: {
  shown: readonly Desk[];
  reviewTasksByAgent: Record<string, { questionCount?: number } | undefined>;
  previewReviewId?: string | null;
  huddleCount: number;
  offDuty: boolean;
  reviewStyle: ReviewStyle;
}): { walkReviewIds: string[]; deskReviewIds: string[] } {
  if (opts.huddleCount > 0) return { walkReviewIds: [], deskReviewIds: [] };
  const allIds = opts.shown
    .filter(d => {
      if (opts.offDuty && !opts.previewReviewId) return false;
      return d.state === "review" || !!opts.reviewTasksByAgent[d.agentId];
    })
    .map(d => d.agentId);
  if (opts.previewReviewId && opts.shown.some(d => d.agentId === opts.previewReviewId) && !allIds.includes(opts.previewReviewId)) {
    allIds.unshift(opts.previewReviewId);
  }
  const { walkToOwner, deskBubbleOnly } = partitionReviewDelivery(allIds, opts.reviewTasksByAgent, opts.reviewStyle);
  return { walkReviewIds: walkToOwner, deskReviewIds: deskBubbleOnly };
}

export type LunchErrandPlan = {
  agentId: string;
  spot: NaturalActivitySpot;
  line: string;
};

/** Select up to 4 free agents during lunch (12:00–13:15) to visit Pantry, Coffee Bar, and Lounge. */
export function planLunchErrands(opts: {
  freeDesks: readonly Pick<Desk, "agentId" | "name">[];
  roamingCount: number;
  occupiedKeys: Set<string>;
  seed: number;
  isWalkable?: (x: number, y: number) => boolean;
}): { errands: LunchErrandPlan[]; nextSeed: number } {
  const slots = Math.max(0, 4 - opts.roamingCount);
  const errands: LunchErrandPlan[] = [];
  let cursor = opts.seed;
  for (let i = 0; i < Math.min(slots, opts.freeDesks.length); i++) {
    const d = opts.freeDesks[(cursor + i) % opts.freeDesks.length];
    const pick = pickNaturalActivity({
      lunch: true,
      seed: cursor++,
      occupiedKeys: opts.occupiedKeys,
      isWalkable: opts.isWalkable,
    });
    if (!pick) continue;
    opts.occupiedKeys.add(`${pick.spot.x},${pick.spot.y}`);
    errands.push({ agentId: d.agentId, spot: pick.spot, line: pick.line });
  }
  return { errands, nextSeed: cursor };
}

export type WorkdayLifeAction =
  | {
      kind: "peer-chat";
      firstId: string;
      secondId: string;
      questionText: string;
      replyText: string;
      nextSeed: number;
    }
  | {
      kind: "errand";
      agentId: string;
      spot: NaturalActivitySpot;
      line: string;
      targetKind: "board" | "coffee" | "chat";
      bubbleKind: BubbleKind;
      nextSeed: number;
    };

/** Decide the next organic workday life step (peer chat vs natural micro-activity errand) for idle agents. */
export function planWorkdayLifeStep(opts: {
  freeDesks: readonly Pick<Desk, "agentId" | "name">[];
  roamingCount: number;
  occupiedKeys: ReadonlySet<string>;
  seed: number;
  isWalkable?: (x: number, y: number) => boolean;
}): WorkdayLifeAction | null {
  if (!opts.freeDesks.length || opts.roamingCount >= 3) return null;
  const nextSeed = opts.seed + 1;

  // ~33% chance of a natural 2-way peer sync / watercooler chat between two free teammates
  if (opts.freeDesks.length >= 2 && nextSeed % 3 === 0) {
    const first = opts.freeDesks[nextSeed % opts.freeDesks.length];
    const second = opts.freeDesks[(nextSeed + 1) % opts.freeDesks.length];
    const script = PEER_CHAT_SCRIPTS[nextSeed % PEER_CHAT_SCRIPTS.length];
    return {
      kind: "peer-chat",
      firstId: first.agentId,
      secondId: second.agentId,
      questionText: script[0].replace("{other}", second.name.split(/\s+/)[0]),
      replyText: script[1].replace("{other}", first.name.split(/\s+/)[0]),
      nextSeed,
    };
  }

  const chosen = opts.freeDesks[nextSeed % opts.freeDesks.length];
  const pick = pickNaturalActivity({
    lunch: false,
    seed: nextSeed,
    occupiedKeys: new Set(opts.occupiedKeys),
    isWalkable: opts.isWalkable,
  });
  if (!pick) return null;
  const targetKind: "board" | "coffee" | "chat" =
    pick.spot.kind === "board" ? "board" : pick.spot.kind === "coffee" || pick.spot.kind === "pantry" ? "coffee" : "chat";
  return {
    kind: "errand",
    agentId: chosen.agentId,
    spot: pick.spot,
    line: pick.line,
    targetKind,
    bubbleKind: pick.spot.bubbleKind,
    nextSeed,
  };
}
