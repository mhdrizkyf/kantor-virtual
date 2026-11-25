import { NextResponse } from "next/server";
import { chatSessions, createChat, loadDirectory } from "@/lib/multica";
import { readCharacters } from "@/lib/characters";
import { assignUniqueFaces, defaultFace } from "@/lib/character-presets";

export const dynamic = "force-dynamic";

/** Daftar obrolan dengan satu worker. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const ws = u.searchParams.get("ws"); const agent = u.searchParams.get("agent");
  try {
    const [all, dir] = await Promise.all([chatSessions(ws), loadDirectory(ws)]);
    const mine = all.filter(c => !agent || c.agent_id === agent).filter(c => c.status !== "archived")
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
    const faces = assignUniqueFaces(dir.agents.map(a => a.id), readCharacters(dir.workspace.id));
    // Every agent you can chat with, so the history can show who each chat is with and you can switch agent.
    const agents = dir.agents.map(a => ({ id: a.id, name: a.name, emoji: a.avatar_url?.startsWith("emoji:") ? a.avatar_url.slice(6) : null, face: faces[a.id] ?? defaultFace(a.id), role: a.description ?? "" }));
    return NextResponse.json({ agents, sessions: mine.map(c => ({ id: c.id, agentId: c.agent_id, title: c.title || "Chat", updatedAt: c.updated_at, unread: c.unread_count ?? 0, last: c.last_message?.content?.slice(0, 120) ?? "" })) });
  } catch (e) { return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 }); }
}

/** Mulai obrolan baru, atau lanjutkan percakapan aktif terakhir untuk agent yang sama bila reuseLatest=true. */
export async function POST(req: Request) {
  const b = (await req.json()) as { ws?: string; agentId: string; title?: string; projectId?: string | null; reuseLatest?: boolean };
  try {
    if (b.reuseLatest && b.agentId) {
      const all = await chatSessions(b.ws ?? null);
      const latest = all
        .filter(c => c.agent_id === b.agentId && c.status !== "archived")
        .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0];
      if (latest) {
        return NextResponse.json({ id: latest.id, reused: true, title: latest.title || "Chat" });
      }
    }
    const s = await createChat(b.ws ?? null, b.agentId, b.title?.trim() || "New chat", b.projectId);
    return NextResponse.json({ id: s.id, reused: false, title: s.title || b.title?.trim() || "New chat" });
  } catch (e) { return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 }); }
}
