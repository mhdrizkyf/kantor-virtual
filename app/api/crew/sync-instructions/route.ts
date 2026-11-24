import { NextResponse } from "next/server";
import { inspectWorkspaceInstructions, syncWorkspaceInstructions } from "@/lib/agent-instructions";
import { invalidateWorkspaceCache } from "@/lib/multica";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ws = new URL(req.url).searchParams.get("ws");
  try {
    return NextResponse.json(await inspectWorkspaceInstructions(ws));
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const b = (await req.json()) as { ws?: string; agentId?: string };
    const result = await syncWorkspaceInstructions(b.ws ?? null, { agentId: b.agentId });
    invalidateWorkspaceCache(result.workspaceId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
