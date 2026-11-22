"use client";
import OfficeAmbience from "./office-ambience";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Office, Desk, TaskView, RunView } from "@/lib/office";
import TaskPanel from "./task-panel";
import type { Building } from "./page";
import OfficeSwitch from "./office-switch";

import FilePicker, { uploadAll } from "./file-picker";
import ChatPanel, { MANAGER, isManager } from "./chat-panel";
import { Px, Emo, PxText, StateIcon, type PxName } from "./pixel-icon";
import { useHandoverDetector, type Handover } from "./handover";
import NewProject from "./new-project";
import { useVisiblePoll } from "./visible-poll";
import CharacterFace from "./character-face";
import ReferenceOffice from "./reference-office";
import { isLunchHour } from "@/lib/office-time";

const REFRESH_MS = 30_000;

function Avatar({ d, home }: { d: Desk; home?: boolean }) {
  return (
    <span className="avatar">
      {home ? <Px name="home" /> : <CharacterFace face={d.face} size={40} />}
      <span className="status-dot" />
    </span>
  );
}

function DueChip({ t }: { t: TaskView }) {
  if (!t.dueText) return null;
  return <span className={`due ${t.dueFlag ?? "ok"}`}>{t.dueFlag === "late" ? <><Px name="dot-late" /> </> : t.dueFlag === "risk" ? <><Px name="dot-risk" /> </> : t.dueFlag === "done" ? <><Px name="check" /> </> : ""}{t.dueText}</span>;
}

const pillOf = (s: string) => (s === "in_review" ? "review" : s === "in_progress" ? "doing" : "queued");

function TaskRow({ t, onOpen, showWho }: { t: TaskView; onOpen: (id: string) => void; showWho?: boolean }) {
  return (
    <button className="tasklink" onClick={() => onOpen(t.id)}>
      <span className="t"><PxText text={t.title} />{showWho && t.assignee ? <small>{t.assignee}</small> : null}</span>
      <span className="meta"><span className={`pill p-${pillOf(t.status)}`}>{t.statusLabel}</span><DueChip t={t} /></span>
    </button>
  );
}

/** One group in "Needs attention": icon, title, short hint and count above its rows. */
function AttnGroup({ kind, icon, title, hint, count, children, extra }: { kind: string; icon: PxName; title: string; hint: string; count: number; children: React.ReactNode[]; extra?: React.ReactNode }) {
  const [all, setAll] = useState(false);
  return (
    <section className={`ag ag-${kind}`} aria-label={title}>
      <header>
        <span className="ag-ic" aria-hidden><Px name={icon} /></span>
        <span className="ag-t"><b>{title}</b><small>{hint}</small></span>
        <span className="ag-n">{count}</span>
      </header>
      {extra}
      <ul>{all ? children : children.slice(0, 4)}</ul>
      {children.length > 4 && <button className="more" onClick={() => setAll(!all)}>{all ? "Show less" : `Show all ${children.length}`}</button>}
    </section>
  );
}

function AttnRow({ t, onOpen }: { t: TaskView; onOpen: () => void }) {
  return (
    <li>
      <button className="ar" onClick={onOpen}>
        <b><PxText text={t.title} /></b>
        <small>{t.assignee ?? "Unassigned"}{t.dueText ? ` · ${t.dueText}` : ""}{t.project ? ` · ${t.project}` : ""}</small>
      </button>
    </li>
  );
}

