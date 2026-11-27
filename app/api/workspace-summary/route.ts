import { NextResponse } from "next/server";
import { loadWorkspaceCached } from "@/lib/multica";
import { buildOffice } from "@/lib/office";

export const dynamic = "force-dynamic";

/** Loaded only when the workspace switcher opens (SWR + disk warm cache for instant switching). */
export async function GET(req: Request) {
  const ws = new URL(req.url).searchParams.get("ws");
  if (!ws) return NextResponse.json({ error: "Workspace required." }, { status: 400 });
  try {
    const office = buildOffice(await loadWorkspaceCached(ws, 15_000, { swrMs: 120_000, allowDiskWarm: true }));
    const a = office.attention;
    return NextResponse.json({ attention: a.overdue.length + a.human.length + a.review.length + a.failed.length, switchOpen: office.switchOpen });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
