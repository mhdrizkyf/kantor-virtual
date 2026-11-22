import { NextResponse } from "next/server";
import { loadDirectory, workspace } from "@/lib/multica";
import { saveSquad } from "@/lib/squads";
import { validSquad } from "@/lib/squad-plan";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request) {
  try {
    const body = await req.json() as { ws?: string; agentId?: string; squad?: string };
    const squad = validSquad(body.squad ?? "");
    const ws = await workspace(body.ws ?? null);
    const directory = await loadDirectory(ws.id);
    if (!directory.agents.some(a => a.id === body.agentId)) return NextResponse.json({ error: "Agent not found." }, { status: 404 });
    await saveSquad(ws.id, body.agentId!, squad);
    return NextResponse.json({ ok: true, squad });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: message.startsWith("Squad name") ? 400 : 500 });
  }
}
