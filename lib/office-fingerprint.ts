// Shared lightweight workspace state fingerprint used by both /api/office/sync and /api/office/stream (SSE).
import "server-only";
import { createHash } from "node:crypto";
import { loadWorkspaceCached } from "./multica";
import { buildOffice } from "./office";

export type OfficeFingerprintResult = {
  workspaceId: string;
  fp: string;
  updatedAt: string;
};

export async function computeOfficeFingerprint(
  wsPick: string | null,
  ttlMs = 4000
): Promise<OfficeFingerprintResult> {
  const snap = await loadWorkspaceCached(wsPick, ttlMs);
  const office = buildOffice(snap);
  const desksSig = [...office.rooms.flatMap(r => r.desks), ...office.idleDesks]
    .map(d => `${d.agentId}:${d.state}:${d.bubble}:${d.tasks.length}:${d.reviewCount}`)
    .sort()
    .join("|");
  const issuesSig = snap.issues
    .filter(i => i.status !== "done" && i.status !== "cancelled")
    .map(i => `${i.id}:${i.status}:${i.updated_at}:${i.assignee_id ?? ""}`)
    .sort()
    .join("|");
  const runsSig = snap.runs
    .slice(0, 40)
    .map(r => `${r.id}:${r.status}:${r.completed_at ?? ""}`)
    .join("|");
  const raw = [
    office.workspaceId,
    String(office.switchOpen),
    String(office.open),
    String(office.parked),
    office.attention.review.length,
    office.attention.overdue.length,
    office.attention.human.length,
    office.attention.failed.length,
    desksSig,
    issuesSig,
    runsSig,
  ].join("#");
  const fp = createHash("sha1").update(raw).digest("hex").slice(0, 16);
  return { workspaceId: office.workspaceId, fp, updatedAt: office.updatedAt };
}
