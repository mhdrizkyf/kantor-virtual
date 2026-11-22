/** A safe display/download name from Multica's Content-Disposition header. */
export function attachmentName(disposition: string | null, contentType: string | null, fallbackId: string) {
  const encoded = disposition?.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i)?.[1]?.trim().replace(/^"|"$/g, "");
  const plain = disposition?.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
  let name = plain?.[1] ?? plain?.[2]?.trim() ?? "";
  if (encoded) { try { name = decodeURIComponent(encoded); } catch { name = encoded; } }
  name = name.split(/[\\/]/).pop()?.replace(/[\x00-\x1f\x7f]/g, "").trim() ?? "";
  if (name) return name;
  const type = contentType?.split(";")[0].toLowerCase();
  const ext: Record<string, string> = { "application/pdf": "pdf", "text/plain": "txt", "text/markdown": "md", "text/csv": "csv", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "audio/mpeg": "mp3", "video/mp4": "mp4" };
  return `${fallbackId}.${ext[type ?? ""] ?? "bin"}`;
}

/** Turn an authenticated Multica download link inside a report into this app's preview link. */
export function localAttachmentHref(href: string | undefined, ws: string): string | undefined {
  if (!href) return href;
  try {
    const url = new URL(href, "http://localhost");
    if (!/^https?:$/.test(url.protocol)) return href;
    const match = url.pathname.match(/^\/api\/attachments\/([^/]+)\/download\/?$/);
    if (!match) return href;
    return `/lampiran/${encodeURIComponent(decodeURIComponent(match[1]))}?ws=${encodeURIComponent(ws)}`;
  } catch { return href; }
}
