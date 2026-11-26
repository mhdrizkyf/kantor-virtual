// Pure speech-bubble priority builder and viewport-safe placement math for speech overlays & hovercards.
import type { Desk } from "../office";
import { buildTwoWayDialog, compactLabel, type SpeechBubbleItem } from "../munder-workflows";
import { clampNum } from "./floor-schema";

export type ReviewTaskBrief = { id: string; ws: string; title: string; questionCount?: number };
export type WalkBrief = {
  from: string;
  to: string;
  fromName: string;
  toName: string;
  title: string;
  kind?: "assign" | "revise" | "review" | "handoff";
};

/** Build prioritized floor speech bubbles (status -> review -> standup -> handover -> transient dialogs). */
export function buildFloorSpeechBubbles(opts: {
  shown: readonly Desk[];
  ownerName: string;
  offDuty: boolean;
  previewWorking: boolean;
  walkReviewIds: readonly string[];
  deskReviewIds: readonly string[];
  reviewTasksByAgent: Record<string, ReviewTaskBrief | undefined>;
  previewReviewId?: string | null;
  reviewArrived: Record<string, boolean | undefined>;
  huddleIds: readonly string[];
  walks: readonly WalkBrief[];
  transientBubbles: Record<string, SpeechBubbleItem>;
}): SpeechBubbleItem[] {
  const map = new Map<string, SpeechBubbleItem>();
  const ownerLabel = opts.ownerName || "Owner";

  // 1. Working & Failed status bubbles at desk
  for (const d of opts.shown) {
    const isPreviewWork = opts.previewWorking && d.agentId === opts.shown[0]?.agentId;
    if (d.state === "failed" && !opts.offDuty) {
      map.set(d.agentId, {
        actorId: d.agentId,
        tone: "failed",
        badge: "Blocked",
        text: compactLabel(d.bubble || "Gagal — klik untuk cek/retry 😅", 30),
        clickable: true,
      });
    } else if (d.state === "working" || isPreviewWork) {
      map.set(d.agentId, {
        actorId: d.agentId,
        tone: "working",
        badge: opts.offDuty && !isPreviewWork ? "Lembur" : "Working",
        text: isPreviewWork ? "Mengerjakan Q4 Launch Brief…" : compactLabel(d.bubble || "Sedang mengerjakan task…", 30),
        clickable: true,
      });
    }
  }

  // 2a. Alt 1 — Agents waiting for Human Owner Review by walking into Owner's room
  for (const id of opts.walkReviewIds) {
    const d = opts.shown.find(x => x.agentId === id);
    if (!d) continue;
    const revTask = opts.reviewTasksByAgent[id];
    const title = revTask?.title ?? (id === opts.previewReviewId ? "Q4 Launch Brief" : d.bubble || "Hasil siap");
    const arrived = !!opts.reviewArrived[id];
    map.set(id, {
      actorId: id,
      tone: arrived ? "review" : "handover",
      badge: arrived ? "Review" : "Menuju " + ownerLabel,
      text: arrived
        ? `Mohon review ${ownerLabel}: ${compactLabel(title, 24)}`
        : `Bawa ke ${ownerLabel}: ${compactLabel(title, 24)}`,
      issueId: revTask?.id,
      ws: revTask?.ws,
      clickable: true,
    });
  }

  // 2b. Alt 2 — Agents notifying Human Owner from their desk via clickable bubble
  for (const id of opts.deskReviewIds) {
    const d = opts.shown.find(x => x.agentId === id);
    if (!d) continue;
    const revTask = opts.reviewTasksByAgent[id];
    const title = revTask?.title ?? d.bubble ?? "Hasil siap";
    const hasQ = (revTask?.questionCount ?? 0) > 0;
    map.set(id, {
      actorId: id,
      tone: "review",
      badge: hasQ ? `Tanya ${ownerLabel}` : "Review",
      text: hasQ
        ? `@${ownerLabel}, butuh keputusan: ${compactLabel(title, 22)} ❓`
        : `@${ownerLabel}, mohon review: ${compactLabel(title, 22)} 👀`,
      issueId: revTask?.id,
      ws: revTask?.ws,
      clickable: true,
    });
  }

  // 3. Standup huddle lead bubble
  if (opts.huddleIds.length > 0) {
    const leadId = opts.huddleIds[0];
    map.set(leadId, {
      actorId: leadId,
      tone: "standup",
      badge: "Standup",
      text: `Huddle · ${opts.huddleIds.length} teammates synced`,
      clickable: true,
    });
  }

  // 4. Active handover walks (Alt 1)
  for (const w of opts.walks) {
    const dlg = buildTwoWayDialog({
      kind: w.kind ?? "handoff",
      fromName: w.fromName,
      toName: w.toName,
      title: w.title,
    });
    map.set(w.from, {
      actorId: w.from,
      tone: dlg.senderTone,
      badge: dlg.senderBadge,
      text: dlg.senderText,
      clickable: false,
    });
  }

  // 5. Highest priority: transient celebrations / 2-way replies / natural activities
  for (const item of Object.values(opts.transientBubbles)) {
    map.set(item.actorId, item);
  }

  return [...map.values()];
}

