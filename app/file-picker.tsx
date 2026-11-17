"use client";
import { useRef, useState } from "react";
import { Px } from "./pixel-icon";

const MAX_MB = 25;

/** Unggah file yang dipilih ke Multica, kembalikan id lampirannya. */
export async function uploadAll(files: File[], ws: string, issueId?: string): Promise<string[]> {
  const form = new FormData();
  form.append("ws", ws);
  if (issueId) form.append("issueId", issueId);
  for (const f of files) form.append("file", f, f.name);
  const r = await fetch("/api/upload", { method: "POST", body: form });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return (j.files as { id: string }[]).map(f => f.id);
}

/** Tombol lampiran + daftar file terpilih (bisa juga tempel gambar dengan Cmd+V di kolom pesan). */
export default function FilePicker({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [tooBig, setTooBig] = useState<string[]>([]);
  const add = (list: FileList | null) => {
    if (!list) return;
    const all = [...list];
    const ok = all.filter(f => f.size <= MAX_MB * 1024 * 1024);
    setTooBig(all.filter(f => !ok.includes(f)).map(f => `${f.name} (${(f.size / 1024 / 1024).toFixed(0)} MB)`));
    onChange([...files, ...ok]);
  };
  return (
    <div className="picker">
      <input ref={input} id="lampiran" type="file" multiple hidden onChange={e => { add(e.target.files); e.target.value = ""; }} />
      <button type="button" className="btn sm" onClick={() => input.current?.click()}><Px name="clip" /> Attach file</button>
      {files.map((f, i) => (
        <span key={f.name + i} className="chip">
          <Px name={f.type.startsWith("image/") ? "image" : "file"} /> {f.name}
          <button type="button" className="chipx" aria-label={`Remove ${f.name}`} onClick={() => onChange(files.filter((_, j) => j !== i))}><Px name="close" size="0.8em" /></button>
        </span>
      ))}
      {tooBig.length > 0 && (
        <span className="picker-warn" role="alert">
          {tooBig.length === 1 ? `${tooBig[0]} is over ${MAX_MB} MB and wasn't attached.` : `These are over ${MAX_MB} MB and weren't attached: ${tooBig.join(", ")}.`}
          {" "}Share a Google Drive link instead.
          <button type="button" className="chipx" aria-label="Dismiss" onClick={() => setTooBig([])}><Px name="close" size="0.8em" /></button>
        </span>
      )}
    </div>
  );
}
