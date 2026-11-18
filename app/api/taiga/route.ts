import { NextResponse } from "next/server";
import { status, saveKeys, forget, logActivities, isLoginError, type Activity } from "@/lib/taiga";

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
  const b = (await req.json()) as { action?: string; text?: string; activities?: Activity[] };
  try {
    if (b.action === "keys") return NextResponse.json(await saveKeys(String(b.text ?? "")));
    if (b.action === "forget") return NextResponse.json(forget());
    if (b.action === "log") {
      const list = (b.activities ?? []).slice(0, 40).map(a => ({
        title: String(a.title ?? ""), date: String(a.date ?? ""), start: String(a.start ?? ""),
        minutes: Math.max(0, Math.round(Number(a.minutes) || 0)), training: !!a.training,
      }));
      if (!list.length) return NextResponse.json({ error: "Pick at least one activity." }, { status: 400 });
      return NextResponse.json(await logActivities(list));
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) { return fail(e); }
}
