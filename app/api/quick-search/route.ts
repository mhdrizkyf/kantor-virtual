import { NextResponse } from "next/server";
import { loadWorkspaceCached } from "@/lib/multica";
import { buildOffice } from "@/lib/office";

export const dynamic = "force-dynamic";

/** Lightweight search index for the Global Command Palette (Cmd+K), served from SWR/warm cache. */
export async function GET(req: Request) {
  const ws = new URL(req.url).searchParams.get("ws");
  try {
    const snap = await loadWorkspaceCached(ws, 8000, { swrMs: 60_000, allowDiskWarm: true });
    const office = buildOffice(snap);
    const desks = [...office.rooms.flatMap(r => r.desks), ...office.idleDesks];
    const uniqueAgents = [...new Map(desks.map(d => [d.agentId, d])).values()].map(d => ({
      id: d.agentId,
      name: d.name,
      squad: d.squad,
      state: d.state,
      bubble: d.bubble,
      face: d.face,
    }));
    const tasks = office.openTasks.slice(0, 80).map(t => ({
      id: t.id,
      key: t.key,
      title: t.title,
      status: t.status,
      statusLabel: t.statusLabel,
      assignee: t.assignee,
      project: t.project,
      ws: t.ws,
    }));
    return NextResponse.json({
      workspaceId: office.workspaceId,
      workspaceSlug: office.workspaceSlug,
      agents: uniqueAgents,
      tasks,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
