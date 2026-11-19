import { NextResponse } from "next/server";
import { botGroups, botState, startBot, stopBot, botSend, scheduleSend, cancelQueued, listQueue, runDueSends } from "@/lib/wa-bot";
import { zonedTime } from "@/lib/reminders";

export const dynamic = "force-dynamic";
const fail = (e: unknown, status = 500) => (status >= 500 && console.warn("[whatsapp] failed:", String(e instanceof Error ? e.stack ?? e.message : e).slice(0, 600)), NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status }));

/** Status of the assistant's WhatsApp number. */
export async function GET(req: Request) {
  if (new URL(req.url).searchParams.has("groups")) {
    try { return NextResponse.json({ groups: await botGroups() }); } catch (e) { return fail(e, 400); }
  }
  return NextResponse.json({ ...(await botState()), queue: listQueue() });
}

/** { action: "connect", phone } · { action: "disconnect" } · { action: "send", phone, text } · { action: "schedule", phone, name, text, date, time } · { action: "cancel", id } · { action: "when-done", phone, name, text, issueId, ws, title } */
export async function POST(req: Request) {
  const b = (await req.json()) as { action?: string; phone?: string; text?: string; name?: string; date?: string; time?: string; id?: string; issueId?: string; ws?: string; title?: string };
  try {
    if (b.action === "connect") return NextResponse.json(await startBot(b.phone));
    if (b.action === "disconnect") { await stopBot(); return NextResponse.json(await botState()); }
    if (b.action === "send") {
      if (!b.text?.trim()) return fail("The message is empty.", 400);
      return NextResponse.json({ ok: true, ...(await botSend(b.phone ?? "", b.text)) });
    }
    if (b.action === "schedule") {
      if (!b.text?.trim()) return fail("The message is empty.", 400);
      const at = zonedTime(b.date ?? "", b.time ?? "");
      if (!at) return fail("Pick a date and time.", 400);
      return NextResponse.json({ ok: true, item: scheduleSend(b.phone ?? "", b.name ?? "", b.text, at), queue: listQueue() });
    }
    if (b.action === "when-done") {
      if (!b.text?.trim()) return fail("The message is empty.", 400);
      if (!b.issueId) return fail("This card isn't on a task.", 400);
      const item = scheduleSend(b.phone ?? "", b.name ?? "", b.text, new Date(), { issueId: b.issueId, ws: b.ws ?? "", title: b.title ?? "" });
      runDueSends().catch(() => {}); // the task may be done already
      return NextResponse.json({ ok: true, item, queue: listQueue() });
    }
    if (b.action === "cancel") { cancelQueued(b.id ?? ""); return NextResponse.json({ ok: true, queue: listQueue() }); }
    return fail("Unknown action.", 400);
  } catch (e) { return fail(e); }
}
