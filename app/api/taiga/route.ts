import { NextResponse } from "next/server";
import { status, saveKeys, forget, logActivities, isLoginError, type Activity } from "@/lib/taiga";
import { workspace, call_, addComment, updateIssue } from "@/lib/multica";

const TZ = process.env.KANTOR_TIMEZONE || "Asia/Jakarta";
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: TZ });
type Issue = { id: string; identifier: string; title: string; status: string; assignee_type?: string | null; created_at: string; description?: string | null };

/** After logging, close the member's open "Catat aktivitas ke Taiga" to-dos for those dates (title has the date, or it was made that day). */
async function closeTaigaTodos(wsPick: string | undefined, dates: string[], from: string | undefined, n: number) {
  const ws = await workspace(wsPick);
  const r = await call_<{ issues?: Issue[] } | Issue[]>("GET", "/api/issues?limit=300", ws.id);
  const all = Array.isArray(r) ? r : r.issues ?? [];
  const src = all.find(i => i.id === from)?.identifier;
  const hits = all.filter(i => i.id !== from && !/^(done|cancelled|canceled)$/.test(i.status) && i.assignee_type !== "agent" && /taiga/i.test(i.title)
    && dates.some(d => i.title.includes(d) || (i.description ?? "").includes(d) || (!/\d{4}-\d{2}-\d{2}/.test(i.title) && dayOf(i.created_at) === d)));
  for (const i of hits) {
    await addComment(ws.id, i.id, `✅ Logged ${n} ${n === 1 ? "activity" : "activities"} to Taiga${src ? ` from ${src}` : ""} in Virtual Office.`);
    await updateIssue(ws.id, i.id, { status: "done" });
  }
  return hits.map(i => i.identifier);
}

export const dynamic = "force-dynamic";
const fail = (e: unknown) => {
  const login = isLoginError(e);
  if (!login) console.error("[taiga]", e);
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e), login, status: status() }, { status: login ? 401 : 500 });
};

/** Whether the Taiga key is set, and which activities were already logged. */
export async function GET() { return NextResponse.json(status()); }

/** { action: "keys", text } | { action: "forget" } | { action: "log", activities } */
export async function POST(req: Request) {
  const b = (await req.json()) as { action?: string; text?: string; activities?: Activity[]; ws?: string; from?: string };
  try {
    if (b.action === "keys") return NextResponse.json(await saveKeys(String(b.text ?? "")));
    if (b.action === "forget") return NextResponse.json(forget());
    if (b.action === "log") {
      const list = (b.activities ?? []).slice(0, 40).map(a => ({
        title: String(a.title ?? ""), date: String(a.date ?? ""), start: String(a.start ?? ""),
        minutes: Math.max(0, Math.round(Number(a.minutes) || 0)), training: !!a.training,
      }));
      if (!list.length) return NextResponse.json({ error: "Pick at least one activity." }, { status: 400 });
      const out = await logActivities(list);
      const ok = out.results.filter(x => x.ref);
      let closed: string[] = [];
      if (ok.length && out.results.every(x => x.ref)) {
        const dates = [...new Set(list.map(a => a.date))];
        closed = await closeTaigaTodos(b.ws, dates, b.from, ok.length).catch(e => { console.error("[taiga] closing to-dos", e); return []; });
      }
      return NextResponse.json({ ...out, closed });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) { return fail(e); }
}
