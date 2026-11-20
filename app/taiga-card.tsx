"use client";
// "Log to Taiga" card for the daily activities an agent drafts in a ```taiga block.
// Nothing reaches Taiga until the member presses the button.
import { useContext, useEffect, useState } from "react";
import { Px } from "./pixel-icon";
import { WaTask } from "./wa-card";

type Row = { title: string; date: string; start: string; minutes: number; training: boolean; on: boolean };
type Status = { connected: boolean; expires?: string; autoRenew: boolean; user?: string; story?: string; storyUrl?: string; logged: Record<string, { ref: number; url: string }> };

// One shared copy of the connection status for every card.
let cur: Status | null = null;
const subs = new Set<(s: Status) => void>();
const setStatus = (s: Status) => { cur = s; subs.forEach(f => f(s)); };
const load = () => fetch("/api/taiga").then(r => r.json()).then((s: Status) => { setStatus(s); return s; });
function useStatus() {
  const [s, setS] = useState<Status | null>(cur);
  useEffect(() => { subs.add(setS); load().catch(() => {}); return () => { subs.delete(setS); }; }, []);
  return s;
}
const post = async (body: unknown) => {
  const j = await (await fetch("/api/taiga", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  if (j.status) setStatus(j.status);
  return j;
};

/** "2026-11-16 | 16:00 | 60 | training | [OPS] Title" → one row. */
export function parseTaiga(block: string): Row[] {
  const rows: Row[] = [];
  for (const line of block.split("\n")) {
    const parts = line.split("|").map(p => p.trim());
    if (parts.length < 4 || !/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) continue;
    const [date, start, mins, ...rest] = parts;
    const training = /^(training|pelatihan|learning)$/i.test(rest[0] ?? "") && rest.length > 1;
    rows.push({
      date, start: start.replace(".", ":").padStart(5, "0"), minutes: Math.round(Number(mins.replace(/[^\d.]/g, "")) || 0),
      training, title: (training ? rest.slice(1) : rest).join(" | "), on: true,
    });
  }
  return rows;
}

// Same key as lib/taiga.ts activityKey, computed in the browser.
async function keyOf(r: Row) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode([r.title.trim().toLowerCase(), r.date, r.start].join("|")));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

function Connect({ again, onDone }: { again: boolean; onDone: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setBusy(true); setErr(null);
    try { const j = await post({ action: "keys", text }); if (j.error) throw new Error(j.error); setText(""); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }
  return (
    <div className="tg-connect">
      <label className="tg-step" htmlFor="tg-key"><b>Connect Taiga.</b> {again ? "Your key has expired. Paste a new bearer key:" : "Paste your Taiga bearer key:"}</label>
      <input id="tg-key" className="input tg-key" type="password" autoComplete="off" placeholder="Bearer key" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && text.trim()) save(); }} spellCheck={false} />
      <small className="hint">Kept on this computer only; agents never see it.</small>
      {err && <div className="note bad">{err}</div>}
      <div className="wa-row"><span className="hint" />
        <button type="button" className="btn sm primary tg-go" disabled={busy || !text.trim()} onClick={save}>{busy ? <><span className="spinner sm" /> Checking…</> : <><Px name="unlock" /> Connect</>}</button>
      </div>
    </div>
  );
}