/** Compute clamped pixel coordinates & top/bottom flip for a floating speech bubble inside the office frame. */
export function computeSpeechBubblePlacement(opts: {
  actorX: number;
  actorY: number;
  worldW: number;
  worldH: number;
  stageW: number;
  stageH: number;
  frameW: number;
  frameH: number;
  bubbleW: number;
  bubbleH: number;
}): { left: number; top: number; tailX: number; flipBelow: boolean } {
  const extraX = Math.max(0, (opts.frameW - opts.stageW) / 2 - 8);
  const extraY = Math.max(0, (opts.frameH - opts.stageH) / 2 - 8);
  const minX = -extraX + 6;
  const maxX = opts.stageW + extraX - 6;
  const minY = -extraY + 6;
  const maxY = opts.stageH + extraY - 6;

  const ax = (opts.actorX / opts.worldW) * opts.stageW;
  const headY = ((opts.actorY - 36) / opts.worldH) * opts.stageH;
  const feetY = ((opts.actorY + 8) / opts.worldH) * opts.stageH;

  const flipBelow = headY - opts.bubbleH < minY;
  const rawTop = flipBelow ? feetY : headY - opts.bubbleH;
  const top = Math.round(clampNum(rawTop, minY, Math.max(minY, maxY - opts.bubbleH)));
  const left = Math.round(clampNum(ax - opts.bubbleW / 2, minX, Math.max(minX, maxX - opts.bubbleW)));
  const tailX = Math.round(clampNum(ax - left, 12, Math.max(12, opts.bubbleW - 12)));
  return { left, top, tailX, flipBelow };
}

/** Compute viewport-safe coordinates for the top-layer floor hovercard. */
export function computeHoverCardPlacement(opts: {
  anchor: { left: number; top: number; bottom: number; width: number };
  frame?: { left: number; right: number; top: number; bottom: number } | null;
  viewportW: number;
  viewportH: number;
  cardW: number;
  cardH: number;
}): { left: number; top: number; arrowX: number; below: boolean } {
  const safeLeft = Math.max(10, Math.round((opts.frame?.left ?? 0) + 8));
  const safeRight = Math.min(opts.viewportW - 10, Math.round((opts.frame?.right ?? opts.viewportW) - 8));
  const safeTop = Math.max(70, Math.round((opts.frame?.top ?? 0) + 8));
  const safeBottom = Math.min(opts.viewportH - 12, Math.round((opts.frame?.bottom ?? opts.viewportH) - 8));

  const gap = 9;
  const aboveTop = opts.anchor.top - gap - opts.cardH;
  const belowTop = opts.anchor.bottom + gap;
  const placeBelow = aboveTop < safeTop && (opts.viewportH - opts.anchor.bottom) > (opts.anchor.top - safeTop);
  const rawTop = placeBelow ? belowTop : aboveTop;
  const top = Math.round(clampNum(rawTop, safeTop, Math.max(safeTop, safeBottom - opts.cardH)));

  const anchorCx = opts.anchor.left + opts.anchor.width / 2;
  const left = Math.round(clampNum(anchorCx - opts.cardW / 2, safeLeft, Math.max(safeLeft, safeRight - opts.cardW)));
  const arrowX = Math.round(clampNum(anchorCx - left, 16, Math.max(16, opts.cardW - 16)));
  return { left, top, arrowX, below: placeBelow };
}
