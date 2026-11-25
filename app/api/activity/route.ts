import { NextResponse } from "next/server";
import { workspace } from "@/lib/multica";
import { appendActivity, readActivity } from "@/lib/activity-log";
import type { ActivityKind } from "@/lib/munder-workflows";

export const dynamic = "force-dynamic";

const ALLOWED_KINDS = new Set<ActivityKind>([
  "handoff", "approve", "revise", "delegate", "standup", "coffee", "door", "drag", "chain", "watchdog", "schedule", "chat",
]);

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const limit = Number(u.get("limit") ?? 40);
  try {
    const ws = await workspace(u.get("ws"));
    return NextResponse.json({ workspaceId: ws.id, events: readActivity(ws.id, Number.isFinite(limit) ? limit : 40) });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const b = (await req.json()) as {
      ws?: string;
      kind?: ActivityKind;
      title?: string;
      detail?: string;
      agentId?: string;
      issueId?: string;
    };
    if (!b.kind || !ALLOWED_KINDS.has(b.kind) || !b.title?.trim()) {
      return NextResponse.json({ error: "Valid kind and title are required." }, { status: 400 });
    }
    const ws = await workspace(b.ws ?? null);
    const event = await appendActivity(ws.id, {
      kind: b.kind,
      title: b.title,
      detail: b.detail,
      agentId: b.agentId,
      issueId: b.issueId,
      source: "ui",
    });
    return NextResponse.json({ ok: true, event });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
