"use client";
import { useEffect, useMemo, useState } from "react";
import type { Desk, Office, RunView, TaskView } from "@/lib/office";
import { pickContinuitySession, readActiveChatId } from "@/lib/chat-continuity";
import CharacterFace from "./character-face";
import CharacterPicker from "./character-picker";
import FilePicker, { uploadAll } from "./file-picker";
import { Px, PxText, StateIcon } from "./pixel-icon";

export type DeskDrawerTab = "tasks" | "chats" | "assign" | "create" | "setup";

type AgentChatSession = {
  id: string;
  agentId: string;
  title: string;
  updatedAt: string;
  unread: number;
  last: string;
};

function relChatTime(iso: string) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(mins) || mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso));
}

const pillOf = (s: string) => (s === "in_review" ? "review" : s === "in_progress" ? "doing" : "queued");

function DueChip({ t }: { t: TaskView }) {
  if (!t.dueText) return null;
  return (
    <span className={`due ${t.dueFlag ?? "ok"}`}>
      {t.dueFlag === "late" ? <><Px name="dot-late" /> </> : t.dueFlag === "risk" ? <><Px name="dot-risk" /> </> : t.dueFlag === "done" ? <><Px name="check" /> </> : ""}
      {t.dueText}
    </span>
  );
}

export default function AgentDeskDrawer({
  office,
  desk,
  allDesks,
  tasks,
  runs,
  initialTab = "tasks",
  initialDraft = "",
  preferredProjectId = null,
  onClose,
  onOpenTask,
  onOpenChat,
  onOpenNewProject,
  onStartHuddle,
  onStartHandoff,
  onSendCoffee,
  onQuickApprove,
  onRetryRun,
  onTaskAssigned,
  onTaskCreated,
  onDeskPatched,
  onToast,
  onRefresh,
}: {
  office: Office;
  desk: Desk;
  allDesks: Desk[];
  tasks: TaskView[];
  runs: RunView[];
  initialTab?: DeskDrawerTab;
  initialDraft?: string;
  preferredProjectId?: string | null;
  onClose: () => void;
  onOpenTask: (id: string, ws?: string) => void;
  onOpenChat: (sessionId?: string | null, startFresh?: boolean) => void;
  onOpenNewProject: () => void;
  onStartHuddle: () => void;
  onStartHandoff: () => void;
  onSendCoffee: () => void;
  onQuickApprove: (t: TaskView) => Promise<void>;
  onRetryRun: (r: RunView) => Promise<void>;
  onTaskAssigned: (task: TaskView, targetDesk: Desk, startNow: boolean, fromAgentId?: string | null) => void;
  onTaskCreated: (id: string, title: string, now: boolean) => void;
  onDeskPatched: (patch: Partial<Desk>) => void;
  onToast: (msg: string) => void;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<DeskDrawerTab>(initialTab);
  const [chatSessions, setChatSessions] = useState<AgentChatSession[] | null>(null);
  const [chatErr, setChatErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setChatErr(null);
    fetch(`/api/chat?ws=${encodeURIComponent(office.workspaceId)}&agent=${encodeURIComponent(desk.agentId)}`)
      .then(r => r.json())
      .then(j => {
        if (!alive) return;
        if (j.error) throw new Error(j.error);
        setChatSessions(Array.isArray(j.sessions) ? j.sessions : []);
      })
      .catch(e => { if (alive) setChatErr(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [office.workspaceId, desk.agentId]);

  const taskRuns = useMemo(() => runs.filter(r => r.kind !== "chat" && !!r.issueId), [runs]);
  const activeChat = useMemo(
    () => pickContinuitySession(chatSessions ?? [], desk.agentId, { savedId: readActiveChatId(office.workspaceId, desk.agentId) }),
    [chatSessions, desk.agentId, office.workspaceId]
  );

  // ---- Create New Task state ----
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState(initialDraft);
  const [projectId, setProjectId] = useState(office.projects[0]?.id ?? "");
  useEffect(() => {
    if (preferredProjectId && office.projects.some(p => p.id === preferredProjectId)) {
      setProjectId(preferredProjectId);
    }
  }, [preferredProjectId, office.projects]);
  const [priority, setPriority] = useState<"urgent" | "high" | "medium" | "low">("medium");
  const [due, setDue] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  // ---- Assign Existing Card state ----
  const [assignScope, setAssignScope] = useState<"unassigned" | "all">("unassigned");
  const [assignProj, setAssignProj] = useState<string>("all");
  const [assignQuery, setAssignQuery] = useState("");
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignErr, setAssignErr] = useState<string | null>(null);

  // ---- Inline task action state ----
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [handoffTaskId, setHandoffTaskId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // ---- Setup tab state ----
  const [squad, setSquad] = useState(desk.squad);
  const [savingSquad, setSavingSquad] = useState(false);
  const [engineId, setEngineId] = useState(desk.runtimeId ?? "");
  const [savingEngine, setSavingEngine] = useState(false);
  const [face, setFace] = useState(desk.face ?? "raya");
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [savingFace, setSavingFace] = useState(false);
  const [setupErr, setSetupErr] = useState<string | null>(null);

  const otherDesks = useMemo(() => allDesks.filter(d => d.agentId !== desk.agentId), [allDesks, desk.agentId]);

  // Cards in this workspace not already assigned to this agent
  const assignablePool = useMemo(
    () => office.openTasks.filter(t => !(t.assigneeType === "agent" && t.assigneeId === desk.agentId)),
    [office.openTasks, desk.agentId]
  );

  const unassignedCount = useMemo(
    () => assignablePool.filter(t => !t.assigneeId).length,
    [assignablePool]
  );

  const filteredAssignable = useMemo(() => {
    const q = assignQuery.trim().toLowerCase();
    return assignablePool.filter(t => {
      if (assignScope === "unassigned" && t.assigneeId) return false;
      if (assignProj === "none" && t.projectId) return false;
      if (assignProj !== "all" && assignProj !== "none" && t.projectId !== assignProj) return false;
      if (q && !t.title.toLowerCase().includes(q) && !t.key.toLowerCase().includes(q) && !(t.project ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [assignablePool, assignScope, assignProj, assignQuery]);

  async function submitNewTask(now: boolean) {
    if (!title.trim() && !detail.trim()) return;
    setCreating(true);
    setCreateErr(null);
    try {
      const fileIds = files.length ? await uploadAll(files, office.workspaceId) : [];
      const res = await fetch("/api/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ws: office.workspaceId,
          agentId: desk.agentId,
          title,
          detail,
          due,
          projectId,
          priority,
          now,
          files: fileIds,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Could not create task.");
      const cleanTitle = title.trim() || detail.trim().split("\n")[0].slice(0, 70) || "New task";
      setTitle("");
      setDetail("");
      setDue("");
      setFiles([]);
      setTab("tasks");
      onTaskCreated(data.id, cleanTitle, now);
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function assignCardTo(task: TaskView, target: Desk, startNow: boolean) {
    setAssigningId(task.id);
    setAssignErr(null);
    try {
      const res = await fetch(`/api/task/${task.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ws: task.ws,
          action: "assign",
          assigneeType: "agent",
          assigneeId: target.agentId,
          startNow,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Could not assign card.");
      const fromAgentId = task.assigneeType === "agent" ? task.assigneeId : null;
      setHandoffTaskId(null);
      onTaskAssigned(task, target, startNow, fromAgentId);
      if (target.agentId === desk.agentId) setTab("tasks");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAssignErr(msg);
      onToast(msg);
    } finally {
      setAssigningId(null);
    }
  }

  async function runInlineTaskAction(t: TaskView, action: "start" | "stop" | "approve") {
    setBusyTaskId(t.id);
    try {
      if (action === "approve") {
        await onQuickApprove(t);
        return;
      }
      const body = action === "start" ? { ws: t.ws, action: "move", status: "todo" } : { ws: t.ws, action: "stop" };
      const res = await fetch(`/api/task/${t.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Action failed.");
      if (action === "start") {
        window.dispatchEvent(new CustomEvent("kantor:speech", {
          detail: { actorId: desk.agentId, tone: "working", badge: "Started", text: `Starting: ${t.title.slice(0, 26)}`, pixelKind: "dots", ms: 3200 },
        }));
        onToast(`${desk.name} started "${t.title}"`);
      } else {
        onToast(`Stopped active run on "${t.title}"`);
      }
      onRefresh();
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyTaskId(null);
    }
  }

  async function saveSquad() {
    setSavingSquad(true);
    setSetupErr(null);
    try {
      const res = await fetch("/api/squad", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ws: office.workspaceId, agentId: desk.agentId, squad }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Could not move desk.");
      onDeskPatched({ squad: data.squad });
      onToast(`${desk.name} moved to ${data.squad}.`);
      onRefresh();
    } catch (e) {
      setSetupErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingSquad(false);
    }
  }

  async function saveEngine(nextId: string) {
    const prev = engineId;
    setEngineId(nextId);
    setSavingEngine(true);
    setSetupErr(null);
    try {
      const res = await fetch("/api/crew", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ws: office.workspaceId, agentId: desk.agentId, runtimeId: nextId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Could not switch engine.");
      const rt = office.runtimes.find(r => r.id === nextId);
      onDeskPatched({ runtimeId: nextId, runtime: rt ? `${rt.name}${rt.owner ? ` · ${rt.owner}` : ""}` : desk.runtime });
      onToast(`${desk.name}: ${data.message}`);
      onRefresh();
    } catch (e) {
      setEngineId(prev);
      setSetupErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingEngine(false);
    }
  }

  async function saveFace(nextFace: string) {
    const prev = face;
    setFace(nextFace);
    setSavingFace(true);
    setSetupErr(null);
    try {
      const res = await fetch("/api/crew", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ws: office.workspaceId, agentId: desk.agentId, face: nextFace }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Could not save character.");
      onDeskPatched({ face: nextFace });
      onToast(`${desk.name}'s appearance updated.`);
      onRefresh();
    } catch (e) {
      setFace(prev);
      setSetupErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingFace(false);
    }
  }

  return (
    <div className="drawer desk-drawer" role="dialog" aria-modal="true" aria-label={desk.name}>
      <div className="dhead">
        <span className={`st-${desk.state}`}>
          <button
            type="button"
            className="avatar avatar-edit-btn"
            title="Change avatar"
            aria-label={`Change ${desk.name}'s avatar`}
            aria-expanded={avatarOpen}
            onClick={() => setAvatarOpen(v => !v)}
          >
            <CharacterFace face={face} size={44} shape="circle" />
            <span className="status-dot" />
            <span className="avatar-edit-badge" aria-hidden="true">✎</span>
          </button>
        </span>
        <div className="meta">
          <h2>{desk.name}</h2>
          <div className="role">
            <span>{desk.squad}</span>
            <span> · {desk.runtime}</span>
          </div>
        </div>
        <button
          type="button"
          className={`btn sm${avatarOpen ? " primary" : ""}`}
          aria-expanded={avatarOpen}
          onClick={() => setAvatarOpen(v => !v)}
        >
          {avatarOpen ? "Done" : "Avatar"}
        </button>
        <button type="button" className="x" onClick={onClose} aria-label="Close">
          <Px name="close" size="1em" />
        </button>
      </div>

      {avatarOpen && (
        <div className="avatar-quick-tray in-drawer">
          <div className="desk-sect-head">
            <span className="sect">Choose avatar for {desk.name}</span>
            {savingFace && <span className="spinner sm" />}
          </div>
          {setupErr && <div className="note bad">{setupErr}</div>}
          <CharacterPicker value={face} onChange={next => void saveFace(next)} />
        </div>
      )}

      {/* Quick Interactive Actions Strip */}
      <div className="desk-actions-bar" aria-label="Quick agent actions">
        <button type="button" className="desk-act primary" onClick={() => onOpenChat(activeChat?.id ?? null, false)}>
          <Px name="chat" /><span>Chat</span>
        </button>
        <button type="button" className={`desk-act${tab === "create" ? " on" : ""}`} onClick={() => setTab("create")}>
          <Px name="plus" /><span>New Task</span>
        </button>
        <button type="button" className={`desk-act${tab === "assign" ? " on" : ""}`} onClick={() => setTab("assign")}>
          <Px name="board" /><span>Assign Card</span>{unassignedCount > 0 && <b>{unassignedCount}</b>}
        </button>
        <button type="button" className="desk-act" onClick={onStartHuddle}>
          <Px name="team" /><span>Huddle</span>
        </button>
        <button type="button" className="desk-act" onClick={onStartHandoff} disabled={!otherDesks.length}>
          <Px name="rocket" /><span>Hand off</span>
        </button>
        <button type="button" className="desk-act" onClick={onSendCoffee} disabled={desk.state === "working"} title={desk.state === "working" ? "Agent is currently working" : "Send for a quick coffee stretch"}>
          <Px name="coffee" /><span>Break</span>
        </button>
      </div>

      {/* Section Tabs */}
      <div className="desk-tabs" role="tablist" aria-label="Agent workspace views">
        <button type="button" role="tab" aria-selected={tab === "tasks"} onClick={() => setTab("tasks")}>
          Tasks <small>{tasks.length}</small>
        </button>
        <button type="button" role="tab" aria-selected={tab === "chats"} onClick={() => setTab("chats")}>
          Chats {chatSessions !== null && <small>{chatSessions.length}</small>}
        </button>
        <button type="button" role="tab" aria-selected={tab === "assign"} onClick={() => setTab("assign")}>
          Assign <small>{assignablePool.length}</small>
        </button>
        <button type="button" role="tab" aria-selected={tab === "create"} onClick={() => setTab("create")}>
          New task
        </button>
        <button type="button" role="tab" aria-selected={tab === "setup"} onClick={() => setTab("setup")}>
          Setup
        </button>
      </div>

      <div className="dbody">
        {tab === "tasks" && (
          <>
            <div className="note">
              <span><StateIcon state={desk.state} />{desk.bubble}</span>
            </div>

            <div>
              <div className="desk-sect-head">
                <div className="sect">Open tasks ({tasks.length})</div>
                <div className="desk-sect-btns">
                  <button type="button" className="linkish" onClick={() => setTab("assign")}>+ Assign existing</button>
                  <button type="button" className="linkish" onClick={() => setTab("create")}>+ Create new</button>
                </div>
              </div>

              {tasks.length === 0 ? (
                <div className="desk-empty-card">
                  <p className="desc">{desk.name} has no open tasks right now.</p>
                  <div className="chiprow">
                    <button type="button" className="btn sm primary" onClick={() => setTab("create")}>
                      <Px name="plus" size="0.9em" /> Create task
                    </button>
                    {assignablePool.length > 0 && (
                      <button type="button" className="btn sm" onClick={() => setTab("assign")}>
                        <Px name="board" size="0.9em" /> Assign card ({assignablePool.length})
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="tasks">
                  {tasks.map(t => {
                    const busy = busyTaskId === t.id || assigningId === t.id;
                    const canReassign = t.status !== "in_progress" && otherDesks.length > 0;
                    return (
                      <div key={t.id} className="desk-task-card">
                        <button type="button" className="tasklink" onClick={() => onOpenTask(t.id, t.ws)}>
                          <span className="t">
                            <PxText text={t.title} />
                            <small>{t.key}{t.project ? ` · ${t.project}` : ""}</small>
                          </span>
                          <span className="meta">
                            <span className={`pill p-${pillOf(t.status)}`}>{t.statusLabel}</span>
                            <DueChip t={t} />
                          </span>
                        </button>
                        <div className="desk-task-actions">
                          {t.status === "in_review" && (
                            <button type="button" className="btn sm primary" disabled={busy} onClick={() => runInlineTaskAction(t, "approve")}>
                              {busy ? "…" : <><Px name="check" /> Approve</>}
                            </button>
                          )}
                          {t.status === "backlog" && (
                            <button type="button" className="btn sm primary" disabled={busy} onClick={() => runInlineTaskAction(t, "start")}>
                              {busy ? "…" : <><Px name="play" /> Start now</>}
                            </button>
                          )}
                          {t.status === "in_progress" && (
                            <button type="button" className="btn sm" disabled={busy} onClick={() => runInlineTaskAction(t, "stop")}>
                              {busy ? "…" : <><Px name="pause" /> Stop</>}
                            </button>
                          )}
                          {canReassign && (
                            <button
                              type="button"
                              className="btn sm ghost"
                              disabled={busy}
                              onClick={() => setHandoffTaskId(cur => (cur === t.id ? null : t.id))}
                            >
                              ⇄ Reassign
                            </button>
                          )}
                          <button type="button" className="btn sm ghost" onClick={() => onOpenTask(t.id, t.ws)}>
                            Open
                          </button>
                        </div>
                        {handoffTaskId === t.id && (
                          <div className="desk-reassign-row">
                            <span>Move to:</span>
                            <div className="desk-reassign-list">
                              {otherDesks.map(other => (
                                <button
                                  key={other.agentId}
                                  type="button"
                                  className="btn sm"
                                  disabled={busy}
                                  onClick={() => assignCardTo(t, other, t.status !== "backlog")}
                                >
                                  {other.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <div className="sect">Recent task runs</div>
              <div className="tasks">
                {taskRuns.length ? taskRuns.map(r => (
                  <div key={r.id} className="failrow">
                    <button type="button" className="tasklink" onClick={() => r.issueId && onOpenTask(r.issueId, r.ws)}>
                      <span className="t">
                        {r.issueTitle ?? "Task"}
                        <small>{r.when}{r.error ? ` · ${r.error}` : ""}</small>
                      </span>
                      <span className={`pill ${r.status === "failed" ? "p-review" : r.status === "completed" ? "p-done" : /cancel/.test(r.status) ? "p-locked" : r.status === "queued" ? "p-paused" : "p-doing"}`}>
                        {r.status === "failed" ? "Failed" : r.status === "completed" ? "Done" : /cancel/.test(r.status) ? "Cancelled" : r.status === "queued" ? "Queued" : "Running"}
                      </span>
                    </button>
                    {r.status === "failed" && r.issueId && (
                      <button
                        type="button"
                        className="btn sm"
                        disabled={retryingId === r.id}
                        onClick={async () => {
                          setRetryingId(r.id);
                          try { await onRetryRun(r); } finally { setRetryingId(null); }
                        }}
                      >
                        {retryingId === r.id ? "…" : <><Px name="refresh" /> Retry</>}
                      </button>
                    )}
                  </div>
                )) : <p className="desc">No task runs yet. Casual chats stay in the Chats tab.</p>}
              </div>
            </div>

            {desk.description && (
              <details className="extra">
                <summary>About {desk.name}</summary>
                <p className="desc">{desk.description}</p>
              </details>
            )}
          </>
        )}

        {tab === "chats" && (
          <div className="desk-chats-pane">
            <div className="note">
              <span><Px name="chat" /> Ngobrol dengan {desk.name} terpisah dari Task — satu konteks tetap masuk dalam satu percakapan.</span>
            </div>
            <div className="chiprow">
              <button type="button" className="btn sm primary" onClick={() => onOpenChat(activeChat?.id ?? null, false)}>
                <Px name="chat" /> {activeChat ? "Continue active chat" : `Start chat with ${desk.name}`}
              </button>
              <button type="button" className="btn sm" onClick={() => onOpenChat(null, true)}>
                <Px name="plus" size="0.9em" /> New topic
              </button>
            </div>
            {chatErr && <div className="note bad">{chatErr}</div>}
            {chatSessions === null && !chatErr ? (
              <div className="loading"><span className="spinner sm" /> Loading conversations…</div>
            ) : chatSessions && chatSessions.length === 0 ? (
              <div className="desk-empty-card">
                <p className="desc">Belum ada percakapan dengan {desk.name}. Mulai ngobrol santai atau brainstorming tanpa membuat task dulu.</p>
              </div>
            ) : (
              <div className="tasks">
                {(chatSessions ?? []).map(sx => (
                  <button
                    key={sx.id}
                    type="button"
                    className={`tasklink${activeChat?.id === sx.id ? " is-active-chat" : ""}`}
                    onClick={() => onOpenChat(sx.id, false)}
                  >
                    <span className="t">
                      {sx.title}
                      <small>{sx.last ? `${sx.last} · ` : ""}{relChatTime(sx.updatedAt)}</small>
                    </span>
                    <span className="meta">
                      {activeChat?.id === sx.id && <span className="pill p-doing">Active</span>}
                      {sx.unread > 0 && <span className="sl-badge">{sx.unread}</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "assign" && (
          <div className="desk-assign-pane">
            <p className="desc">
              Pick an existing Multica card to assign directly to <b>{desk.name}</b>.
            </p>
            <div className="desk-assign-filters">
              <div className="tabs" role="group" aria-label="Filter cards by assignment">
                <button type="button" className="tab" aria-pressed={assignScope === "unassigned"} onClick={() => setAssignScope("unassigned")}>
                  Unassigned ({unassignedCount})
                </button>
                <button type="button" className="tab" aria-pressed={assignScope === "all"} onClick={() => setAssignScope("all")}>
                  All open ({assignablePool.length})
                </button>
              </div>
              <select className="input" aria-label="Filter by project" value={assignProj} onChange={e => setAssignProj(e.target.value)}>
                <option value="all">All projects</option>
                {office.projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
                <option value="none">No project</option>
              </select>
            </div>

            <input
              className="input"
              type="search"
              value={assignQuery}
              onChange={e => setAssignQuery(e.target.value)}
              placeholder="Search cards by title, key, or project…"
              aria-label="Search assignable cards"
            />

            {assignErr && <div className="note bad">{assignErr}</div>}

            {filteredAssignable.length === 0 ? (
              <div className="desk-empty-card">
                <p className="desc">
                  {assignScope === "unassigned" && assignablePool.length > 0
                    ? "No unassigned cards match this filter. Switch to “All open” to reassign from a teammate, or create a brand-new task."
                    : "No matching cards found."}
                </p>
                <div className="chiprow">
                  {assignScope === "unassigned" && assignablePool.length > 0 && (
                    <button type="button" className="btn sm" onClick={() => setAssignScope("all")}>
                      Show all open ({assignablePool.length})
                    </button>
                  )}
                  <button type="button" className="btn sm primary" onClick={() => setTab("create")}>
                    <Px name="plus" size="0.9em" /> Create new task
                  </button>
                </div>
              </div>
            ) : (
              <ul className="assign-list">
                {filteredAssignable.map(card => {
                  const busy = assigningId === card.id;
                  const runningElsewhere = card.status === "in_progress";
                  return (
                    <li key={card.id} className="assign-card">
                      <button type="button" className="assign-card-main" onClick={() => onOpenTask(card.id, card.ws)}>
                        <span className="assign-card-top">
                          <span className="clock">{card.key}</span>
                          {card.project && <span className="chip">{card.project}</span>}
                          <span className={`pill p-${pillOf(card.status)}`}>{card.statusLabel}</span>
                        </span>
                        <b><PxText text={card.title} /></b>
                        <small>
                          {card.assignee ? `Currently: ${card.assignee}` : "Unassigned"}
                          {card.dueText ? ` · ${card.dueText}` : ""}
                        </small>
                      </button>
                      <div className="assign-card-acts">
                        {runningElsewhere ? (
                          <span className="hint">Running — stop before reassigning</span>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="btn sm primary"
                              disabled={busy}
                              onClick={() => assignCardTo(card, desk, true)}
                            >
                              {busy ? <><span className="spinner sm" /> Assigning…</> : <><Px name="rocket" /> Assign &amp; Start</>}
                            </button>
                            <button
                              type="button"
                              className="btn sm"
                              disabled={busy}
                              onClick={() => assignCardTo(card, desk, false)}
                            >
                              Queue
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {tab === "create" && (
          <form className="newtask desk-create-form" onSubmit={e => { e.preventDefault(); void submitNewTask(true); }}>
            <div className="desk-create-head">
              <span className="sect">New task directly for {desk.name}</span>
              <span className="chip">
                <CharacterFace face={face} size={20} shape="circle" /> {desk.name}
              </span>
            </div>

            <label className="desk-field">
              <span>Task title</span>
              <input
                className="input"
                autoFocus
                placeholder={detail.trim() ? "Optional — will use first line of instructions" : "e.g. Write 3 launch captions & visual brief"}
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
            </label>

            <label className="desk-field">
              <span>Project</span>
              <div className="desk-proj-row">
                <select className="input" value={projectId} onChange={e => setProjectId(e.target.value)}>
                  {office.projects.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.icon ? `${p.icon} ` : ""}{p.name}
                    </option>
                  ))}
                  <option value="">No project</option>
                </select>
                <button type="button" className="btn sm" onClick={onOpenNewProject} title="Create a new Multica project">
                  <Px name="plus" size="0.9em" /> Project
                </button>
              </div>
            </label>

            <label className="desk-field">
              <span>Instructions &amp; context</span>
              <textarea
                className="input"
                rows={4}
                placeholder="Write instructions, acceptance criteria, or paste screenshots…"
                value={detail}
                onChange={e => setDetail(e.target.value)}
                onPaste={e => {
                  const p = [...e.clipboardData.files];
                  if (p.length) { e.preventDefault(); setFiles([...files, ...p]); }
                }}
              />
            </label>

            <div className="formgrid">
              <label>
                Priority
                <select className="input" value={priority} onChange={e => setPriority(e.target.value as typeof priority)}>
                  <option value="urgent">Urgent</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </label>
              <label>
                Due date
                <input className="input" type="date" value={due} onChange={e => setDue(e.target.value)} />
              </label>
            </div>

            <FilePicker files={files} onChange={setFiles} />

            {createErr && <div className="note bad">{createErr}</div>}

            <div className="row">
              <button type="button" className="btn" disabled={creating} onClick={() => setTab("tasks")}>
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                disabled={(!title.trim() && !detail.trim()) || creating}
                onClick={() => void submitNewTask(false)}
              >
                Save to Backlog
              </button>
              <button type="submit" className="btn primary" disabled={(!title.trim() && !detail.trim()) || creating}>
                {creating ? <><span className="spinner sm" /> Creating…</> : <><Px name="rocket" /> Assign &amp; Start</>}
              </button>
            </div>
          </form>
        )}

        {tab === "setup" && (
          <div className="desk-setup-pane">
            {setupErr && <div className="note bad">{setupErr}</div>}

            <div className="desk-setup-box">
              <label className="sect" htmlFor="desk-engine">AI Engine (Multica runtime)</label>
              <div className="desk-setup-row">
                <select
                  id="desk-engine"
                  className="input"
                  value={engineId}
                  disabled={savingEngine}
                  onChange={e => void saveEngine(e.target.value)}
                >
                  {!office.runtimes.some(r => r.id === engineId) && <option value="">— No engine —</option>}
                  {office.runtimes.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.name}{r.owner ? ` · ${r.owner}` : ""}{r.online ? " (online)" : " (offline)"}
                    </option>
                  ))}
                </select>
                {savingEngine && <span className="spinner sm" />}
              </div>
              <small className="hint">Switching engines updates this agent directly in Multica.</small>
            </div>

            <div className="desk-setup-box">
              <label className="sect" htmlFor="desk-squad-input">Squad room</label>
              <div className="desk-setup-row">
                <input
                  id="desk-squad-input"
                  className="input"
                  list="squad-room-names"
                  value={squad}
                  onChange={e => setSquad(e.target.value)}
                  maxLength={48}
                />
                <datalist id="squad-room-names">
                  {office.rooms.map(r => <option key={r.id} value={r.name} />)}
                </datalist>
                <button
                  type="button"
                  className="btn sm"
                  disabled={savingSquad || !squad.trim() || squad.trim() === desk.squad}
                  onClick={() => void saveSquad()}
                >
                  {savingSquad ? "Moving…" : "Move desk"}
                </button>
              </div>
            </div>

            <div className="desk-setup-box">
              <div className="desk-sect-head">
                <span className="sect">Character face</span>
                {savingFace && <span className="spinner sm" />}
              </div>
              <CharacterPicker value={face} onChange={next => void saveFace(next)} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