function NewTaskForm({ ws, desk, projects, onDone, initialDetail = "" }: { initialDetail?: string; ws: string; desk: Desk; projects: Office["projects"]; onDone: (id: string | null) => void }) {
  const [title, setTitle] = useState(""); const [detail, setDetail] = useState(initialDetail);
  const [due, setDue] = useState(""); const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  async function submit(now: boolean) {
    setBusy(true); setErr(null);
    try {
      const fileIds = files.length ? await uploadAll(files, ws) : [];
      const r = await fetch("/api/task", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ws, agentId: desk.agentId, title, detail, due, projectId, now, files: fileIds }) });
      const j = await r.json(); if (j.error) throw new Error(j.error);
      window.dispatchEvent(new CustomEvent("kantor:workflow", { detail: { action: now ? "assigned" : "queued", title: title.trim() || detail.trim().slice(0, 70) || "New task", agentId: desk.agentId } }));
      onDone(j.id);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <form className="newtask" onSubmit={e => { e.preventDefault(); submit(true); }}>
      <label htmlFor="nt-title" className="sect">New task for {desk.name}</label>
      <input id="nt-title" className="input" placeholder={detail.trim() ? "Title (optional, taken from the details)" : "e.g. Write 3 caption ideas for the Instagram teaser"} value={title} onChange={e => setTitle(e.target.value)} />
      <textarea id="nt-detail" placeholder="Details or instructions (optional)" value={detail} onChange={e => setDetail(e.target.value)}
        onPaste={e => { const p = [...e.clipboardData.files]; if (p.length) { e.preventDefault(); setFiles([...files, ...p]); } }} />
      <FilePicker files={files} onChange={setFiles} />
      <div className="chiprow">
        <label className="desc" htmlFor="nt-due">Due</label><input id="nt-due" className="input" type="date" value={due} onChange={e => setDue(e.target.value)} style={{ width: "auto" }} />
        <label className="desc" htmlFor="nt-proj">Project</label>
        <select id="nt-proj" className="input" value={projectId} onChange={e => setProjectId(e.target.value)} style={{ width: "auto" }}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="">No project</option>
        </select>
      </div>
      {err && <div className="note bad">{err}</div>}
      <div className="row">
        <button type="button" className="btn" onClick={() => onDone(null)}>Cancel</button>
        <button type="button" className="btn" disabled={(!title.trim() && !detail.trim()) || busy} onClick={() => submit(false)}>Save for later</button>
        <button className="btn primary" disabled={(!title.trim() && !detail.trim()) || busy}>{busy ? <><span className="spinner sm" /> Saving…</> : "Start now"}</button>
      </div>
    </form>
  );
}

function SquadPicker({ desk, ws, names, onSaved }: { desk: Desk; ws: string; names: string[]; onSaved: (squad: string) => void }) {
  const [squad, setSquad] = useState(desk.squad);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/squad", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ws, agentId: desk.agentId, squad }) });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "Could not move this desk.");
      onSaved(data.squad);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <div className="squad-picker"><label htmlFor="desk-squad" className="sect">Squad room</label><div><input id="desk-squad" className="input" list="squad-room-names" value={squad} onChange={e => setSquad(e.target.value)} maxLength={48} /><datalist id="squad-room-names">{names.map(name => <option key={name} value={name} />)}</datalist><button className="btn sm" type="button" disabled={busy || !squad.trim() || squad.trim() === desk.squad} onClick={save}>{busy ? "Moving…" : "Move desk"}</button></div>{error && <small role="alert">{error}</small>}</div>;
}

