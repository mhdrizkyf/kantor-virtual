"use client";
import { useState } from "react";
import { AttachmentBody, ICON, LABEL, kindOf } from "@/app/file-preview";
import { Px } from "@/app/pixel-icon";

const formatSize = (n: number | null) => n === null ? null : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

export default function AttachmentViewer({ id, ws, workspaceName, name, contentType, size }: {
  id: string; ws: string; workspaceName: string; name: string; contentType: string | null; size: number | null;
}) {
  const [copied, setCopied] = useState(false);
  const [fit, setFit] = useState(true);
  const kind = kindOf(name);
  const url = `/api/file/${encodeURIComponent(id)}?ws=${encodeURIComponent(ws)}`;
  const file = { id, name, url };
  const copy = async () => {
    try { await navigator.clipboard.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { setCopied(false); }
  };
  return (
    <main className="attachment-page">
      <header className="attachment-toolbar">
        <div className="attachment-heading">
          <a className="btn sm" href={`/?ws=${encodeURIComponent(ws)}`}><Px name="back" /> Office</a>
          <div className="attachment-title"><span className="attachment-icon"><Px name={ICON[kind]} /></span>
            <span><small>{workspaceName} · Attachment preview</small><h1>{name}</h1></span></div>
        </div>
        <div className="attachment-actions">
          {kind === "image" && <button className="btn sm" onClick={() => setFit(v => !v)}>{fit ? "Actual size" : "Fit to screen"}</button>}
          <button className="btn sm" onClick={copy}>{copied ? "Link copied" : "Copy preview link"}</button>
          <a className="btn sm" href={url} target="_blank" rel="noreferrer">Open original</a>
          <a className="btn sm primary" href={`${url}&download=1`} download={name}><Px name="file" /> Download</a>
        </div>
      </header>
      <div className="attachment-meta"><span>{LABEL[kind]}</span>{formatSize(size) && <span>{formatSize(size)}</span>}
        {contentType && <span>{contentType.split(";")[0]}</span>}
      </div>
      <section className={`attachment-stage ${fit ? "fit" : "actual"}`} aria-label={`Preview of ${name}`}>
        <AttachmentBody f={file} kind={kind} tall />
      </section>
      <p className="attachment-foot">The preview is served through Virtual Office using your Multica connection. If this format cannot be displayed here, download the original file.</p>
    </main>
  );
}
