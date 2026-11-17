"use client";
// Knowledge & files: each agent's OneDrive folder (Knowledge = what it reads, Outputs = what it made),
// plus existing OneDrive folders linked to it (e.g. Documents/RH).
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import FilePreview, { kindOf, ICON } from "../file-preview";
import ThemeToggle from "../theme-toggle";
import { Px, Emo } from "../pixel-icon";

export type Folder = { id: string; name: string; sub: string; emoji: string | null; rel: string; links: string[] };
type Entry = { name: string; path: string; dir: boolean; size: number; modified: string; count?: number };
type Tab = "Knowledge" | "Outputs";
/** Where the list is: a base folder (its label in the crumbs) and the subfolders opened below it. */
type Loc = { base: string; label: string; sub: string[] };

const KEY = "kantor-files-pick";
const isShared = (f: Folder) => f.id.startsWith("shared:");
const leaf = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
const size = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : day(iso);
};
const post = async (body: unknown) => {
  const j = await (await fetch("/api/files", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  if (j.error) throw new Error(j.error);
  return j;
};
const listDir = async (path: string): Promise<Entry[]> => {
  const j = await (await fetch(`/api/files?path=${encodeURIComponent(path)}`)).json();
  if (j.error) throw new Error(j.error);
  return j.entries;
};

/** Browse OneDrive and pick an existing folder to link. */
function LinkPicker({ who, top, onPick, onClose }: { who: string; top: string; onPick: (path: string) => Promise<void>; onClose: () => void }) {
  const [at, setAt] = useState<string[]>([]);
  const [dirs, setDirs] = useState<Entry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setDirs(null); listDir(at.join("/")).then(e => setDirs(e.filter(x => x.dir && !(at.length === 0 && x.name === top)))).catch(e => setErr(String(e.message ?? e))); }, [at]);
  return createPortal(
    <>
      <div className="scrim" style={{ zIndex: 32 }} onClick={() => !busy && onClose()} />
      <div className="modal" role="dialog" aria-modal="true" aria-label="Link a OneDrive folder" style={{ zIndex: 33 }}>
        <h2><Px name="folder" /> Link a OneDrive folder</h2>
        <p className="desc">{who} will read everything in the folder you pick. The files stay where they are.</p>
        <div className="kf-crumbs">
          <button className="linkish" onClick={() => setAt([])}>OneDrive</button>
          {at.map((s, i) => <span key={i}> / <button className="linkish" onClick={() => setAt(at.slice(0, i + 1))}>{s}</button></span>)}
        </div>
        {err && <div className="note bad">{err}</div>}
        {!dirs && !err && <div className="loading"><span className="spinner" /> Loading…</div>}
        {dirs && (
          <ul className="kf-list kf-pick">
            {!dirs.length && <li><span className="desc">No folders inside this one.</span></li>}
            {dirs.map(d => (
              <li key={d.path}>
                <button className="kf-name" onClick={() => setAt([...at, d.name])}>
                  <span className="kf-ic"><Px name="folder" /></span>
                  <span className="kf-nt"><b>{d.name}</b><small>{d.count} item{d.count === 1 ? "" : "s"}</small></span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          <button className="btn" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!at.length || busy} onClick={async () => { setBusy(true); setErr(null); try { await onPick(at.join("/")); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); } }}>
            {busy ? <><span className="spinner sm" /> Linking…</> : at.length ? `Link “${at[at.length - 1]}”` : "Open a folder to link it"}
          </button>
        </div>
      </div>
    </>, document.body);
}

export default function FilesView({ folders: initial, hasRoot, lastSync, lastResult, top }: { folders: Folder[]; hasRoot: boolean; lastSync: string | null; lastResult: string | null; top: string }) {
  const [folders, setFolders] = useState(initial);
  useEffect(() => setFolders(initial), [initial]);
  const [pick, setPick] = useState(initial[1]?.id ?? initial[0].id);
  const [tab, setTab] = useState<Tab>("Knowledge");
  const folder = folders.find(f => f.id === pick) ?? folders[0];
  const home = (f: Folder, t: Tab): Loc => ({ base: f.rel ? `${f.rel}/${t}` : "", label: t, sub: [] });
  const [loc, setLoc] = useState<Loc>(() => home(folder, "Knowledge"));
  useEffect(() => {
    try { const s = localStorage.getItem(KEY); const f = initial.find(x => x.id === s); if (f) { setPick(f.id); setLoc(home(f, "Knowledge")); } } catch { /* storage unavailable */ }
  }, [initial]);
  const choose = (f: Folder) => { setPick(f.id); setLoc(home(f, tab)); try { localStorage.setItem(KEY, f.id); } catch { /* ignore */ } };
  const switchTab = (t: Tab) => { setTab(t); setLoc(home(folder, t)); };

  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<Entry | null>(null);
  const [linking, setLinking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [sync, setSync] = useState({ at: lastSync, result: lastResult, busy: false });
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const here = loc.base ? [loc.base, ...loc.sub].join("/") : "";
  const atHome = tab === "Knowledge" && loc.base === `${folder.rel}/Knowledge` && !loc.sub.length;
  const load = useCallback(async () => {
    if (!here) { setEntries([]); return; }
    setErr(null);
    try { setEntries(await listDir(here)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [here]);
  useEffect(() => { setEntries(null); load(); }, [load]);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 5000); return () => clearTimeout(t); }, [note]);
  useEffect(() => {
    if (!view) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".pv-modal")) setView(null); };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [view]);

  async function act(action: "open" | "reveal", path: string) {
    try { await post({ action, path }); setNote(action === "open" ? "Opened on your Mac." : "Shown in Finder."); } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
  }
  async function syncNow() {
    setSync(s => ({ ...s, busy: true }));
    try { const j = await post({ action: "sync" }); setSync({ at: new Date().toISOString(), result: j.message, busy: false }); load(); }
    catch (e) { setSync(s => ({ ...s, busy: false, result: e instanceof Error ? e.message : String(e) })); }
  }
  async function link(path: string, on: boolean) {
    const j = await post({ action: on ? "link" : "unlink", key: folder.id, path });
    setFolders(fs => fs.map(f => (f.id === folder.id ? { ...f, links: j.links } : f)));
    setNote(on ? `${folder.name} now reads “${leaf(path)}” too.` : `Unlinked “${leaf(path)}”. The folder itself wasn't touched.`);
  }
  async function upload(list: FileList | File[] | null) {
    const files = [...(list ?? [])];
    if (!files.length || !here) return;
    const form = new FormData(); form.append("path", here);
    for (const f of files) form.append("file", f, f.name);
    try {
      const j = await (await fetch("/api/files", { method: "POST", body: form })).json();
      if (j.error) throw new Error(j.error);
      setNote(`Added ${j.saved.length} file${j.saved.length === 1 ? "" : "s"} to ${[loc.label, ...loc.sub].join(" / ")}.`);
      load();
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
  }

  const shared = isShared(folder);
  const linkRows = atHome ? folder.links : [];
  const inLink = !!folder.rel && tab === "Knowledge" && loc.base !== `${folder.rel}/Knowledge`;
  const empty = entries && !entries.length && !linkRows.length;

  return (
    <>
      <header className="top">
        <div className="wrap hbar">
          <div className="brand"><h1><Px name="books" /> Knowledge &amp; Files</h1><p className="pdesc">Each agent&apos;s folder in your OneDrive: what it reads, and what it made.</p></div>
          <div className="chiprow">
            <button className="btn" onClick={syncNow} disabled={sync.busy || !hasRoot}>{sync.busy ? <><span className="spinner sm" /> Copying…</> : <><Px name="refresh" /> Copy new outputs</>}</button>
            <ThemeToggle />
            <span className="clock" title={sync.result ?? undefined}>Outputs copied {ago(sync.at)}</span>
          </div>
        </div>
      </header>
      <main className="wrap pagewide">
        {!hasRoot && <div className="note bad">No OneDrive folder was found on this Mac. Open the OneDrive app, sign in, then reload this page.</div>}
        <div className="kf">
          <nav className="kf-side" aria-label="Folders">
            {folders.map(f => (
              <button key={f.id} className="kf-who" aria-pressed={f.id === folder.id} onClick={() => choose(f)}>
                <span className="avatar sm">{isShared(f) ? <Px name="team" /> : f.emoji ? <Emo e={f.emoji} /> : <Px name="agent" />}</span>
                <span className="kf-wt"><b>{f.name}</b>{(f.sub || f.links.length > 0) && <small>{f.sub || `+ ${f.links.map(leaf).join(", ")}`}</small>}</span>
              </button>
            ))}
          </nav>

          <section className={`kf-main ${drag ? "drag" : ""}`} aria-label={`${folder.name} files`}
            onDragOver={e => { if (here) { e.preventDefault(); setDrag(true); } }} onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}>
            <div className="kf-head">
              <div className="tabs" style={{ padding: 0 }}>
                {(["Knowledge", "Outputs"] as Tab[]).map(t => (
                  <button key={t} className="tab" aria-pressed={tab === t} onClick={() => switchTab(t)}>
                    <Px name={t === "Knowledge" ? "book" : "rocket"} /> {t}
                  </button>
                ))}
              </div>
              <div className="chiprow">
                <input ref={input} type="file" multiple hidden onChange={e => { upload(e.target.files); e.target.value = ""; }} />
                {tab === "Knowledge" && <button className="btn sm" disabled={!folder.rel} onClick={() => setLinking(true)}><Px name="pin" /> Link a OneDrive folder</button>}
                <button className="btn sm" disabled={!here} onClick={() => input.current?.click()}><Px name="plus" size="0.9em" /> Add files</button>
                <button className="btn sm" disabled={!here} onClick={() => act("reveal", here)}><Px name="folder" /> Show in Finder</button>
              </div>
            </div>
            <p className="hint">
              {tab === "Knowledge"
                ? shared ? "Every agent in this workspace reads these before starting a task, including any OneDrive folders linked here." : `${folder.name} reads these before starting a task, including any OneDrive folders linked here. Drop files in, or edit them in OneDrive as usual.`
                : shared ? "Put files here that belong to the whole workspace." : `Files ${folder.name} attached to tasks, one folder per task. New ones are copied every 15 minutes.`}
            </p>

            {(loc.sub.length > 0 || inLink) && (
              <div className="kf-crumbs">
                <button className="linkish" onClick={() => setLoc(home(folder, tab))}>{tab}</button>
                {inLink && <> / {loc.sub.length ? <button className="linkish" onClick={() => setLoc({ ...loc, sub: [] })}>{loc.label}</button> : <b>{loc.label}</b>}</>}
                {loc.sub.map((s, i) => <span key={i}> / {i === loc.sub.length - 1 ? <b>{s}</b> : <button className="linkish" onClick={() => setLoc({ ...loc, sub: loc.sub.slice(0, i + 1) })}>{s}</button>}</span>)}
              </div>
            )}

            {err && <div className="note bad">{err}</div>}
            {!folder.rel && <p className="desc">This agent doesn&apos;t have a folder yet. Click <b>Copy new outputs</b> to make one.</p>}
            {folder.rel && !entries && !err && <div className="loading"><span className="spinner" /> Loading…</div>}
            {folder.rel && empty && (
              <div className="kf-empty">
                <Px name={tab === "Knowledge" ? "book" : "rocket"} size="2em" />
                <p>{tab === "Knowledge" ? "Nothing here yet. Drop files here, click Add files, or link a OneDrive folder you already keep for this work." : "No outputs yet. When this agent attaches a file to a task, a copy lands here."}</p>
              </div>
            )}
            {(linkRows.length > 0 || (entries && entries.length > 0)) && (
              <ul className="kf-list">
                {linkRows.map(l => (
                  <li key={`link:${l}`} className="kf-linked">
                    <button className="kf-name" onClick={() => setLoc({ base: l, label: leaf(l), sub: [] })} title="Open linked folder">
                      <span className="kf-ic"><Px name="pin" /></span>
                      <span className="kf-nt"><b>{leaf(l)}</b><small>Linked OneDrive folder · {l}</small></span>
                    </button>
                    <button className="btn sm ghost" onClick={() => link(l, false).catch(e => setNote(String(e.message ?? e)))} title="Stop reading this folder (the folder stays in OneDrive)">Unlink</button>
                  </li>
                ))}
                {entries?.map(e => {
                  const k = kindOf(e.name);
                  return (
                    <li key={e.path}>
                      <button className="kf-name" onClick={() => (e.dir ? setLoc({ ...loc, sub: [...loc.sub, e.name] }) : setView(e))} title={e.dir ? "Open folder" : "Preview"}>
                        <span className="kf-ic"><Px name={e.dir ? "folder" : ICON[k]} /></span>
                        <span className="kf-nt"><b>{e.name}</b><small>{e.dir ? `${e.count} item${e.count === 1 ? "" : "s"} · ` : `${size(e.size)} · `}{day(e.modified)}</small></span>
                      </button>
                      {!e.dir && <button className="btn sm" onClick={() => act("open", e.path)} title="Open in Word, Excel, Preview… on this Mac">Open</button>}
                      <button className="btn sm ghost" onClick={() => act("reveal", e.path)} title="Show in Finder" aria-label={`Show ${e.name} in Finder`}><Px name="folder" /></button>
                    </li>
                  );
                })}
              </ul>
            )}
            {drag && <div className="kf-drop"><Px name="plus" /> Drop to add to {[loc.label, ...loc.sub].join(" / ")}</div>}
          </section>
        </div>
      </main>
      {note && <div className="toast" role="status">{note}</div>}
      {linking && <LinkPicker top={top} who={shared ? "Every agent in this workspace" : folder.name} onClose={() => setLinking(false)} onPick={async p => { await link(p, true); setLinking(false); }} />}
      {view && createPortal(
        <>
          <div className="scrim" onClick={() => setView(null)} />
          <div className="modal kf-view" role="dialog" aria-modal="true" aria-label={view.name}>
            <div className="kf-vhead">
              <b>{view.name}</b>
              <span className="chiprow">
                <button className="btn sm" onClick={() => act("open", view.path)}>Open on Mac</button>
                <button className="x" onClick={() => setView(null)} aria-label="Close"><Px name="close" size="1em" /></button>
              </span>
            </div>
            <FilePreview f={{ id: view.path, name: view.name, url: `/api/files?file=${encodeURIComponent(view.path)}` }} startOpen />
          </div>
        </>, document.body)}
    </>
  );
}
