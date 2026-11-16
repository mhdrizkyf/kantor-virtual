import { NextResponse } from "next/server";
import { inviteMember, createAgent, loadDirectory, updateAgent, workspace, me, call_ } from "@/lib/multica";
import { AGENT_REPORT_FORMAT, FORMAT_MARKER } from "@/lib/digest";
import { AGENT_REMINDERS, REMIND_MARKER } from "@/lib/reminders";
import { AGENT_WHATSAPP, WA_MARKER } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

type Body =
  | { ws?: string; kind: "human"; email: string; role?: "member" | "admin" }
  | { ws?: string; kind: "agent"; name: string; emoji?: string; role: string; instructions?: string; runtimeId: string };

/** Add to the team: invite a person by email, or create an AI agent. */
export async function POST(req: Request) {
  const b = (await req.json()) as Body;
  const ws = b.ws ?? null;
  try {
    if (b.kind === "human") {
      const email = (b.email ?? "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "That email address doesn't look right." }, { status: 400 });
      await inviteMember(ws, email, b.role === "admin" ? "admin" : "member");
      return NextResponse.json({ ok: true, message: `Invite sent to ${email}. They join the team once they accept.` });
    }
    if (b.kind === "agent") {
      const name = (b.name ?? "").trim(), role = (b.role ?? "").trim();
      if (!name) return NextResponse.json({ error: "Give the agent a name first." }, { status: 400 });
      if (!b.runtimeId) return NextResponse.json({ error: "Pick an AI engine for this agent." }, { status: 400 });
      const dir = await loadDirectory(ws);
      if (dir.agents.some(a => a.name.toLowerCase() === name.toLowerCase())) return NextResponse.json({ error: `There is already an agent called ${name}.` }, { status: 400 });
      const instructions = b.instructions?.trim() ||
        `You are ${name}, a member of the "${dir.workspace.name}" team. Your role: ${role || "general helper"}.\n` +
        "Reply in the language the member uses (usually Indonesian). Keep answers short and concrete, " +
        "post results and files on the issue, and move the issue to in_review when your part is done so a human can check it.";
      const agent = await createAgent(ws, {
        name, description: role, instructions: [instructions, instructions.includes(FORMAT_MARKER) ? "" : AGENT_REPORT_FORMAT, instructions.includes(REMIND_MARKER) ? "" : AGENT_REMINDERS, instructions.includes(WA_MARKER) ? "" : AGENT_WHATSAPP].filter(Boolean).join("\n"), runtime_id: b.runtimeId, visibility: "workspace", max_concurrent_tasks: 2,
        avatar_url: b.emoji?.trim() ? `emoji:${b.emoji.trim()}` : null,
      });
      return NextResponse.json({ ok: true, id: agent.id, message: `${name} joined the team! Give them a first task from the Task Board.` });
    }
    return NextResponse.json({ error: "Unknown team member type." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}

/** The Kantor Virtual blocks (report format, reminders) stay at the end of an agent's instructions and are not shown for editing. */
const MARKERS = [FORMAT_MARKER, REMIND_MARKER, WA_MARKER];
function splitInstructions(full: string) {
  const at = Math.min(...MARKERS.map(m => full.indexOf(m)).filter(i => i >= 0), full.length);
  return { own: full.slice(0, at).trimEnd(), tail: full.slice(at) };
}
const withBlocks = (own: string, tail: string) => {
  let t = tail;
  if (!t.includes(FORMAT_MARKER)) t += "\n" + AGENT_REPORT_FORMAT;
  if (!t.includes(REMIND_MARKER)) t += "\n" + AGENT_REMINDERS;
  if (!t.includes(WA_MARKER)) t += "\n" + AGENT_WHATSAPP;
  return own.trimEnd() + "\n\n" + t.trimStart();
};
type Full = { name: string; description: string | null; instructions: string | null; avatar_url: string | null };

/** An agent's editable profile: GET /api/crew?ws=…&agentId=… */
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  try {
    const ws = await workspace(u.get("ws"));
    const a = await call_<Full>("GET", `/api/agents/${u.get("agentId")}`, ws.id);
    const emoji = a.avatar_url?.startsWith("emoji:") ? a.avatar_url.slice(6) : null;
    return NextResponse.json({ name: a.name, bio: a.description ?? "", instructions: splitInstructions(a.instructions ?? "").own, emoji, hasPhoto: !!a.avatar_url && !emoji });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}

/** Switch an agent to another AI engine, or edit its profile ({ profile: { name, bio, instructions, emoji } }). */
export async function PATCH(req: Request) {
  const b = (await req.json()) as { ws?: string; agentId: string; runtimeId?: string; profile?: { name?: string; bio?: string; instructions?: string; emoji?: string | null } };
  try {
    const ws = await workspace(b.ws ?? null);
    const dir = await loadDirectory(ws.id);
    if (!dir.agents.some(a => a.id === b.agentId)) return NextResponse.json({ error: "Agent not found." }, { status: 404 });
    if (b.profile) {
      const p = b.profile;
      const name = (p.name ?? "").trim();
      if (!name) return NextResponse.json({ error: "The agent needs a name." }, { status: 400 });
      if (dir.agents.some(a => a.id !== b.agentId && a.name.toLowerCase() === name.toLowerCase())) return NextResponse.json({ error: `There is already an agent called ${name}.` }, { status: 400 });
      const cur = await call_<Full>("GET", `/api/agents/${b.agentId}`, ws.id);
      const { tail } = splitInstructions(cur.instructions ?? "");
      const patch: Record<string, unknown> = { name, description: (p.bio ?? "").trim(), instructions: withBlocks((p.instructions ?? "").trim(), tail) };
      if (p.emoji) patch.avatar_url = `emoji:${p.emoji}`;
      await updateAgent(ws.id, b.agentId, patch);
      return NextResponse.json({ ok: true, message: `${name}'s profile is saved.` });
    }
    if (!b.runtimeId) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
    const rt = dir.runtimes.find(r => r.id === b.runtimeId);
    if (!rt) return NextResponse.json({ error: "AI engine not found." }, { status: 404 });
    const mine = await me();
    if (rt.visibility === "private" && rt.owner_id !== mine.id) {
      const owner = dir.members.find(m => m.user_id === rt.owner_id)?.name.split(/\s+/)[0];
      return NextResponse.json({ error: `${rt.name} is a private engine on ${owner ? owner + "'s" : "someone else's"} laptop. Only its owner can move agents onto it.` }, { status: 403 });
    }
    await updateAgent(ws.id, b.agentId, { runtime_id: rt.id });
    return NextResponse.json({ ok: true, message: `Switched to ${rt.name}.` });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
