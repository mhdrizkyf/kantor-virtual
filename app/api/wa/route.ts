import { NextResponse } from "next/server";
import { botState, startBot, stopBot, botSend, scheduleSend, cancelQueued, listQueue } from "@/lib/wa-bot";
import { zonedTime } from "@/lib/reminders";

export const dynamic = "force-dynamic";
const fail = (e: unknown, status = 500) => NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status });

/** Status of the assistant's WhatsApp number. */
export async function GET() { return NextResponse.json({ ...(await botState()), queue: listQueue() }); }

/** { action: "connect", phone } · { action: "disconnect" } · { action: "send", phone, text } · { action: "schedule", phone, name, text, date, time } · { action: "cancel", id } */
export async function POST(req: Request) {
  const b = (await req.json()) as { action?: string; phone?: string; text?: string; name?: string; date?: string; time?: string; id?: string };
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
    if (b.action === "cancel") { cancelQueued(b.id ?? ""); return NextResponse.json({ ok: true, queue: listQueue() }); }
    return fail("Unknown action.", 400);
  } catch (e) { return fail(e); }
}
