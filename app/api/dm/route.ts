import { NextResponse } from "next/server";
import { people, unreadCount } from "@/lib/dm";

export const dynamic = "force-dynamic";

/** Everyone you can message, with the latest message and unread count. With ?count=1, returns only the unread count quickly. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const ws = u.searchParams.get("ws");
  try {
    if (u.searchParams.get("count") === "1") {
      return NextResponse.json({ unread: await unreadCount(ws) });
    }
    const r = await people(ws, u.searchParams.get("q"));
    return NextResponse.json({ people: r.people, unread: r.people.reduce((n, p) => n + p.unread, 0) });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
