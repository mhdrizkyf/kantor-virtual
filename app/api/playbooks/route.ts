import { NextResponse } from "next/server";
import { workspace } from "@/lib/multica";
import { deletePlaybook, listPlaybooks, savePlaybook, type PlaybookStep } from "@/lib/playbooks";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const wsPick = new URL(req.url).searchParams.get("ws");
  try {
    const ws = await workspace(wsPick);
    return NextResponse.json({ workspaceId: ws.id, playbooks: listPlaybooks(ws.id) });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const b = (await req.json()) as { ws?: string; name?: string; description?: string; mode?: "chain" | "parallel" | "staged"; steps?: PlaybookStep[] };
    const ws = await workspace(b.ws ?? null);
    const playbook = await savePlaybook(ws.id, {
      name: b.name ?? "",
      description: b.description,
      mode: b.mode ?? "chain",
      steps: b.steps ?? [],
    });
    return NextResponse.json({ ok: true, playbook, playbooks: listPlaybooks(ws.id) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: /required|at least one/i.test(msg) ? 400 : 500 });
  }
}

export async function DELETE(req: Request) {
  const u = new URL(req.url).searchParams;
  const id = u.get("id");
  if (!id) return NextResponse.json({ error: "Playbook id is required." }, { status: 400 });
  try {
    const ws = await workspace(u.get("ws"));
    const deleted = await deletePlaybook(ws.id, id);
    return NextResponse.json({ ok: true, deleted, playbooks: listPlaybooks(ws.id) });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
