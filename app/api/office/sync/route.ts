import { NextResponse } from "next/server";
import { computeOfficeFingerprint } from "@/lib/office-fingerprint";

export const dynamic = "force-dynamic";

/** Lightweight state fingerprint for smart delta polling & SSE fallback. */
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const ws = u.get("ws");
  const since = u.get("fp");
  try {
    const { fp, updatedAt } = await computeOfficeFingerprint(ws, 4000);
    if (since && since === fp) {
      return new NextResponse(null, { status: 304, headers: { ETag: fp } });
    }
    return NextResponse.json(
      { changed: true, fp, updatedAt },
      { headers: { ETag: fp } }
    );
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
