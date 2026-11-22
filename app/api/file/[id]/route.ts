import { fileRaw, fileText } from "@/lib/multica";
import { officeToHtml } from "@/lib/office-preview";
import { attachmentName } from "@/lib/attachment-meta";

export const dynamic = "force-dynamic";

/** Lampiran lewat app sendiri: ?mode=text untuk pratinjau teks, selain itu file aslinya. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const u = new URL(req.url);
  const ws = u.searchParams.get("ws");
  try {
    if (u.searchParams.get("mode") === "text") {
      return new Response(await fileText(ws, id), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, max-age=60" } });
    }
    // PowerPoint / Word / Excel: turned into a static web page (no scripts), shown in a sandboxed frame.
    if (u.searchParams.get("mode") === "office") {
      const raw = await fileRaw(ws, id);
      if (!raw.ok) return new Response("File tidak bisa dibuka.", { status: raw.status || 500 });
      const html = officeToHtml(u.searchParams.get("name") ?? "", Buffer.from(await raw.arrayBuffer()));
      return new Response(html, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
    }
    const res = await fileRaw(ws, id, req.headers.get("range"));
    if (!res.ok || !res.body) return new Response("File tidak bisa dibuka.", { status: res.status || 500 });
    const type = res.headers.get("content-type") ?? "application/octet-stream";
    const headers = new Headers({ "Content-Type": type, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" });
    for (const key of ["Content-Length", "Content-Range", "Accept-Ranges"]) {
      const value = res.headers.get(key); if (value) headers.set(key, value);
    }
    if (u.searchParams.get("download") === "1") {
      const name = attachmentName(res.headers.get("content-disposition"), type, id);
      headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
      return new Response(res.body, { status: res.status, headers });
    }
    // Keamanan: HTML/SVG buatan agen tidak boleh berjalan di alamat app ini (pratinjaunya lewat bingkai terisolasi).
    if (/html|svg|xml|javascript/i.test(type)) {
      headers.set("Content-Type", "text/plain; charset=utf-8");
      headers.set("Content-Disposition", "attachment");
    } else {
      const cd = res.headers.get("content-disposition"); if (cd) headers.set("Content-Disposition", cd.replace(/^attachment/i, "inline"));
    }
    return new Response(res.body, { status: res.status, headers });
  } catch (e) {
    return new Response(String(e instanceof Error ? e.message : e), { status: 500 });
  }
}
