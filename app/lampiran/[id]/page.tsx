import { fileRaw, workspace } from "@/lib/multica";
import { attachmentName } from "@/lib/attachment-meta";
import AttachmentViewer from "./viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Attachment preview · Virtual Office" };

export default async function Page({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ws?: string }>;
}) {
  const { id } = await params;
  const { ws: pick } = await searchParams;
  try {
    const ws = await workspace(pick);
    const res = await fileRaw(ws.id, id);
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`Multica returned ${res.status} for this attachment.`);
    }
    const type = res.headers.get("content-type");
    const name = attachmentName(res.headers.get("content-disposition"), type, id);
    const rawSize = Number(res.headers.get("content-length"));
    const size = Number.isFinite(rawSize) && rawSize > 0 ? rawSize : null;
    await res.body?.cancel();
    return <AttachmentViewer id={id} ws={ws.id} workspaceName={ws.name} name={name} contentType={type} size={size} />;
  } catch (e) {
    return <main className="attachment-error"><h1>Attachment unavailable</h1><p>{e instanceof Error ? e.message : String(e)}</p>
      <a className="btn" href={`/?ws=${encodeURIComponent(pick ?? "")}`}>Back to Office</a></main>;
  }
}
