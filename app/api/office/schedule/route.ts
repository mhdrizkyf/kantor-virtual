import { NextResponse } from "next/server";
import { invalidateWorkspaceCache, kantorSettings, saveKantorSettings, workspace } from "@/lib/multica";
import { normalizeSchedule, parseClockMinutes, type OfficeSchedule } from "@/lib/office-schedule";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const wsPick = new URL(req.url).searchParams.get("ws");
  try {
    const ws = await workspace(wsPick);
    const k = await kantorSettings(ws.id);
    return NextResponse.json({
      workspaceId: ws.id,
      schedule: normalizeSchedule(k.schedule),
      autoHealStuck: !!k.autoHealStuck,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const b = (await req.json()) as { ws?: string; schedule?: Partial<OfficeSchedule>; autoHealStuck?: boolean };
    const ws = await workspace(b.ws ?? null);
    const cur = await kantorSettings(ws.id);
    const nextSchedule = normalizeSchedule({ ...cur.schedule, ...(b.schedule ?? {}) });
    const openM = parseClockMinutes(nextSchedule.openTime);
    const closeM = parseClockMinutes(nextSchedule.closeTime);
    if (openM === null || closeM === null || openM >= closeM) {
      return NextResponse.json({ error: "Open time must be earlier than close time (HH:MM)." }, { status: 400 });
    }
    await saveKantorSettings(ws.id, {
      ...cur,
      schedule: nextSchedule,
      autoHealStuck: b.autoHealStuck !== undefined ? !!b.autoHealStuck : cur.autoHealStuck,
    });
    invalidateWorkspaceCache(ws.id);
    return NextResponse.json({
      ok: true,
      schedule: nextSchedule,
      autoHealStuck: b.autoHealStuck !== undefined ? !!b.autoHealStuck : !!cur.autoHealStuck,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
