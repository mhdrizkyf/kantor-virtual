import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { list, safePath, setupFolders, syncInfo, syncOutputs, clean, freeName, setLink } from "@/lib/knowledge";
import { officeToHtml } from "@/lib/office-preview";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

/** ?path= lists a folder; ?file=&mode=text|office previews a file; ?file= alone serves it (images and PDFs only inline). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  try {
    const file = u.searchParams.get("file");
    if (file !== null) {
      const { p } = safePath(file);
      if (!existsSync(p) || statSync(p).isDirectory()) return new Response("File not found.", { status: 404 });
      const mode = u.searchParams.get("mode");
      if (mode === "text") return new Response(readFileSync(p, "utf8"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      if (mode === "office") return new Response(officeToHtml(basename(p), readFileSync(p)), { headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
      const ext = basename(p).toLowerCase().split(".").pop() ?? "";
      const type = TYPES[ext];
      const headers = new Headers({ "X-Content-Type-Options": "nosniff", "Content-Type": type ?? "application/octet-stream" });
      headers.set("Content-Disposition", `${type ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(basename(p))}`);
      return new Response(Readable.toWeb(createReadStream(p)) as ReadableStream, { headers });
    }
    return NextResponse.json({ ...syncInfo(), entries: list(u.searchParams.get("path") ?? "") });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

/** Actions: sync (copy new agent outputs), setup (make folders, copy knowledge), open / reveal (on this Mac), upload (into a folder). */
export async function POST(req: Request) {
  try {
    if ((req.headers.get("content-type") ?? "").startsWith("multipart/")) {
      const form = await req.formData();
      const { p } = safePath(String(form.get("path") ?? ""));
      mkdirSync(p, { recursive: true });
      const saved: string[] = [];
      for (const f of form.getAll("file")) {
        if (!(f instanceof File) || !f.size) continue;
        const name = freeName(p, clean(f.name));
        writeFileSync(join(p, name), Buffer.from(await f.arrayBuffer()));
        saved.push(name);
      }
      return NextResponse.json({ ok: true, saved });
    }
    const b = await req.json();
    if (b.action === "sync") return NextResponse.json({ ok: true, message: await syncOutputs() });
    if (b.action === "link" || b.action === "unlink") return NextResponse.json({ ok: true, links: await setLink(String(b.key), String(b.path ?? ""), b.action === "link") });
    if (b.action === "setup") return NextResponse.json({ ok: true, log: await setupFolders() });
    if (b.action === "open" || b.action === "reveal") {
      const { p } = safePath(String(b.path ?? ""));
      if (!existsSync(p)) throw new Error("That file is gone. Refresh the list.");
      await new Promise<void>((ok, bad) => execFile("open", b.action === "reveal" ? ["-R", p] : [p], e => (e ? bad(e) : ok())));
      return NextResponse.json({ ok: true });
    }
    throw new Error("Unknown action");
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
