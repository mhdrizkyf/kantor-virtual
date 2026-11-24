import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { loadWorkspaceCached } from "@/lib/multica";
import { buildOffice } from "@/lib/office";

export const dynamic = "force-dynamic";

/** Lightweight state fingerprint for smart polling: OfficeView only triggers a full SSR refresh when `fp` changes. */
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const ws = u.get("ws");
  const since = u.get("fp");
  try {
    const snap = await loadWorkspaceCached(ws, 4000);
    const office = buildOffice(snap);
    const desksSig = [...office.rooms.flatMap(r => r.desks), ...office.idleDesks]
      .map(d => `${d.agentId}:${d.state}:${d.tasks.length}:${d.reviewCount}`)
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
    if (since && since === fp) {
      return new NextResponse(null, { status: 304, headers: { ETag: fp } });
    }
    return NextResponse.json(
      { changed: true, fp, updatedAt: office.updatedAt },
      { headers: { ETag: fp } }
    );
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
