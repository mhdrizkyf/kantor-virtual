import { NextResponse } from "next/server";
import { loadWorkspaceCached } from "@/lib/multica";
import { readActivity } from "@/lib/activity-log";
import { computeWorkspaceMetrics } from "@/lib/metrics";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ws = new URL(req.url).searchParams.get("ws");
  try {
    const snap = await loadWorkspaceCached(ws, 6000);
    const activity = readActivity(snap.workspace.id, 200);
    return NextResponse.json(computeWorkspaceMetrics(snap, activity));
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