export function TaigaCard({ block }: { block: string }) {
  const st = useStatus();
  const task = useContext(WaTask);
  const [closed, setClosed] = useState<"no" | "busy" | "yes">("no");
  const [closedOthers, setClosedOthers] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>(() => parseTaiga(block));
  const [keys, setKeys] = useState<string[]>([]);
  const [errs, setErrs] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  useEffect(() => { Promise.all(rows.map(keyOf)).then(setKeys); }, [rows]);
  const done = (i: number) => (keys[i] ? st?.logged[keys[i]] : undefined);
  const todo = rows.map((r, i) => ({ r, i })).filter(x => x.r.on && !done(x.i));
  const set = (i: number, p: Partial<Row>) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const total = rows.filter(r => r.on).reduce((n, r) => n + r.minutes, 0);

  async function log() {
    setBusy(true); setErr(null); setErrs({});
    try {
      const j = await post({ action: "log", activities: todo.map(x => x.r), ws: task?.ws, from: task?.id });
      if (j.login) { setExpired(true); throw new Error(j.error); }
      if (j.error) throw new Error(j.error);
      const e: Record<number, string> = {};
      (j.results as { error?: string }[]).forEach((res, n) => { if (res.error) e[todo[n].i] = res.error; });
      setErrs(e);
      if (j.closed?.length) setClosedOthers(j.closed);
      if (j.closedSelf) setClosed("yes");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }
  async function disconnect() {
    if (!confirm("Remove your Taiga key from this computer?")) return;
    await post({ action: "forget" });
  }

  async function closeTask() {
    if (!task) return;
    setClosed("busy");
    try {
      const j = await (await fetch(`/api/task/${task.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ws: task.ws, action: "done", text: `Logged ${rows.length} ${rows.length === 1 ? "activity" : "activities"} to Taiga.` }) })).json();
      if (j.error) throw new Error(j.error);
      setClosed("yes");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setClosed("no"); }
  }

  if (!rows.length) return <pre>{block}</pre>;
  const allDone = rows.every((_, i) => done(i));
  return (
    <div className="tg-card">
      <div className="wa-head">
        <span className="tg-ic"><Px name="board" /></span>
        <b>Taiga activities</b>
        <small>{rows.length} {rows.length === 1 ? "activity" : "activities"}, {Math.floor(total / 60) ? `${Math.floor(total / 60)} h ` : ""}{total % 60 ? `${total % 60} min` : ""}</small>
        {st?.storyUrl && <a className="tg-story" href={st.storyUrl} target="_blank" rel="noreferrer">{st.story}</a>}
      </div>
      {err && !expired && <div className="note bad">{err}</div>}
      {st && (!st.connected || expired) && !allDone ? <Connect again={expired || !!st.user} onDone={() => { setExpired(false); setErr(null); }} /> : (
        <div className="wa-row">
          <span className="hint">
            {allDone ? <><Px name="done" /> All logged in Taiga.{closed === "yes" ? " This task is closed." : ""}{closedOthers.length ? ` Also closed: ${closedOthers.join(", ")}.` : ""}</>
              : st ? <>Creates {todo.length} Done {todo.length === 1 ? "task" : "tasks"} under your user story{st.user ? ` as ${st.user}` : ""}. <button type="button" className="linkish" onClick={disconnect}>Disconnect</button></> : "Checking Taiga…"}
          </span>
          {allDone && task && closed !== "yes" && <button type="button" className="btn sm" disabled={closed === "busy"} onClick={closeTask}>{closed === "busy" ? <span className="spinner sm" /> : <Px name="check" />} Mark this task done</button>}
          {!allDone && <button type="button" className="btn sm primary tg-go" disabled={busy || !todo.length || !st} onClick={() => { setExpired(false); log(); }}>
            {busy ? <><span className="spinner sm" /> Logging…</> : <><Px name="done" /> Log {todo.length} to Taiga</>}</button>}
        </div>
      )}
      <div className="tg-rows">
        {rows.map((r, i) => {
          const d = done(i);
          return (
            <div key={i} className={`tg-row${d ? " done" : ""}${r.on ? "" : " off"}`}>
              {d ? <a className="tg-ref" href={d.url} target="_blank" rel="noreferrer" title="Open in Taiga"><Px name="done" /> #{d.ref}</a>
                : <input type="checkbox" checked={r.on} onChange={e => set(i, { on: e.target.checked })} aria-label="Include" />}
              <input className="input tg-title" value={r.title} disabled={!!d} onChange={e => set(i, { title: e.target.value })} aria-label="Title" />
              <div className="tg-meta">
              <input className="input" type="date" value={r.date} disabled={!!d} onChange={e => set(i, { date: e.target.value })} aria-label="Activity date" />
              <input className="input" type="time" value={r.start} disabled={!!d} onChange={e => set(i, { start: e.target.value })} aria-label="Start time" />
              <label className="tg-min"><input className="input" type="number" min={0} step={5} value={r.minutes} disabled={!!d} onChange={e => set(i, { minutes: Number(e.target.value) })} aria-label="Minutes" /> min</label>
              <label className="tg-tr" title="Training activity"><input type="checkbox" checked={r.training} disabled={!!d} onChange={e => set(i, { training: e.target.checked })} /> Training</label>
              </div>
              {errs[i] && <div className="note bad tg-err">{errs[i]}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
