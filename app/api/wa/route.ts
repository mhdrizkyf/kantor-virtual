import { NextResponse } from "next/server";
import { botState, startBot, stopBot, botSend } from "@/lib/wa-bot";

export const dynamic = "force-dynamic";
const fail = (e: unknown, status = 500) => NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status });

/** Status of the assistant's WhatsApp number. */
export async function GET() { return NextResponse.json(await botState()); }

/** { action: "connect", phone } · { action: "disconnect" } · { action: "send", phone, text } */
export async function POST(req: Request) {
  const b = (await req.json()) as { action?: string; phone?: string; text?: string };
  try {
    if (b.action === "connect") return NextResponse.json(await startBot(b.phone));
    if (b.action === "disconnect") { await stopBot(); return NextResponse.json(await botState()); }
    if (b.action === "send") {
      if (!b.text?.trim()) return fail("The message is empty.", 400);
      return NextResponse.json({ ok: true, ...(await botSend(b.phone ?? "", b.text)) });
    }
    return fail("Unknown action.", 400);
  } catch (e) { return fail(e); }
}