export default function OfficeView({ office, attention, people, seen, meId }: { office: Office; buildings: Building[]; attention: Office["attention"]; people: string[]; seen: Record<string, string>; meId?: string | null }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const refresh = useCallback(() => startRefresh(() => router.refresh()), [router]);
  const [openDesk, setOpenDesk] = useState<Desk | null>(null);
  const [openTask, setOpenTaskRaw] = useState<{ id: string; ws: string } | null>(null);
  const setOpenTask = (id: string | null, ws: string = office.workspaceId) => setOpenTaskRaw(id ? { id, ws } : null);
  const [adding, setAdding] = useState(false);
  const [chatWith, setChatWith] = useState<Desk | null>(null);
  const [openHuman, setOpenHuman] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [person, setPerson] = useState<string>("All");
  const [toast, setToast] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState<string | null>(null);
  const [newProject, setNewProject] = useState(false);
  const [roomId, setRoomId] = useState("all");
  const [compose, setCompose] = useState("");
  const [composeAgentId, setComposeAgentId] = useState("");
  const [chatPrompt, setChatPrompt] = useState("");
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [previewStep, setPreviewStep] = useState<number | null>(null);
  const [flowNotice, setFlowNotice] = useState("");
  const activeWork = office.rooms.some(r => r.desks.some(d => d.state === "working")) || office.idleDesks.some(d => d.state === "working");
  const [lunchHour, setLunchHour] = useState(false);
  useEffect(() => {
    const update = () => setLunchHour(office.switchOpen && isLunchHour(office.timeZone, new Date(), { ...office.workCalendar, activeWork }));
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => { update(); timer = setTimeout(tick, 60_000 - Date.now() % 60_000 + 50); };
    tick();
    document.addEventListener("visibilitychange", update);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", update); };
  }, [office.timeZone, office.switchOpen, office.workCalendar, activeWork]);
  // Mark "I'm online" every 2 minutes while this tab is open and visible.
  useEffect(() => {
    const beat = () => { if (document.visibilityState === "visible") fetch("/api/presence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ws: office.workspaceId }) }).catch(() => {}); };
    beat(); const t = setInterval(beat, 120_000);
    document.addEventListener("visibilitychange", beat);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", beat); };
  }, [office.workspaceId]);
  async function rerun(f: RunView) {
    setRerunning(f.id);
    try {
      const r = await fetch(`/api/task/${f.issueId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ws: f.ws, action: "rerun" }) });
      const j = await r.json(); if (j.error) throw new Error(j.error);
      setToast(`${f.agent} is trying again: ${f.issueTitle ?? "task"}`); refresh();
    } catch (e) { setToast("Couldn't retry: " + (e instanceof Error ? e.message : String(e))); }
    finally { setRerunning(null); }
  }
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); }, [toast]);

  useVisiblePoll(refresh, REFRESH_MS);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { if (openTask) setOpenTask(null); else if (openDesk || openHuman) { setOpenDesk(null); setOpenHuman(null); } else if (attentionOpen) setAttentionOpen(false); else if (controlsOpen) setControlsOpen(false); else if (previewStep !== null) setPreviewStep(null); } };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [openTask, openDesk, openHuman, attentionOpen, controlsOpen, previewStep]);

  const a = attention;
  const human = useMemo(() => (person === "All" ? a.human : a.human.filter(t => t.assignee === person)), [a.human, person]);
  const openT = (t: { id: string; ws: string }) => { setAttentionOpen(false); setOpenTask(t.id, t.ws); };
  const total = a.overdue.length + a.human.length + a.review.length + a.failed.length;
  const runs: RunView[] = openDesk ? office.agentsDetail[openDesk.agentId]?.runs ?? [] : [];
  const allTasks: TaskView[] = openDesk ? office.agentsDetail[openDesk.agentId]?.tasks ?? [] : [];
  const closeAll = () => { setOpenTask(null); setOpenDesk(null); setOpenHuman(null); setAdding(false); setChatWith(null); };
  const allDesks = useMemo(() => [...office.rooms.flatMap(r => r.desks), ...office.idleDesks], [office.rooms, office.idleDesks]);
  const uniqueDesks = useMemo(() => [...new Map(allDesks.map(d => [d.agentId, d])).values()], [allDesks]);
  const visibleRooms = roomId === "all" ? office.rooms : office.rooms.filter(r => r.id === roomId);
  const ownerName = office.members.find(m => m.id === meId)?.name ?? people[0] ?? null;
  const meetingAgent = uniqueDesks.find(d => /meeting|secretary/i.test(`${d.name} ${d.description}`)) ?? uniqueDesks.find(d => isManager(d.name)) ?? uniqueDesks[0];
  const mika = allDesks.find(d => isManager(d.name));
  const composeAgent = uniqueDesks.find(d => d.agentId === composeAgentId) ?? mika ?? uniqueDesks[0];
  const runtimeSummary = useMemo(() => {
    const groups = new Map<string, Office["runtimes"]>();
    for (const runtime of office.runtimes) groups.set(runtime.provider, [...(groups.get(runtime.provider) ?? []), runtime]);
    return [...groups.entries()];
  }, [office.runtimes]);
  useEffect(() => {
    const f = (event: Event) => { const id = (event as CustomEvent<{ agentId: string }>).detail?.agentId; const d = uniqueDesks.find(d => d.agentId === id); if (d) setOpenDesk(d); };
    addEventListener("kantor:desk", f); return () => removeEventListener("kantor:desk", f);
  }, [uniqueDesks]);

  // Agents walk over to hand work off.
  const officeRef = useRef<HTMLElement>(null);
  const [walks, setWalks] = useState<(Handover & { key: string })[]>([]);
  const walkingIds = useMemo(() => new Set(walks.map(w => w.from)), [walks]);
  const here = (p: string) => !!seen[p] && Date.now() - Date.parse(seen[p]) < 5 * 60000;
  const reviewer = (ownerName && here(ownerName) ? ownerName : people.find(here)) ?? ownerName;
  const nameOf = (k: string) => k.startsWith("person:") ? k.slice(7) : allDesks.find(d => d.agentId === k)?.name ?? "Agent";
  const startWalks = useCallback((hs: Handover[]) => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!hs.length) return;
    setRoomId("all");
    setWalks(cur => [...cur, ...hs.filter(h => !cur.some(c => c.from === h.from)).map(h => ({ ...h, face: uniqueDesks.find(d => d.agentId === h.from)?.face ?? null, key: h.from + ":" + Date.now() + Math.random() }))]);
    setFlowNotice(hs.map(h => `${h.fromName} → ${h.toName}: ${h.title}`).join(" · "));
  }, [uniqueDesks]);
  useHandoverDetector(office, reviewer, nameOf, startWalks);
  useEffect(() => {
    const f = (e: Event) => { const d = (e as CustomEvent).detail; startWalks([{ ...d, fromName: nameOf(d.from), toName: nameOf(d.to) }]); };
    addEventListener("kantor:handover", f); return () => removeEventListener("kantor:handover", f);
  });
  useEffect(() => {
    const f = (event: Event) => {
      const detail = (event as CustomEvent<{ action: string; title: string; agentId: string | null }>).detail;
      if (!detail) return;
      if (detail.action === "approve" || detail.action === "done") setFlowNotice(`Approved: ${detail.title}`);
      else if (detail.action === "assigned" || detail.action === "queued") {
        setFlowNotice(`${detail.action === "assigned" ? "Assigned" : "Queued"}: ${detail.title}`);
        const agent = uniqueDesks.find(d => d.agentId === detail.agentId);
        if (agent && reviewer) startWalks([{ from: `person:${reviewer}`, to: agent.agentId, title: detail.title, fromName: reviewer, toName: agent.name }]);
      }
      else if (detail.action === "revise" || detail.action === "reply") {
        setFlowNotice(`Feedback sent: ${detail.title}`);
        const agent = uniqueDesks.find(d => d.agentId === detail.agentId);
        if (agent && reviewer) startWalks([{ from: `person:${reviewer}`, to: agent.agentId, title: detail.title, fromName: reviewer, toName: agent.name }]);
      }
    };
    addEventListener("kantor:workflow", f); return () => removeEventListener("kantor:workflow", f);
  }, [reviewer, startWalks, uniqueDesks]);
  useEffect(() => { if (!flowNotice) return; const t = setTimeout(() => setFlowNotice(""), 8500); return () => clearTimeout(t); }, [flowNotice]);
  useEffect(() => {
    if (previewStep === null) return;
    if (previewStep === 2 && uniqueDesks.length) {
      const from = uniqueDesks[0], to = reviewer ? `person:${reviewer}` : uniqueDesks[1]?.agentId;
      if (to) startWalks([{ from: from.agentId, to, title: "Preview handover", fromName: from.name, toName: reviewer ?? uniqueDesks[1]?.name ?? "Agent" }]);
    }
    const timer = setTimeout(() => setPreviewStep(step => step === 3 ? null : step === null ? null : step + 1), previewStep === 2 ? 30000 : 2400);
    return () => clearTimeout(timer);
  }, [previewStep, reviewer, startWalks, uniqueDesks]);

  const cleared = [
    !a.overdue.length && "nothing late",
    !a.human.length && "no to-dos",
    !a.review.length && "nothing to review",
    !a.failed.length && "no failures",
  ].filter(Boolean) as string[];
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState("");
  const sessions = useRef<Record<string, string>>({});
  async function askManager() {
    if (!composeAgent || !compose.trim() || sending) return;
    const target = composeAgent, message = compose.trim();
    setSending(true); setSendStatus("");
    try {
      const key = `${office.workspaceId}:${target.agentId}`;
      let id = sessions.current[key];
      if (!id) {
        const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ws: office.workspaceId, agentId: target.agentId, title: message.slice(0,60) }) });
        const data = await response.json(); if (!response.ok || data.error || !data.id) throw new Error(data.error || "Could not start conversation.");
        id = data.id; sessions.current[key] = id;
      }
      const response = await fetch(`/api/chat/${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ws: office.workspaceId, text: message, files: [] }) });
      const data = await response.json(); if (!response.ok || data.error) throw new Error(data.error || "Message could not be sent.");
      setCompose(current => current.trim() === message ? "" : current);
      setSendStatus(`Message delivered to ${target.name}`);
      window.dispatchEvent(new CustomEvent("kantor:letter", { detail: { agentId: target.agentId } }));
    } catch(e) { setSendStatus(e instanceof Error ? e.message : String(e)); }
    finally { setSending(false); }
  }

  return (
    <>
      <header className="top office-top">
        <div className="wrap hbar">
          <button type="button" className="office-nav-button" onClick={() => { setControlsOpen(false); setAttentionOpen(false); window.dispatchEvent(new Event("kantor:nav-toggle")); }} aria-label="Toggle navigation" title="Navigation">☰</button>
          <div className="brand"><h1>{office.workspace}</h1><span className="office-live"><i />{office.switchOpen ? "Office open" : "Office closed"}</span></div>
          <div className="header-engines">{runtimeSummary.slice(0,3).map(([provider, list]) => <span key={provider}><b>{provider === "codex" ? "Codex" : provider === "claude" ? "Claude Code" : provider}</b><i><em style={{ width: `${Math.round(list.filter(r => r.online).length / list.length * 100)}%` }} /></i></span>)}</div>
          <div className="office-top-actions">
            <OfficeAmbience open={office.switchOpen} timeZone={office.timeZone} calendar={office.workCalendar} activeWork={activeWork} />
            <button type="button" className="office-top-button" onClick={() => { setControlsOpen(false); setAttentionOpen(v => !v); }} aria-expanded={attentionOpen}><Px name="bell" /> Attention{total > 0 && <b>{total}</b>}</button>
            <button type="button" className="office-top-button" onClick={() => setNewProject(true)}><Px name="plus" /> Project</button>
            <button type="button" className="office-top-button" onClick={() => { setAttentionOpen(false); setControlsOpen(v => !v); }} aria-expanded={controlsOpen}><Px name="gear" /> Controls</button>
          </div>
          {controlsOpen && <div className="office-controls" role="region" aria-label="Office controls">
            <div className="office-controls-head"><b>Office controls</b><button onClick={() => setControlsOpen(false)} aria-label="Close controls">×</button></div>
            <OfficeSwitch key={office.workspaceId + String(office.switchOpen)} ws={office.workspaceId} name={office.workspace} switchOpen={office.switchOpen} laptopOn={office.open} parked={office.parked} onDone={msg => { setToast(msg); refresh(); }} />
            <div className="runtime-strip" aria-label="AI engines">{runtimeSummary.map(([provider, list]) => <span className="runtime-chip" key={provider} title={list.map(r => r.name).join(", ")}><i className={list.some(r => r.online) ? "on" : ""} />{provider === "codex" ? "Codex" : provider === "claude" ? "Claude" : provider.charAt(0).toUpperCase() + provider.slice(1)}{list.length > 1 ? ` ${list.filter(r => r.online).length}/${list.length}` : ""}</span>)}</div>
            <div className="office-controls-foot"><span className="clock">{refreshing ? "Refreshing…" : `Updated ${office.updatedAt}`}</span></div>
            <button className="office-preview-button" onClick={() => { setControlsOpen(false); setRoomId("all"); setPreviewStep(0); }}>▶ Preview workflow animation <small>Visual only; no Multica task changes</small></button>
          </div>}
        </div>
      </header>

      <main className="wrap office-home">
        <section className="office" aria-label="Office floor plan" ref={officeRef}>


          {office.alerts.length > 0 && <div className="office-alerts">{office.alerts.map(x => <div key={x} className="alert" role="alert"><Px name="alert" /> {x}</div>)}</div>}

          <ReferenceOffice desks={roomId.startsWith("squad:") ? visibleRooms.flatMap(r => r.desks) : uniqueDesks} humans={office.members} ownerId={office.members.find(m => m.id === meId)?.id ?? office.members[0]?.id ?? null} lunch={lunchHour} previewWorking={previewStep === 1}
            onDesk={d => { setOpenDesk(d); setAdding(false); }} onHuman={name => { setOpenHuman(name); setOpenDesk(null); }}
            onMeeting={() => { if (meetingAgent) { setChatPrompt("Help me prepare a meeting agenda and a short briefing."); setChatWith(meetingAgent); } }}
            walks={walks} onDone={key => setWalks(items => items.filter(x => x.key !== key))}
            onDelivered={h => { if (h.title === "Preview handover") setPreviewStep(step => step === 2 ? 3 : step); }} />
          {previewStep !== null && <div className="workflow-preview" role="status"><div><b>Workflow preview</b><button onClick={() => setPreviewStep(null)} aria-label="Stop preview">×</button></div><ol>{["Assigned", "Working", "Handed over", "Approved"].map((label, i) => <li key={label} className={i === previewStep ? "active" : i < previewStep ? "done" : ""}>{label}</li>)}</ol><small>Visual preview only. No tasks changed.</small></div>}
          {flowNotice && previewStep === null && <div className="workflow-notice" role="status"><Px name="check" /> {flowNotice}</div>}
          {sendStatus && <div className="composer-feedback" role="status">{sendStatus}</div>}
          <form className="office-composer" onSubmit={e => { e.preventDefault(); askManager(); }}><label htmlFor="office-ask">Message</label><select aria-label="Choose agent to message" value={composeAgent?.agentId ?? ""} onChange={e => setComposeAgentId(e.target.value)}>{uniqueDesks.map(d => <option key={d.agentId} value={d.agentId}>{d.name}</option>)}</select><input id="office-ask" value={compose} onChange={e => setCompose(e.target.value)} placeholder={composeAgent ? "Write a message. Enter sends…" : "Add an agent to start chatting"} disabled={!composeAgent} /><button type="submit" disabled={!composeAgent || sending || !compose.trim()}>{sending ? "Sending…" : "Send →"}</button></form>
        </section>

        {attentionOpen && <button className="office-attn-scrim" aria-label="Close attention panel" onClick={() => setAttentionOpen(false)} />}
        {attentionOpen && <aside className="attn" aria-label="Needs attention">
          <div className="ah"><h2>Needs attention <span className="count">{total}</span></h2><button className="office-attn-close" onClick={() => setAttentionOpen(false)} aria-label="Close attention">×</button><p>{office.today}</p></div>
          <div className="scroll">
            {total === 0 && <p className="allclear"><Px name="party" /> All clear. Nothing needs you right now.</p>}
            {a.overdue.length > 0 && (
              <AttnGroup kind="late" icon="clock" title="Late & at risk" hint="past or close to the due date" count={a.overdue.length}>
                {a.overdue.map(t => <AttnRow key={t.id} t={t} onOpen={() => openT(t)} />)}
              </AttnGroup>
            )}
            {a.human.length > 0 && (
              <AttnGroup kind="human" icon="person" title="To-dos for people" hint="steps only a person can do" count={human.length}
                extra={people.length > 1 ? (
                  <div className="tabs">{["All", ...people].map(p => <button key={p} className="tab" aria-pressed={person === p} onClick={() => setPerson(p)}>{p}</button>)}</div>
                ) : undefined}>
                {human.map(t => <AttnRow key={t.id} t={t} onOpen={() => openT(t)} />)}
              </AttnGroup>
            )}
            {a.review.length > 0 && (
              <AttnGroup kind="review" icon="eyes" title="Waiting for review" hint="agents finished or asked you something" count={a.review.length}>
                {a.review.map(t => <AttnRow key={t.id} t={t} onOpen={() => openT(t)} />)}
              </AttnGroup>
            )}
            {a.failed.length > 0 && (
              <AttnGroup kind="fail" icon="failed" title="Failed" hint="last 7 days" count={a.failed.length}>
                {a.failed.map(f => (
                  <li key={f.id} className="failrow">
                    <button className="ar" onClick={() => f.issueId && setOpenTask(f.issueId, f.ws)}>
                      <b>{f.issueTitle ?? "Untitled task"}</b><small>{f.agent} · {f.error} · {f.when}</small>
                    </button>
                    {f.issueId && <button className="btn sm" disabled={rerunning === f.id} onClick={() => rerun(f)}>{rerunning === f.id ? "…" : <><Px name="refresh" /> Retry</>}</button>}
                  </li>
                ))}
              </AttnGroup>
            )}
            {total > 0 && cleared.length > 0 && <p className="clearline"><Px name="check" /> {cleared.join(" · ")}</p>}
          </div>
        </aside>}
      </main>

      {(openDesk || openTask || chatWith || openHuman) && <div className="scrim" onClick={closeAll} />}

      {openDesk && !openTask && !chatWith && (
        <div className="drawer" role="dialog" aria-modal="true" aria-label={openDesk.name}>
          <div className="dhead">
            <span className={`st-${openDesk.state}`}><Avatar d={openDesk} /></span>
            <div className="meta"><h2>{openDesk.name}</h2><div className="role">{openDesk.runtime}</div></div>
            <button className="x" onClick={closeAll} aria-label="Close"><Px name="close" size="1em" /></button>
          </div>
          <div className="dbody">
            <div className="note"><span><StateIcon state={openDesk.state} />{openDesk.bubble}</span></div>
            <SquadPicker key={openDesk.agentId} desk={openDesk} ws={office.workspaceId} names={office.rooms.map(r => r.name)} onSaved={squad => { setOpenDesk(d => d ? { ...d, squad } : d); setToast(`${openDesk.name} moved to ${squad}.`); refresh(); }} />
            {adding ? (
              <NewTaskForm ws={office.workspaceId} desk={openDesk} projects={office.projects} initialDetail={draft} onDone={id => { setAdding(false); setDraft(""); refresh(); if (id) setOpenTask(id); }} />
            ) : (
              <div className="chiprow">
                <button className="btn primary" onClick={() => { setDraft(""); setAdding(true); }}><Px name="plus" size="0.9em" /> New task</button>
              </div>
            )}
            <div>
              <div className="sect">Open tasks ({allTasks.length})</div>
              <div className="tasks">{allTasks.length ? allTasks.map(t => <TaskRow key={t.id} t={t} onOpen={setOpenTask} />) : <p className="desc">No open tasks.</p>}</div>
            </div>
            <div>
              <div className="sect">Recent work</div>
              <div className="tasks">{runs.length ? runs.map(r => (
                <button key={r.id} className="tasklink" onClick={() => r.issueId && setOpenTask(r.issueId, r.ws)}>
                  <span className="t">{r.issueTitle ?? "Task"}<small>{r.when}{r.error ? ` · ${r.error}` : ""}</small></span>
                  <span className={`pill ${r.status === "failed" ? "p-review" : r.status === "completed" ? "p-done" : /cancel/.test(r.status) ? "p-locked" : r.status === "queued" ? "p-paused" : "p-doing"}`}>{r.status === "failed" ? "Failed" : r.status === "completed" ? "Done" : /cancel/.test(r.status) ? "Cancelled" : r.status === "queued" ? "Queued" : "Running"}</span>
                </button>)) : <p className="desc">Hasn&apos;t worked yet.</p>}</div>
            </div>
            {openDesk.description && <details className="extra"><summary>About {openDesk.name}</summary><p className="desc">{openDesk.description}</p></details>}
          </div>
        </div>
      )}

      {openHuman && !openTask && !chatWith && (
        <div className="drawer" role="dialog" aria-modal="true" aria-label={`${openHuman}'s desk`}>
          <div className="dhead">
            <span className="avatar">{openHuman.slice(0, 1).toUpperCase()}</span>
            <div className="meta"><h2>{openHuman}&apos;s desk</h2><div className="role">{office.workspace}</div></div>
            <button className="x" onClick={closeAll} aria-label="Close"><Px name="close" size="1em" /></button>
          </div>
          <div className="dbody">
            <div>
              <div className="sect"><Px name="eyes" /> To review ({a.review.length})</div>
              <div className="tasks">{a.review.length ? a.review.map(t => <TaskRow key={t.id} t={t} showWho onOpen={id => setOpenTask(id, t.ws)} />) : <p className="desc">Nothing waiting for review ☕</p>}</div>
            </div>
            <div>
              <div className="sect"><Px name="person" /> To-dos for {openHuman} ({a.human.filter(t => t.assignee === openHuman).length})</div>
              <div className="tasks">{a.human.filter(t => t.assignee === openHuman).map(t => <TaskRow key={t.id} t={t} onOpen={id => setOpenTask(id, t.ws)} />)}
                {!a.human.some(t => t.assignee === openHuman) && <p className="desc">No to-dos for {openHuman}.</p>}</div>
            </div>
          </div>
        </div>
      )}

      {chatWith && (
        <ChatPanel ws={office.workspaceId} agent={{ id: chatWith.agentId, name: chatWith.name, emoji: chatWith.emoji, role: chatWith.description }}
          isMika={isManager(chatWith.name)} projectId={null} laptopOn={office.open} initialPrompt={chatPrompt}
          onClose={() => { setChatWith(null); setChatPrompt(""); }}
          onMakeTask={(detail, agentId) => { const d = allDesks.find(x => x.agentId === agentId) ?? chatWith; setChatWith(null); setOpenDesk(d); setDraft(detail); setAdding(true); }} />
      )}
      {/* Floating button to chat with the office manager, like a help button on a website. */}
      {mika && !chatWith && !openDesk && !openTask && !openHuman && (
        <button className="mikafab" onClick={() => { setChatPrompt(""); setChatWith(mika); }} aria-label={`Chat with ${MANAGER}, the office manager`}>
          <span className="mf-av">{mika.avatar ? <img src={mika.avatar} alt="" /> : <Emo e={mika.emoji ?? "🦄"} />}</span>
          <span className="mf-txt"><b>Ask {MANAGER}</b><small>ideas, tasks, new agents</small></span>
        </button>
      )}
      {newProject && <NewProject ws={office.workspaceId}
        people={[...office.members.map(m => ({ kind: "member" as const, id: m.id, name: m.name, emoji: null })), ...[...new Map(allDesks.map(d => [d.agentId, d])).values()].map(d => ({ kind: "agent" as const, id: d.agentId, name: d.name, emoji: d.emoji }))]}
        onDone={id => { setNewProject(false); if (id) { setToast("Project created. Its room appears once a task in it is assigned to an agent."); refresh(); } }} />}
      {toast && <div className="toast" role="status">{toast}</div>}
      {openTask && <TaskPanel id={openTask.id} ws={openTask.ws} onClose={() => setOpenTask(null)} onChanged={refresh} />}
    </>
  );
}
