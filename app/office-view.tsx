"use client";
import OfficeAmbience from "./office-ambience";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { Office, Desk, TaskView, RunView } from "@/lib/office";
import type { Building } from "./page";
import OfficeSwitch from "./office-switch";
import { MANAGER, isManager } from "@/lib/manager";
import { Px, PxText, type PxName } from "./pixel-icon";
import CharacterFace from "./character-face";
import type { DeskDrawerTab } from "./agent-desk-drawer";
import ReferenceOffice, { type ReviewTaskInfo } from "./reference-office";
import ThemeToggle from "./theme-toggle";
import type { LaunchedWorkflow } from "./orchestrator-modal";
import { LiveActivityFeed, QuickApprovalBar } from "./office-hud";
import { useOfficeSync } from "./use-office-sync";
import { useOfficePreferences } from "./use-office-preferences";
import { useOfficeWalks } from "./use-office-walks";
import {
  formatClockNow,
  type ActivityEvent,
  type DropZone,
  type FloorPropKind,
  type GoalStepDraft,
} from "@/lib/munder-workflows";
import { DEFAULT_SCHEDULE, type OfficeSchedule } from "@/lib/office-schedule";
import { readActiveChatId, writeActiveChatId } from "@/lib/chat-continuity";
import { harvestPhaseLabel } from "@/lib/harvest-theme";

const TaskPanel = dynamic(() => import("./task-panel"), { ssr: false });
const ChatPanel = dynamic(() => import("./chat-panel"), { ssr: false });
const CharacterPicker = dynamic(() => import("./character-picker"), { ssr: false });
const NewProject = dynamic(() => import("./new-project"), { ssr: false });
const AgentDeskDrawer = dynamic(() => import("./agent-desk-drawer"), { ssr: false });
const StandupModal = dynamic(() => import("./standup-modal"), { ssr: false });
const OrchestratorModal = dynamic(() => import("./orchestrator-modal"), { ssr: false });
const WorkflowHubModal = dynamic(() => import("./workflow-hub-modal"), { ssr: false });

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

function AttnRow({ t, onOpen, showWs }: { t: TaskView; onOpen: () => void; showWs?: boolean }) {
  return (
    <li>
      <button className="ar" onClick={onOpen}>
        <b><PxText text={t.title} />{t.questionCount ? <span className="pill p-review" style={{ marginLeft: 6 }}>{t.questionCount}Q</span> : null}</b>
        <small>{showWs ? `${t.wsName} · ` : ""}{t.assignee ?? "Unassigned"}{t.dueText ? ` · ${t.dueText}` : ""}{t.project ? ` · ${t.project}` : ""}</small>
      </button>
    </li>
  );
}

function notifyScreenReader(msg: string, setFallback: (v: string) => void) {
  if (!msg || typeof document === "undefined") return;
  const docAny = document as unknown as { ariaNotify?: (text: string) => void };
  if (typeof docAny.ariaNotify === "function") {
    docAny.ariaNotify(msg);
  } else {
    setFallback(msg);
  }
}

/** Isolated command bar so typing never re-renders OfficeView or ReferenceOffice. */
const OfficeComposer = memo(function OfficeComposer({
  workspaceId,
  desks,
  defaultAgentId,
  clearTick,
  suppressToasts = false,
  stackOffset = false,
  onDelegate,
  onMessageSent,
  onOpenChat,
}: {
  workspaceId: string;
  desks: Desk[];
  defaultAgentId: string;
  clearTick: number;
  suppressToasts?: boolean;
  stackOffset?: boolean;
  onDelegate: (goal: string) => void;
  onMessageSent: (agent: Desk, message: string, sessionId: string) => void;
  onOpenChat: (agent: Desk, sessionId: string) => void;
}) {
  const [compose, setCompose] = useState("");
  const [composeMode, setComposeMode] = useState<"message" | "delegate">("message");
  const [composeAgentId, setComposeAgentId] = useState("");
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<{ text: string; tone: "ok" | "error"; key: number; hasAction: boolean } | null>(null);
  const [sendPaused, setSendPaused] = useState(false);
  const [srLiveText, setSrLiveText] = useState("");
  const [lastSent, setLastSent] = useState<{ agent: Desk; sessionId: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const toastRegionRef = useRef<HTMLDivElement>(null);
  const toastElRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (clearTick > 0) setCompose("");
  }, [clearTick]);

  // Announce toast text via ariaNotify() (or pre-mounted live region fallback) without reading button labels
  useEffect(() => {
    if (!sendStatus) { setSendPaused(false); return; }
    const spoken = sendStatus.hasAction ? `${sendStatus.text}. Actions available` : sendStatus.text;
    notifyScreenReader(spoken, setSrLiveText);
  }, [sendStatus]);

  // Auto-dismiss after 4.2s (7s on error), pausing automatically while hovered or focused inside the toast
  useEffect(() => {
    if (!sendStatus || sendPaused) return;
    const ms = sendStatus.tone === "error" ? 7000 : 4200;
    const t = setTimeout(() => { setSendStatus(null); setLastSent(null); }, ms);
    return () => clearTimeout(t);
  }, [sendStatus, sendPaused]);

  // Sync top-layer popover coordinates to the .office container and promote via popover="manual" when supported
  useEffect(() => {
    const syncPos = () => {
      const stageEl = formRef.current?.parentElement;
      const regionEl = toastRegionRef.current;
      if (!stageEl || !regionEl) return;
      const r = stageEl.getBoundingClientRect();
      regionEl.style.setProperty("--toast-left", `${Math.max(12, Math.round(r.left + 16))}px`);
      regionEl.style.setProperty("--toast-bottom", `${Math.max(16, Math.round(window.innerHeight - r.bottom + 82))}px`);
    };
    syncPos();
    const stageEl = formRef.current?.parentElement;
    const ro = typeof ResizeObserver !== "undefined" && stageEl ? new ResizeObserver(syncPos) : null;
    if (ro && stageEl) ro.observe(stageEl);
    window.addEventListener("resize", syncPos);
    return () => { ro?.disconnect(); window.removeEventListener("resize", syncPos); };
  }, [sendStatus, suppressToasts]);

  useEffect(() => {
    const el = toastElRef.current;
    if (!el || typeof HTMLElement === "undefined" || !Object.hasOwn(HTMLElement.prototype, "popover")) return;
    const active = !!sendStatus && !suppressToasts;
    if (active) {
      if (el.getAttribute("popover") !== "manual") el.setAttribute("popover", "manual");
      try { if (!el.matches(":popover-open")) el.showPopover(); } catch { /* ignore */ }
    } else {
      try { if (el.matches(":popover-open")) el.hidePopover(); } catch { /* ignore */ }
    }
  }, [sendStatus, suppressToasts]);

  const dismissSendToast = useCallback((restoreFocus = false) => {
    const wasFocused = restoreFocus && !!toastElRef.current?.contains(document.activeElement);
    setSendStatus(null);
    setLastSent(null);
    if (wasFocused) {
      requestAnimationFrame(() => document.getElementById("office-ask")?.focus());
    }
  }, []);

  const target = desks.find(d => d.agentId === composeAgentId)
    ?? desks.find(d => d.agentId === defaultAgentId)
    ?? desks[0];

  async function askManager() {
    if (!target || !compose.trim() || sending) return;
    const message = compose.trim();
    setSending(true);
    setSendStatus(null);
    setLastSent(null);
    try {
      const resolveSession = async (skipSaved = false): Promise<string> => {
        if (!skipSaved) {
          const saved = readActiveChatId(workspaceId, target.agentId);
          if (saved) return saved;
        }
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ws: workspaceId, agentId: target.agentId, title: message.slice(0, 60), reuseLatest: true }),
        });
        const data = await response.json();
        if (!response.ok || data.error || !data.id) throw new Error(data.error || "Could not start conversation.");
        writeActiveChatId(workspaceId, target.agentId, data.id);
        return data.id as string;
      };

      let id = await resolveSession(false);
      let response = await fetch(`/api/chat/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ws: workspaceId, text: message, files: [] }),
      });
      if (!response.ok && response.status >= 400 && response.status < 500) {
        // Saved session may have been archived/deleted; fall back cleanly to latest active or a new session.
        writeActiveChatId(workspaceId, target.agentId, null);
        id = await resolveSession(true);
        response = await fetch(`/api/chat/${encodeURIComponent(id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ws: workspaceId, text: message, files: [] }),
        });
      }
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "Message could not be sent.");
      writeActiveChatId(workspaceId, target.agentId, id);
      setCompose(current => current.trim() === message ? "" : current);
      setLastSent({ agent: target, sessionId: id });
      setSendStatus({ text: `Chat terkirim ke ${target.name} (bukan task)`, tone: "ok", key: Date.now(), hasAction: true });
      onMessageSent(target, message, id);
      window.dispatchEvent(new CustomEvent("kantor:letter", { detail: { agentId: target.agentId } }));
    } catch (e) {
      setSendStatus({ text: e instanceof Error ? e.message : String(e), tone: "error", key: Date.now(), hasAction: false });
    } finally {
      setSending(false);
    }
  }

  function submitComposer(e: React.FormEvent) {
    e.preventDefault();
    if (!compose.trim()) return;
    if (composeMode === "delegate") {
      onDelegate(compose.trim());
      return;
    }
    void askManager();
  }

  return (
    <>
      <div className="toast-sr-wrap">
        {srLiveText && <p className="toast-sr-only">Screen reader announcements</p>}
        <div className="toast-sr-only" aria-live="polite" aria-atomic="true">{srLiveText}</div>
      </div>
      <div ref={toastRegionRef} role="region" aria-label="Composer notifications" className="office-toast-region">
        {!suppressToasts && sendStatus && (
          <div
            id="office-send-toast"
            ref={toastElRef}
            className={`composer-feedback office-toast-item is-${sendStatus.tone}${stackOffset ? " is-stacked" : ""}`}
            onMouseEnter={() => setSendPaused(true)}
            onMouseLeave={() => setSendPaused(false)}
            onFocus={() => setSendPaused(true)}
            onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSendPaused(false); }}
            onToggle={e => { if ((e as unknown as { newState?: string }).newState === "closed") dismissSendToast(true); }}
          >
            <span className={`toast-ic is-${sendStatus.tone}`} aria-hidden="true">
              <Px name={sendStatus.tone === "error" ? "alert" : "check"} />
            </span>
            <span className="toast-msg">{sendStatus.text}</span>
            {lastSent && sendStatus.tone === "ok" && (
              <button
                type="button"
                className="btn sm"
                onClick={() => { onOpenChat(lastSent.agent, lastSent.sessionId); dismissSendToast(false); }}
              >
                Buka percakapan →
              </button>
            )}
            <button
              type="button"
              className="toast-close"
              aria-label="Close notification"
              popoverTarget="office-send-toast"
              popoverTargetAction="hide"
              onClick={() => dismissSendToast(true)}
            >
              ×
            </button>
          </div>
        )}
      </div>
      <form ref={formRef} className="office-composer" onSubmit={submitComposer}>
        <div className="composer-mode" role="group" aria-label="Command bar mode">
          <button type="button" aria-pressed={composeMode === "message"} onClick={() => setComposeMode("message")} title="Ngobrol biasa — berlanjut di satu percakapan, bukan task">Chat</button>
          <button type="button" aria-pressed={composeMode === "delegate"} onClick={() => setComposeMode("delegate")} title="Buat & delegasikan task resmi ke papan Multica">Delegate Task</button>
        </div>
        {composeMode === "message" && (
          <select aria-label="Choose agent to chat with" value={target?.agentId ?? ""} onChange={e => setComposeAgentId(e.target.value)}>
            {desks.map(d => <option key={d.agentId} value={d.agentId}>{d.name}</option>)}
          </select>
        )}
        <label htmlFor="office-ask">{composeMode === "delegate" ? "Delegate goal" : "Chat"}</label>
        <input
          id="office-ask"
          value={compose}
          onChange={e => setCompose(e.target.value)}
          placeholder={
            !desks.length
              ? "Add an agent to start collaborating"
              : composeMode === "delegate"
                ? "Describe a goal to split & delegate into Multica tasks (use → to separate steps)…"
                : "Ngobrol dengan agent (masuk ke percakapan aktif, bukan task). Enter untuk kirim…"
          }
          disabled={!desks.length}
        />
        <button type="submit" disabled={!desks.length || sending || !compose.trim()}>
          {sending ? "Sending…" : composeMode === "delegate" ? "Plan & Delegate →" : "Chat →"}
        </button>
      </form>
    </>
  );
});

export default function OfficeView({ office, buildings, attention, people, seen, meId }: { office: Office; buildings: Building[]; attention: Office["attention"]; people: string[]; seen: Record<string, string>; meId?: string | null }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const refresh = useCallback(() => startRefresh(() => router.refresh()), [router]);
  const [openDeskId, setOpenDeskId] = useState<string | null>(null);
  const [deskPatches, setDeskPatches] = useState<Record<string, Partial<Desk>>>({});
  const [deskTab, setDeskTab] = useState<DeskDrawerTab>("tasks");
  const [drawerSession, setDrawerSession] = useState(0);
  const [openTask, setOpenTaskRaw] = useState<{ id: string; ws: string } | null>(null);
  const setOpenTask = (id: string | null, ws: string = office.workspaceId) => setOpenTaskRaw(id ? { id, ws } : null);
  const [chatTarget, setChatTarget] = useState<{ desk: Desk; sessionId?: string | null; startFresh?: boolean } | null>(null);
  const chatWith = chatTarget?.desk ?? null;
  const [openHuman, setOpenHuman] = useState<string | null>(null);
  const [memberFacePatches, setMemberFacePatches] = useState<Record<string, string>>({});
  const [humanAvatarOpen, setHumanAvatarOpen] = useState(false);
  const [savingHumanFace, setSavingHumanFace] = useState(false);
  const [humanFaceErr, setHumanFaceErr] = useState<string | null>(null);
  const patchedMembers = useMemo(
    () => office.members.map(m => (memberFacePatches[m.id] ? { ...m, face: memberFacePatches[m.id] } : m)),
    [office.members, memberFacePatches]
  );
  const activeHumanMember = useMemo(
    () => (openHuman ? patchedMembers.find(m => m.name === openHuman) ?? null : null),
    [openHuman, patchedMembers]
  );
  async function saveHumanFace(member: { id: string; name: string; face: string | null }, nextFace: string) {
    const prev = member.face;
    setMemberFacePatches(cur => ({ ...cur, [member.id]: nextFace }));
    setSavingHumanFace(true);
    setHumanFaceErr(null);
    try {
      const res = await fetch("/api/crew", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ws: office.workspaceId, memberId: member.id, face: nextFace }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Could not save avatar.");
      setToast(`${member.name}'s avatar updated.`);
      refresh();
    } catch (e) {
      if (prev) setMemberFacePatches(cur => ({ ...cur, [member.id]: prev }));
      else setMemberFacePatches(cur => { const next = { ...cur }; delete next[member.id]; return next; });
      setHumanFaceErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingHumanFace(false);
    }
  }
  const [draft, setDraft] = useState("");
  const [person, setPerson] = useState<string>("All");
  const [toast, setToast] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState<string | null>(null);
  const [newProject, setNewProject] = useState(false);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState("all");
  const [composerClearTick, setComposerClearTick] = useState(0);
  const [chatPrompt, setChatPrompt] = useState("");
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [codexOpen, setCodexOpen] = useState(false);
  const codexWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!codexOpen) return;
    const onDown = (e: MouseEvent) => {
      if (codexWrapRef.current && !codexWrapRef.current.contains(e.target as Node)) setCodexOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCodexOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [codexOpen]);
  const [standupOpen, setStandupOpen] = useState(false);
  const [standupFocusId, setStandupFocusId] = useState<string | null>(null);
  const [coffeeTick, setCoffeeTick] = useState(0);
  const [feedOpen, setFeedOpen] = useState(false);
  const [hubTab, setHubTab] = useState<"chains" | "metrics" | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [attnScope, setAttnScope] = useState<"current" | "all">("current");
  const [allAttn, setAllAttn] = useState<{ total: number; attention: Office["attention"] } | null>(null);
  const [loadingAllAttn, setLoadingAllAttn] = useState(false);
  const [schedule, setSchedule] = useState<OfficeSchedule>(() => office.schedule ?? DEFAULT_SCHEDULE);
  const [autoHealStuck, setAutoHealStuck] = useState<boolean>(!!office.autoHealStuck);
  const [savingSched, setSavingSched] = useState(false);
  const [orchDraft, setOrchDraft] = useState<{ goal: string; heading?: string; steps?: GoalStepDraft[] } | null>(null);
  const {
    harvestLighting,
    setHarvestLighting,
    harvestPhase,
    handoverStyle,
    setHandoverStyle,
    reviewStyle,
    setReviewStyle,
    clockStatus,
    lunchHour,
  } = useOfficePreferences({
    timeZone: office.timeZone,
    switchOpen: office.switchOpen,
    workCalendar: office.workCalendar,
  });
  useEffect(() => {
    setSchedule(office.schedule ?? DEFAULT_SCHEDULE);
    setAutoHealStuck(!!office.autoHealStuck);
  }, [office.workspaceId, office.schedule, office.autoHealStuck]);
  const wsSlug = buildings.find(b => b.id === office.workspaceId)?.slug ?? office.workspaceId;
  const logEvent = useCallback((ev: Omit<ActivityEvent, "id" | "at">, persist = true) => {
    setActivity(cur => [{ ...ev, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: formatClockNow() }, ...cur].slice(0, 40));
    if (persist) {
      fetch("/api/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ws: ev.ws ?? office.workspaceId, kind: ev.kind, title: ev.title, detail: ev.detail, agentId: ev.agentId, issueId: ev.issueId }),
      }).catch(() => {});
    }
  }, [office.workspaceId]);
  // Hydrate persistent activity feed on workspace switch or refresh.
  useEffect(() => {
    let alive = true;
    fetch(`/api/activity?ws=${encodeURIComponent(office.workspaceId)}&limit=40`)
      .then(r => r.json())
      .then(j => { if (alive && Array.isArray(j.events)) setActivity(j.events); })
      .catch(() => {});
    return () => { alive = false; };
  }, [office.workspaceId, office.updatedAt]);
  // Cross-workspace Unified Attention Hub loader
  useEffect(() => {
    if (!attentionOpen || attnScope !== "all") return;
    let alive = true;
    setLoadingAllAttn(true);
    fetch("/api/workspaces/attention")
      .then(r => r.json())
      .then(j => { if (alive && j.attention) setAllAttn({ total: j.total ?? 0, attention: j.attention }); })
      .catch(() => {})
      .finally(() => { if (alive) setLoadingAllAttn(false); });
    return () => { alive = false; };
  }, [attentionOpen, attnScope, office.updatedAt]);
  async function saveOfficeSchedule(next: OfficeSchedule, nextHeal: boolean) {
    setSavingSched(true);
    try {
      const r = await fetch("/api/office/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ws: office.workspaceId, schedule: next, autoHealStuck: nextHeal }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || "Could not save schedule.");
      setSchedule(j.schedule);
      setAutoHealStuck(!!j.autoHealStuck);
      setToast(j.schedule.enabled ? `Auto schedule saved (${j.schedule.openTime}–${j.schedule.closeTime}).` : "Auto office schedule disabled.");
    } catch (e) {
      setToast("Schedule error: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingSched(false);
    }
  }
  const activeWork = office.rooms.some(r => r.desks.some(d => d.state === "working")) || office.idleDesks.some(d => d.state === "working");
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
  const [toastPaused, setToastPaused] = useState(false);
  useEffect(() => {
    if (!toast) { setToastPaused(false); return; }
  }, [toast]);
  useEffect(() => {
    if (!toast || toastPaused) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast, toastPaused]);

  // Local real-time SSE stream (<50ms local push) with automatic visibility sleep & /api/office/sync fallback
  const { liveConnected } = useOfficeSync(office.workspaceId, refresh);
  const allDesks = useMemo(() => [...office.rooms.flatMap(r => r.desks), ...office.idleDesks], [office.rooms, office.idleDesks]);
  const uniqueDesks = useMemo(() => [...new Map(allDesks.map(d => [d.agentId, d])).values()].map(d => (deskPatches[d.agentId] ? { ...d, ...deskPatches[d.agentId] } : d)), [allDesks, deskPatches]);
  useEffect(() => { setDeskPatches({}); setMemberFacePatches({}); }, [office]);
  const resetRoom = useCallback(() => setRoomId("all"), []);
  const {
    walks,
    ownerName,
    ownerActorId,
    nameOf,
    startWalks,
    flowNotice,
    setFlowNotice,
    setFlowPaused,
    previewStep,
    setPreviewStep,
    handleFloorDone,
    handleFloorDelivered,
  } = useOfficeWalks({
    office,
    allDesks,
    uniqueDesks,
    seen,
    people,
    meId,
    handoverStyle,
    onResetRoom: resetRoom,
    logEvent,
  });
  const openDesk = useMemo(() => {
    if (!openDeskId) return null;
    return uniqueDesks.find(d => d.agentId === openDeskId) ?? null;
  }, [openDeskId, uniqueDesks]);
  const openAgentDrawer = useCallback((agentId: string, tab: DeskDrawerTab = "tasks", nextDraft = "") => {
    setOpenHuman(null);
    setDeskTab(tab);
    setDraft(nextDraft);
    setDrawerSession(n => n + 1);
    setOpenDeskId(agentId);
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (openTask) setOpenTask(null);
        else if (hubTab) setHubTab(null);
        else if (newProject) setNewProject(false);
        else if (orchDraft) setOrchDraft(null);
        else if (standupOpen) { setStandupOpen(false); setStandupFocusId(null); }
        else if (openDeskId || openHuman) { setOpenDeskId(null); setOpenHuman(null); }
        else if (attentionOpen) setAttentionOpen(false);
        else if (controlsOpen) setControlsOpen(false);
        else if (feedOpen) setFeedOpen(false);
        else if (previewStep !== null) setPreviewStep(null);
      }
    };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [openTask, hubTab, newProject, orchDraft, standupOpen, openDeskId, openHuman, attentionOpen, controlsOpen, feedOpen, previewStep, setPreviewStep]);

  const a = attention;
  const human = useMemo(() => (person === "All" ? a.human : a.human.filter(t => t.assignee === person)), [a.human, person]);
  const openT = (t: { id: string; ws: string }) => { setAttentionOpen(false); setOpenTask(t.id, t.ws); };
  const total = a.overdue.length + a.human.length + a.review.length + a.failed.length;
  const runs: RunView[] = openDesk ? office.agentsDetail[openDesk.agentId]?.runs ?? [] : [];
  const allTasks: TaskView[] = openDesk ? office.agentsDetail[openDesk.agentId]?.tasks ?? [] : [];
  const closeAll = () => { setOpenTask(null); setOpenDeskId(null); setOpenHuman(null); setChatTarget(null); };
  const visibleRooms = useMemo(() => {
    const rooms = roomId === "all" ? office.rooms : office.rooms.filter(r => r.id === roomId);
    return rooms.map(r => ({
      ...r,
      desks: r.desks.map(d => (deskPatches[d.agentId] ? { ...d, ...deskPatches[d.agentId] } : d)),
    }));
  }, [office.rooms, roomId, deskPatches]);
  const meetingAgent = uniqueDesks.find(d => /meeting|secretary/i.test(`${d.name} ${d.description}`)) ?? uniqueDesks.find(d => isManager(d.name)) ?? uniqueDesks[0];
  const mika = allDesks.find(d => isManager(d.name));
  const floorDesks = useMemo(() => (roomId.startsWith("squad:") ? visibleRooms.flatMap(r => r.desks) : uniqueDesks), [roomId, visibleRooms, uniqueDesks]);
  const ownerIdStable = useMemo(() => patchedMembers.find(m => m.id === meId)?.id ?? patchedMembers[0]?.id ?? null, [patchedMembers, meId]);
  const handleFloorDesk = useCallback((d: Desk) => openAgentDrawer(d.agentId, "tasks"), [openAgentDrawer]);
  const handleFloorHuman = useCallback((name: string) => { setOpenHuman(name); setHumanAvatarOpen(false); setHumanFaceErr(null); setOpenDeskId(null); }, []);
  const handleFloorOpenTask = useCallback((id: string, ws: string) => setOpenTaskRaw({ id, ws }), []);
  const runtimeSummary = useMemo(() => {
    const groups = new Map<string, Office["runtimes"]>();
    for (const runtime of office.runtimes) groups.set(runtime.provider, [...(groups.get(runtime.provider) ?? []), runtime]);
    return [...groups.entries()].sort(([, a], [, b]) => {
      const aOn = a.filter(r => r.online).length;
      const bOn = b.filter(r => r.online).length;
      return bOn - aOn || b.length - a.length;
    });
  }, [office.runtimes]);
  useEffect(() => {
    const f = (event: Event) => { const id = (event as CustomEvent<{ agentId: string }>).detail?.agentId; if (id && uniqueDesks.some(d => d.agentId === id)) openAgentDrawer(id, "tasks"); };
    const openChat = (event: Event) => {
      const detail = (event as CustomEvent<{ agentId: string; sessionId?: string | null }>).detail;
      const target = detail?.agentId ? uniqueDesks.find(d => d.agentId === detail.agentId) : null;
      if (target) { setChatPrompt(""); setChatTarget({ desk: target, sessionId: detail?.sessionId ?? null }); }
    };
    addEventListener("kantor:desk", f);
    addEventListener("kantor:chat", openChat);
    return () => {
      removeEventListener("kantor:desk", f);
      removeEventListener("kantor:chat", openChat);
    };
  }, [uniqueDesks, openAgentDrawer]);

  const officeRef = useRef<HTMLElement>(null);

  const reviewTasksByAgent = useMemo(() => {
    const out: Record<string, ReviewTaskInfo> = {};
    for (const t of a.review) {
      const desk = uniqueDesks.find(d => d.name === t.assignee);
      if (desk && !out[desk.agentId]) {
        out[desk.agentId] = { id: t.id, ws: t.ws, title: t.title, questionCount: t.questionCount };
      }
    }
    return out;
  }, [a.review, uniqueDesks]);

  const cleared = [
    !a.overdue.length && "nothing late",
    !a.human.length && "no to-dos",
    !a.review.length && "nothing to review",
    !a.failed.length && "no failures",
  ].filter(Boolean) as string[];
  const handleComposerDelegate = useCallback((goal: string) => setOrchDraft({ goal }), []);
  const handleComposerMessageSent = useCallback((target: Desk, message: string, _sessionId: string) => {
    logEvent({ kind: "chat", title: `Chat → ${target.name}`, detail: message.slice(0, 80), agentId: target.agentId });
  }, [logEvent]);
  const handleComposerOpenChat = useCallback((target: Desk, sessionId: string) => {
    setOpenDeskId(null);
    setOpenHuman(null);
    setChatPrompt("");
    setChatTarget({ desk: target, sessionId, startFresh: false });
  }, []);

  const standupParticipants = useMemo(() => {
    if (!standupOpen) return [];
    const base = uniqueDesks.slice(0, 8);
    if (standupFocusId && !base.some(d => d.agentId === standupFocusId)) {
      const focused = uniqueDesks.find(d => d.agentId === standupFocusId);
      return focused ? [focused, ...base.slice(0, 7)] : base;
    }
    return base;
  }, [standupOpen, standupFocusId, uniqueDesks]);

  const huddleIds = useMemo(() => standupParticipants.map(d => d.agentId), [standupParticipants]);

  const openStandup = useCallback((focusAgentId?: string) => {
    setControlsOpen(false);
    setAttentionOpen(false);
    setStandupFocusId(focusAgentId ?? null);
    setStandupOpen(true);
    const focusName = focusAgentId ? uniqueDesks.find(d => d.agentId === focusAgentId)?.name : null;
    logEvent({
      kind: "standup",
      title: focusName ? `Standup huddle called with ${focusName}` : "Team Standup huddle started",
      detail: `${Math.min(8, uniqueDesks.length)} agents gathering in the meeting area`,
      agentId: focusAgentId,
    });
  }, [uniqueDesks, logEvent]);

  const handlePropClick = useCallback((prop: FloorPropKind) => {
    if (prop === "board") {
      router.push(`/papan?ws=${encodeURIComponent(wsSlug)}`);
    } else if (prop === "server") {
      setAttentionOpen(false);
      setControlsOpen(true);
    } else if (prop === "coffee") {
      setCoffeeTick(n => n + 1);
      logEvent({ kind: "coffee", title: "Coffee bar break", detail: "Free agents walked over for a quick cup" });
    } else if (prop === "meeting") {
      openStandup();
    }
  }, [router, wsSlug, logEvent, openStandup]);

  const handleDropAgent = useCallback((dragged: Desk, zone: DropZone) => {
    if (zone.kind === "desk") {
      const target = uniqueDesks.find(d => d.agentId === zone.agentId);
      if (!target) return;
      startWalks([{ from: dragged.agentId, to: target.agentId, title: "Task handoff", fromName: dragged.name, toName: target.name }]);
      logEvent({ kind: "drag", title: `Handoff: ${dragged.name} → ${target.name}`, detail: "Dropped onto desk to delegate follow-up", agentId: target.agentId });
      setOrchDraft({
        goal: `Handoff from ${dragged.name} to ${target.name}`,
        heading: `Hand off from ${dragged.name} to ${target.name}`,
        steps: [{
          id: "handoff-1",
          title: `Follow up on ${dragged.name}'s work`,
          detail: `Handed off from ${dragged.name} (${dragged.bubble}). Please continue or review from here.`,
          agentId: target.agentId,
        }],
      });
    } else if (zone.kind === "meeting") {
      openStandup(dragged.agentId);
    } else if (zone.kind === "coffee") {
      logEvent({ kind: "coffee", title: `${dragged.name} took a coffee break`, detail: "Dropped at the coffee bar", agentId: dragged.agentId });
      setToast(`${dragged.name} headed to the coffee bar ☕`);
    } else if (zone.kind === "board") {
      router.push(`/papan?ws=${encodeURIComponent(wsSlug)}`);
    } else if (zone.kind === "server") {
      setControlsOpen(true);
    } else if (zone.kind === "human") {
      setOpenHuman(zone.name);
      logEvent({ kind: "drag", title: `${dragged.name} checked in with ${zone.name}`, agentId: dragged.agentId });
    } else {
      logEvent({ kind: "drag", title: `${dragged.name} walked back to desk`, agentId: dragged.agentId });
    }
  }, [uniqueDesks, startWalks, logEvent, openStandup, router, wsSlug]);

  const handleQuickApprove = useCallback(async (t: TaskView) => {
    const r = await fetch(`/api/task/${t.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ws: t.ws, action: "approve" }),
    });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || "Could not approve task.");
    const agent = uniqueDesks.find(d => d.name === t.assignee);
    if (agent && ownerActorId) {
      window.dispatchEvent(new CustomEvent("kantor:dialog", {
        detail: { fromId: ownerActorId, toId: agent.agentId, fromName: ownerName ?? "You", toName: agent.name, title: t.title, kind: "approve" },
      }));
    } else if (agent) {
      window.dispatchEvent(new CustomEvent("kantor:speech", {
        detail: { actorId: agent.agentId, tone: "approved", badge: "Selesai", text: "Siap, terima kasih! 🙌", pixelKind: "heart", ms: 3400 },
      }));
    }
    logEvent({ kind: "approve", title: `Approved: ${t.title}`, detail: t.assignee ?? undefined, agentId: agent?.agentId, issueId: t.id, ws: t.ws }, false);
    setToast(`Approved "${t.title}"`);
    refresh();
  }, [uniqueDesks, ownerActorId, ownerName, logEvent, refresh]);

  const handleQuickRevise = useCallback(async (t: TaskView, feedback: string) => {
    const r = await fetch(`/api/task/${t.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ws: t.ws, action: "revise", text: feedback }),
    });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || "Could not send revision.");
    const agent = uniqueDesks.find(d => d.name === t.assignee);
    if (agent) {
      if (ownerActorId) {
        startWalks([{ from: ownerActorId, to: agent.agentId, title: t.title, fromName: ownerName ?? "You", toName: agent.name, kind: "revise" }]);
      } else {
        window.dispatchEvent(new CustomEvent("kantor:speech", {
          detail: { actorId: agent.agentId, tone: "revise", badge: "Revisi", text: "Oke, langsung saya perbaiki! ✎", pixelKind: "mail", ms: 3200 },
        }));
      }
    }
    logEvent({ kind: "revise", title: `Revision sent: ${t.title}`, detail: feedback, agentId: agent?.agentId, issueId: t.id, ws: t.ws }, false);
    setToast(`Sent revision notes to ${t.assignee ?? "agent"}`);
    refresh();
  }, [uniqueDesks, ownerActorId, ownerName, startWalks, logEvent, refresh]);

  const handleWorkflowLaunched = useCallback((res: LaunchedWorkflow) => {
    setOrchDraft(null);
    setComposerClearTick(n => n + 1);
    const sourceId = mika?.agentId ?? ownerActorId;
    const sourceName = mika?.name ?? ownerName ?? "You";
    if (sourceId) {
      const seenAgents = new Set<string>();
      res.created.forEach((item, idx) => {
        if (item.agentId === sourceId || seenAgents.has(item.agentId)) return;
        seenAgents.add(item.agentId);
        const dest = uniqueDesks.find(d => d.agentId === item.agentId);
        if (!dest) return;
        setTimeout(() => {
          startWalks([{ from: sourceId, to: dest.agentId, title: item.title, fromName: sourceName, toName: dest.name }]);
        }, idx * 450);
      });
    }
    if (res.created[0]) {
      window.dispatchEvent(new CustomEvent("kantor:letter", { detail: { agentId: res.created[0].agentId } }));
    }
    logEvent({
      kind: "delegate",
      title: `Delegated ${res.created.length} task${res.created.length === 1 ? "" : "s"} (${res.mode})`,
      detail: res.goal,
      agentId: res.created[0]?.agentId,
      issueId: res.created[0]?.id,
      ws: office.workspaceId,
    }, false);
    setToast(
      res.parked
        ? `Delegated ${res.created.length} task(s). Parked until the office opens.`
        : `Delegated ${res.created.length} task(s) in ${res.mode === "staged" ? "staged DAG" : res.mode === "chain" ? "sequential chain" : "parallel"} mode!`
    );
    refresh();
  }, [mika, ownerActorId, ownerName, uniqueDesks, startWalks, logEvent, office.workspaceId, refresh]);

  return (
    <>
      <header className="top office-top">
        <div className="wrap hbar">
          <button type="button" className="office-nav-button" onClick={() => { setControlsOpen(false); setAttentionOpen(false); window.dispatchEvent(new Event("kantor:nav-toggle")); }} aria-label="Toggle navigation" title="Navigation">☰</button>
          <div className="brand">
            <h1>{office.workspace}</h1>
            <span className={`office-live ${office.switchOpen && clockStatus.inWorkHours ? "is-open" : "is-closed"}`} title={clockStatus.label}>
              <i />{!office.switchOpen ? "Office closed" : clockStatus.shortLabel}
            </span>
          </div>
          {(() => {
            const cq = office.codexQuota;
            const rem5h = cq ? cq.remaining5h : (office.open ? 100 : 0);
            const remWk = cq ? cq.remainingWeekly : rem5h;
            const used5h = Math.max(0, Math.min(100, 100 - rem5h));
            const usedWk = Math.max(0, Math.min(100, 100 - remWk));
            const toneOf = (used: number, online = true) =>
              !online ? "is-off" : used >= 85 ? "is-low" : used >= 60 ? "is-warn" : "is-ok";
            const tone5h = toneOf(used5h, !!cq?.online || !cq);
            const toneWk = toneOf(usedWk, !!cq?.online || !cq);
            const overallTone = toneOf(Math.max(used5h, cq ? usedWk : 0), cq ? cq.online : office.open);
            const barVal5h = used5h > 0 ? Math.max(4, used5h) : 0;
            const barValWk = usedWk > 0 ? Math.max(4, usedWk) : 0;
            const tipParts = [
              `Codex ${cq?.planType ? `(${cq.planType.toUpperCase()})` : ""}`.trim(),
              `5h terpakai: ${used5h}% (${rem5h}% tersisa)${cq?.reset5hAt ? ` · reset ${cq.reset5hAt}` : ""}`,
              cq ? `7d terpakai: ${usedWk}% (${remWk}% tersisa)${cq.resetWeeklyAt ? ` · reset ${cq.resetWeeklyAt}` : ""}` : null,
              cq?.creditsBalance ? `Extra credits: ${cq.creditsBalance}` : null,
              cq?.updatedAt ? `Synced ${cq.updatedAt}` : null,
            ].filter(Boolean);
            return (
              <div className="header-engines" ref={codexWrapRef}>
                <button
                  type="button"
                  className={`codex-meter ${overallTone}`}
                  title={tipParts.join(" • ")}
                  aria-expanded={codexOpen}
                  aria-label={`Codex credit terpakai: 5 jam ${used5h} persen${cq ? `, 7 hari ${usedWk} persen` : ""}`}
                  onClick={() => {
                    setControlsOpen(false);
                    setAttentionOpen(false);
                    setCodexOpen(v => !v);
                  }}
                >
                  <span className={`codex-dot ${overallTone}`} aria-hidden="true" />
                  <b>Codex</b>
                  <span className="codex-win">
                    <small className="codex-pct">{`5h ${used5h}%`}</small>
                    <progress
                      className={`codex-progress ${tone5h}`}
                      max={100}
                      value={barVal5h}
                      aria-label={`5-hour credit used ${used5h}%`}
                    />
                  </span>
                  {cq && (
                    <span className="codex-win is-wk">
                      <small className={`codex-wk ${toneWk}`}>{`7d ${usedWk}%`}</small>
                      <progress
                        className={`codex-progress is-sm ${toneWk}`}
                        max={100}
                        value={barValWk}
                        aria-label={`7-day credit used ${usedWk}%`}
                      />
                    </span>
                  )}
                  <small className="codex-used-tag">terpakai</small>
                </button>
                {codexOpen && (
                  <div className="codex-popover" role="region" aria-label="Detail penggunaan credit Codex">
                    <div className="codex-pop-head">
                      <div>
                        <b>Codex Credit Usage</b>
                        {cq?.planType && <span className="codex-plan-pill">{cq.planType.toUpperCase()}</span>}
                      </div>
                      <button type="button" className="codex-pop-close" onClick={() => setCodexOpen(false)} aria-label="Tutup detail credit">×</button>
                    </div>

                    <div className="codex-pop-row">
                      <div className="codex-pop-labels">
                        <span>5-Hour Window</span>
                        <strong>{used5h}% terpakai <small>({rem5h}% sisa)</small></strong>
                      </div>
                      <progress
                        className={`codex-progress is-lg ${tone5h}`}
                        max={100}
                        value={barVal5h}
                        aria-label={`5-hour credit terpakai ${used5h}%`}
                      />
                      <small className="codex-pop-meta">
                        {cq?.reset5hAt ? `Reset otomatis pukul ${cq.reset5hAt}` : "Kuota bergulir 5 jam"}
                      </small>
                    </div>

                    {cq && (
                      <div className="codex-pop-row">
                        <div className="codex-pop-labels">
                          <span>7-Day Weekly</span>
                          <strong>{usedWk}% terpakai <small>({remWk}% sisa)</small></strong>
                        </div>
                        <progress
                          className={`codex-progress is-lg ${toneWk}`}
                          max={100}
                          value={barValWk}
                          aria-label={`7-day weekly credit terpakai ${usedWk}%`}
                        />
                        <small className="codex-pop-meta">
                          {cq.resetWeeklyAt ? `Reset otomatis ${cq.resetWeeklyAt}` : "Kuota bergulir 7 hari"}
                        </small>
                      </div>
                    )}

                    <div className="codex-pop-foot">
                      <span>{cq?.online ? `Runtime aktif (${cq.onlineCount}/${Math.max(1, cq.totalCount)})` : "Runtime offline"}</span>
                      <span>{cq?.creditsBalance ? `Extra: ${cq.creditsBalance}` : cq?.updatedAt ? `Sync ${cq.updatedAt}` : ""}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          <div className="office-top-actions">
            <button
              type="button"
              className="office-top-button"
              onClick={refresh}
              disabled={refreshing}
              title={`Last synced at ${office.updatedAt}${liveConnected ? " · Live SSE stream connected" : " · Delta sync active"}. Click to sync with Multica now.`}
            >
              <Px name="refresh" /> {refreshing ? "Syncing…" : liveConnected ? "Live" : "Sync"}
            </button>
            <OfficeAmbience open={office.switchOpen} timeZone={office.timeZone} calendar={office.workCalendar} activeWork={activeWork} />
            <button type="button" className="office-top-button" aria-label="Team Standup" aria-expanded={standupOpen} onClick={() => openStandup()}><Px name="team" /><span className="btn-label">Standup</span></button>
            <button type="button" className="office-top-button" aria-label="Workflows and Insights" onClick={() => { setControlsOpen(false); setAttentionOpen(false); setHubTab("chains"); }}><Px name="rocket" /><span className="btn-label">Workflows</span></button>
            <button type="button" className={`office-top-button${total > 0 ? " has-attn" : ""}`} aria-label={total > 0 ? `Attention (${total})` : "Attention"} onClick={() => { setControlsOpen(false); setAttentionOpen(v => !v); }} aria-expanded={attentionOpen}><Px name="bell" /><span className="btn-label">Attention</span>{total > 0 && <b>{total}</b>}</button>
            <button type="button" className="office-top-button" aria-label="New project" onClick={() => setNewProject(true)}><Px name="plus" /><span className="btn-label">Project</span></button>
            <button type="button" className="office-top-button" aria-label="Office controls" onClick={() => { setAttentionOpen(false); setControlsOpen(v => !v); }} aria-expanded={controlsOpen}><Px name="gear" /><span className="btn-label">Controls</span></button>
          </div>
          {controlsOpen && <div className="office-controls" role="region" aria-label="Office controls">
            <div className="office-controls-head"><b>Office controls</b><button onClick={() => setControlsOpen(false)} aria-label="Close controls">×</button></div>
            <div className="office-controls-row">
              <OfficeSwitch key={office.workspaceId + String(office.switchOpen)} ws={office.workspaceId} name={office.workspace} switchOpen={office.switchOpen} laptopOn={office.open} parked={office.parked} onDone={msg => { logEvent({ kind: "door", title: msg }, false); setToast(msg); refresh(); }} />
            </div>
            <details className="office-schedule-box">
              <summary>
                <span className="hlabel">Auto schedule &amp; watchdog</span>
                <small className="clock">{schedule.enabled ? `${schedule.openTime}–${schedule.closeTime}` : "Off"}</small>
              </summary>
              <div className="office-schedule-body">
                <label className="radio">
                  <input type="checkbox" checked={schedule.enabled} onChange={e => setSchedule(s => ({ ...s, enabled: e.target.checked }))} />
                  Auto open/close office ({office.timeZone})
                </label>
                {schedule.enabled && (
                  <div className="sched-times">
                    <label>Open <input type="time" className="input" value={schedule.openTime} onChange={e => setSchedule(s => ({ ...s, openTime: e.target.value }))} /></label>
                    <label>Close <input type="time" className="input" value={schedule.closeTime} onChange={e => setSchedule(s => ({ ...s, closeTime: e.target.value }))} /></label>
                  </div>
                )}
                <label className="radio">
                  <input type="checkbox" checked={autoHealStuck} onChange={e => setAutoHealStuck(e.target.checked)} />
                  Auto-restart stuck runs (&gt;60 min)
                </label>
                <button type="button" className="btn sm primary" disabled={savingSched} onClick={() => saveOfficeSchedule(schedule, autoHealStuck)}>
                  {savingSched ? "Saving…" : "Save automation"}
                </button>
              </div>
            </details>
            <div className="office-controls-theme">
              <div className="world-light-head">
                <span className="hlabel">Handover style</span>
                <small className="clock">{handoverStyle === "auto" ? "Walk + Bubble" : handoverStyle === "walk" ? "Walk to desk" : "2-way bubble"}</small>
              </div>
              <div className="world-light-seg" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }} role="group" aria-label="Handover interaction style">
                {(["auto", "walk", "bubble"] as const).map(st => (
                  <button key={st} type="button" className="theme-seg-btn" aria-pressed={handoverStyle === st} onClick={() => setHandoverStyle(st)}>
                    {st === "auto" ? "Auto" : st === "walk" ? "Walk" : "Bubble"}
                  </button>
                ))}
              </div>
            </div>
            <div className="office-controls-theme">
              <div className="world-light-head">
                <span className="hlabel">Human review style</span>
                <small className="clock">{reviewStyle === "auto" ? "Room + Bubble" : reviewStyle === "walk" ? "Visit owner" : "Desk bubble"}</small>
              </div>
              <div className="world-light-seg" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }} role="group" aria-label="Human review interaction style">
                {(["auto", "walk", "bubble"] as const).map(st => (
                  <button key={st} type="button" className="theme-seg-btn" aria-pressed={reviewStyle === st} onClick={() => setReviewStyle(st)}>
                    {st === "auto" ? "Auto" : st === "walk" ? "Visit" : "Bubble"}
                  </button>
                ))}
              </div>
            </div>
            <div className="office-controls-theme">
              <span className="hlabel">Appearance</span>
              <ThemeToggle variant="segmented" />
            </div>
            <div className="office-controls-theme">
              <div className="world-light-head">
                <span className="hlabel">Pelican sky</span>
                <small className="clock">{harvestPhaseLabel(harvestPhase)}</small>
              </div>
              <div className="world-light-seg" role="group" aria-label="Stardew Valley time-of-day lighting">
                {(["auto", "morning", "day", "sunset", "night"] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    className="theme-seg-btn"
                    aria-pressed={harvestLighting === mode}
                    onClick={() => setHarvestLighting(mode)}
                  >
                    {mode === "auto" ? "Auto" : mode === "morning" ? "Dawn" : mode === "day" ? "Day" : mode === "sunset" ? "Sunset" : "Night"}
                  </button>
                ))}
              </div>
            </div>
            <div className="runtime-strip" aria-label="Codex credit status">
              {office.codexQuota ? (() => {
                const used5 = Math.max(0, Math.min(100, 100 - office.codexQuota.remaining5h));
                const used7 = Math.max(0, Math.min(100, 100 - office.codexQuota.remainingWeekly));
                const t5 = !office.codexQuota.online ? "is-off" : used5 >= 85 ? "is-low" : used5 >= 60 ? "is-warn" : "is-ok";
                const t7 = !office.codexQuota.online ? "is-off" : used7 >= 85 ? "is-low" : used7 >= 60 ? "is-warn" : "is-ok";
                return (
                  <div className="runtime-credit-cards">
                    <div className="runtime-credit-card" title={`Codex 5h rolling window${office.codexQuota.reset5hAt ? ` · resets ${office.codexQuota.reset5hAt}` : ""}`}>
                      <div className="runtime-credit-top">
                        <span><i className={office.codexQuota.online ? "on" : ""} /> Codex 5h</span>
                        <b>{used5}% terpakai</b>
                      </div>
                      <progress className={`codex-progress is-lg ${t5}`} max={100} value={used5 > 0 ? Math.max(4, used5) : 0} aria-label={`Codex 5h used ${used5}%`} />
                      <small>{office.codexQuota.remaining5h}% sisa{office.codexQuota.reset5hAt ? ` · reset ${office.codexQuota.reset5hAt}` : ""}</small>
                    </div>
                    <div className="runtime-credit-card" title={`Codex 7-day quota${office.codexQuota.resetWeeklyAt ? ` · resets ${office.codexQuota.resetWeeklyAt}` : ""}`}>
                      <div className="runtime-credit-top">
                        <span><i className={office.codexQuota.remainingWeekly > 15 ? "on" : ""} /> Weekly 7d</span>
                        <b>{used7}% terpakai</b>
                      </div>
                      <progress className={`codex-progress is-lg ${t7}`} max={100} value={used7 > 0 ? Math.max(4, used7) : 0} aria-label={`Codex 7d used ${used7}%`} />
                      <small>{office.codexQuota.remainingWeekly}% sisa{office.codexQuota.resetWeeklyAt ? ` · reset ${office.codexQuota.resetWeeklyAt}` : ""}</small>
                    </div>
                  </div>
                );
              })() : (
                runtimeSummary.filter(([p]) => p === "codex").map(([provider, list]) => (
                  <span className="runtime-chip" key={provider} title={list.map(r => r.name).join(", ")}>
                    <i className={list.some(r => r.online) ? "on" : ""} />Codex {list.filter(r => r.online).length}/{list.length}
                  </span>
                ))
              )}
            </div>
            <div className="office-controls-foot"><span className="clock">{refreshing ? "Refreshing…" : `Updated ${office.updatedAt}`}</span></div>
            <div className="office-controls-hub-row">
              <button type="button" className="btn sm" onClick={() => { setControlsOpen(false); setHubTab("chains"); }}><Px name="play" /> Task Chains</button>
              <button type="button" className="btn sm" onClick={() => { setControlsOpen(false); setHubTab("metrics"); }}><Px name="sparkle" /> Insights</button>
            </div>
            <button className="office-preview-button" onClick={() => { setControlsOpen(false); setRoomId("all"); setPreviewStep(0); }}>▶ Preview workflow animation <small>Visual only; no Multica task changes</small></button>
          </div>}
        </div>
      </header>

      <main className="wrap office-home">
        <section className="office" aria-label="Office floor plan" ref={officeRef}>
          {office.alerts.length > 0 && <div className="office-alerts">{office.alerts.map(x => <div key={x} className="alert" role="alert"><Px name="alert" /> {x}</div>)}</div>}

          <ReferenceOffice
            desks={floorDesks}
            humans={patchedMembers}
            ownerId={ownerIdStable}
            officeOpen={office.switchOpen}
            officePhase={clockStatus.phase}
            phaseLabel={clockStatus.label}
            lunch={lunchHour}
            reviewStyle={reviewStyle}
            previewWorking={previewStep === 1}
            previewReviewId={previewStep === 2 ? (uniqueDesks[0]?.agentId ?? null) : null}
            huddleIds={huddleIds}
            coffeeTick={coffeeTick}
            reviewTasksByAgent={reviewTasksByAgent}
            floorTheme="harvest"
            harvestPhase={harvestPhase}
            paused={Boolean(openTask || chatWith || openDesk || openHuman || orchDraft || newProject || hubTab)}
            onDesk={handleFloorDesk}
            onHuman={handleFloorHuman}
            onMeeting={openStandup}
            onPropClick={handlePropClick}
            onDropAgent={handleDropAgent}
            onOpenTask={handleFloorOpenTask}
            walks={walks}
            onDone={handleFloorDone}
            onDelivered={handleFloorDelivered}
          />

          <div className="office-hud-layer">
            <LiveActivityFeed
              events={activity}
              open={feedOpen}
              onToggle={() => setFeedOpen(v => !v)}
              onSelectEvent={ev => {
                setFeedOpen(false);
                if (ev.issueId) { setOpenTask(ev.issueId, ev.ws ?? office.workspaceId); return; }
                if (ev.kind === "chat" && ev.agentId) {
                  const target = uniqueDesks.find(x => x.agentId === ev.agentId);
                  if (target) { setChatPrompt(""); setChatTarget({ desk: target }); return; }
                }
                if (ev.agentId) {
                  if (uniqueDesks.some(x => x.agentId === ev.agentId)) openAgentDrawer(ev.agentId, "tasks");
                }
              }}
            />
            <QuickApprovalBar
              items={a.review}
              onApprove={handleQuickApprove}
              onRevise={handleQuickRevise}
              onOpenTask={t => openT(t)}
            />
          </div>

          {previewStep !== null && <div className="workflow-preview" role="status"><div><b>Workflow preview</b><button onClick={() => setPreviewStep(null)} aria-label="Stop preview">×</button></div><ol>{["Assigned", "Working", "Handed over", "Approved"].map((label, i) => <li key={label} className={i === previewStep ? "active" : i < previewStep ? "done" : ""}>{label}</li>)}</ol><small>Visual preview only. No tasks changed.</small></div>}
          {flowNotice && previewStep === null && !(chatWith || openTask || newProject || standupOpen || orchDraft || hubTab) && (
            <div
              className="workflow-notice office-toast-item"
              role="status"
              onMouseEnter={() => setFlowPaused(true)}
              onMouseLeave={() => setFlowPaused(false)}
              onFocus={() => setFlowPaused(true)}
              onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFlowPaused(false); }}
            >
              <span className="toast-ic is-ok" aria-hidden="true"><Px name="check" /></span>
              <span className="toast-msg">{flowNotice}</span>
              <button type="button" className="toast-close" onClick={() => setFlowNotice("")} aria-label="Close notification">×</button>
            </div>
          )}

          <OfficeComposer
            workspaceId={office.workspaceId}
            desks={uniqueDesks}
            defaultAgentId={mika?.agentId ?? uniqueDesks[0]?.agentId ?? ""}
            clearTick={composerClearTick}
            suppressToasts={!!(chatWith || openTask || newProject || standupOpen || orchDraft || hubTab)}
            stackOffset={!!flowNotice && previewStep === null}
            onDelegate={handleComposerDelegate}
            onMessageSent={handleComposerMessageSent}
            onOpenChat={handleComposerOpenChat}
          />
        </section>

        {attentionOpen && <button className="office-attn-scrim" aria-label="Close attention panel" onClick={() => setAttentionOpen(false)} />}
        {attentionOpen && (() => {
          const activeAttn = attnScope === "all" && allAttn ? allAttn.attention : a;
          const activeTotal = attnScope === "all" && allAttn ? allAttn.total : total;
          const activeHuman = attnScope === "all" ? activeAttn.human : human;
          const showWs = attnScope === "all";
          return (
          <aside className="attn" aria-label="Needs attention">
          <div className="ah">
            <h2>Needs attention <span className="count">{activeTotal}</span></h2>
            <button className="office-attn-close" onClick={() => setAttentionOpen(false)} aria-label="Close attention">×</button>
            <p>{office.today}</p>
            {buildings.length > 1 && (
              <div className="tabs attn-scope-tabs" role="tablist" style={{ padding: 0, marginTop: 8 }}>
                <button type="button" className="tab" aria-pressed={attnScope === "current"} onClick={() => setAttnScope("current")}>This office ({total})</button>
                <button type="button" className="tab" aria-pressed={attnScope === "all"} onClick={() => setAttnScope("all")}>All offices{allAttn ? ` (${allAttn.total})` : ""}</button>
              </div>
            )}
          </div>
          <div className="scroll">
            {attnScope === "all" && loadingAllAttn && <div className="loading"><span className="spinner sm" /> Checking all offices…</div>}
            {activeTotal === 0 && !(attnScope === "all" && loadingAllAttn) && <p className="allclear"><Px name="party" /> All clear. Nothing needs you right now.</p>}
            {activeAttn.overdue.length > 0 && (
              <AttnGroup kind="late" icon="clock" title="Late & at risk" hint="past or close to the due date" count={activeAttn.overdue.length}>
                {activeAttn.overdue.map(t => <AttnRow key={`${t.ws}:${t.id}`} t={t} showWs={showWs} onOpen={() => openT(t)} />)}
              </AttnGroup>
            )}
            {activeAttn.human.length > 0 && (
              <AttnGroup kind="human" icon="person" title="To-dos for people" hint="steps only a person can do" count={activeHuman.length}
                extra={!showWs && people.length > 1 ? (
                  <div className="tabs">{["All", ...people].map(p => <button key={p} className="tab" aria-pressed={person === p} onClick={() => setPerson(p)}>{p}</button>)}</div>
                ) : undefined}>
                {activeHuman.map(t => <AttnRow key={`${t.ws}:${t.id}`} t={t} showWs={showWs} onOpen={() => openT(t)} />)}
              </AttnGroup>
            )}
            {activeAttn.review.length > 0 && (
              <AttnGroup kind="review" icon="eyes" title="Waiting for review" hint="agents finished or asked you something" count={activeAttn.review.length}>
                {activeAttn.review.map(t => <AttnRow key={`${t.ws}:${t.id}`} t={t} showWs={showWs} onOpen={() => openT(t)} />)}
              </AttnGroup>
            )}
            {activeAttn.failed.length > 0 && (
              <AttnGroup kind="fail" icon="failed" title="Failed" hint="last 7 days" count={activeAttn.failed.length}>
                {activeAttn.failed.map(f => (
                  <li key={`${f.ws}:${f.id}`} className="failrow">
                    <button className="ar" onClick={() => f.issueId && setOpenTask(f.issueId, f.ws)}>
                      <b>{f.issueTitle ?? "Untitled task"}</b><small>{showWs && "wsName" in f ? `${(f as RunView & { wsName?: string }).wsName} · ` : ""}{f.agent} · {f.error} · {f.when}</small>
                    </button>
                    {f.issueId && <button className="btn sm" disabled={rerunning === f.id} onClick={() => rerun(f)}>{rerunning === f.id ? "…" : <><Px name="refresh" /> Retry</>}</button>}
                  </li>
                ))}
              </AttnGroup>
            )}
            {!showWs && total > 0 && cleared.length > 0 && <p className="clearline"><Px name="check" /> {cleared.join(" · ")}</p>}
          </div>
        </aside>);
        })()}
      </main>

      {(openDesk || openTask || chatWith || openHuman) && <div className="scrim" onClick={closeAll} />}

      {openDesk && !openTask && !chatWith && (
        <AgentDeskDrawer
          key={`${openDesk.agentId}-${drawerSession}`}
          office={office}
          desk={openDesk}
          allDesks={uniqueDesks}
          tasks={allTasks}
          runs={runs}
          initialTab={deskTab}
          initialDraft={draft}
          preferredProjectId={createdProjectId}
          onClose={closeAll}
          onOpenTask={(id, ws) => setOpenTask(id, ws)}
          onOpenChat={(sessionId, startFresh) => {
            const target = openDesk;
            setOpenDeskId(null);
            setChatPrompt("");
            setChatTarget({ desk: target, sessionId: sessionId ?? null, startFresh: !!startFresh });
          }}
          onOpenNewProject={() => setNewProject(true)}
          onStartHuddle={() => {
            const id = openDesk.agentId;
            setOpenDeskId(null);
            openStandup(id);
          }}
          onStartHandoff={() => {
            const target = uniqueDesks.find(d => d.agentId !== openDesk.agentId);
            if (!target) return;
            const source = openDesk;
            setOpenDeskId(null);
            setOrchDraft({
              goal: `Handoff from ${source.name} to ${target.name}`,
              heading: `Hand off from ${source.name} to ${target.name}`,
              steps: [{
                id: "handoff-1",
                title: `Follow up on ${source.name}'s work`,
                detail: `Handed off from ${source.name} (${source.bubble}). Please continue or review from here.`,
                agentId: target.agentId,
              }],
            });
          }}
          onSendCoffee={() => {
            const target = openDesk;
            setOpenDeskId(null);
            window.dispatchEvent(new CustomEvent("kantor:coffee", { detail: { agentId: target.agentId } }));
            logEvent({ kind: "coffee", title: `${target.name} took a coffee break`, detail: "Sent from agent desk", agentId: target.agentId });
            setToast(`${target.name} headed to the coffee bar ☕`);
          }}
          onQuickApprove={handleQuickApprove}
          onRetryRun={rerun}
          onTaskAssigned={(task, targetDesk, startNow, fromAgentId) => {
            const fromKey = fromAgentId && fromAgentId !== targetDesk.agentId ? fromAgentId : ownerActorId;
            if (fromKey && fromKey !== targetDesk.agentId) {
              startWalks([{
                from: fromKey,
                to: targetDesk.agentId,
                title: task.title,
                fromName: fromAgentId ? nameOf(fromAgentId) : (ownerName ?? "You"),
                toName: targetDesk.name,
                kind: fromAgentId ? "handoff" : "assign",
              }]);
            }
            window.dispatchEvent(new CustomEvent("kantor:letter", { detail: { agentId: targetDesk.agentId } }));
            logEvent({
              kind: fromAgentId ? "handoff" : "delegate",
              title: `${fromAgentId ? "Reassigned" : "Assigned"} → ${targetDesk.name}`,
              detail: task.title,
              agentId: targetDesk.agentId,
              issueId: task.id,
              ws: task.ws,
            });
            setToast(
              startNow && !office.switchOpen
                ? `Assigned "${task.title}" to ${targetDesk.name} (parked until office opens)`
                : startNow
                  ? `Assigned "${task.title}" to ${targetDesk.name} — starting now`
                  : `Queued "${task.title}" for ${targetDesk.name}`
            );
            refresh();
          }}
          onTaskCreated={(id, title, now) => {
            const target = openDesk;
            if (ownerActorId) {
              startWalks([{
                from: ownerActorId,
                to: target.agentId,
                title,
                fromName: ownerName ?? "You",
                toName: target.name,
                kind: "assign",
              }]);
            }
            window.dispatchEvent(new CustomEvent("kantor:letter", { detail: { agentId: target.agentId } }));
            logEvent({
              kind: "delegate",
              title: `New task → ${target.name}`,
              detail: title,
              agentId: target.agentId,
              issueId: id,
              ws: office.workspaceId,
            });
            setToast(
              now && !office.switchOpen
                ? `Created "${title}" for ${target.name} (parked until office opens)`
                : now
                  ? `Created & assigned "${title}" to ${target.name}`
                  : `Saved "${title}" to ${target.name}'s backlog`
            );
            refresh();
          }}
          onDeskPatched={patch => {
            const id = openDesk.agentId;
            setDeskPatches(cur => ({ ...cur, [id]: { ...(cur[id] ?? {}), ...patch } }));
          }}
          onToast={msg => setToast(msg)}
          onRefresh={refresh}
        />
      )}

      {openHuman && !openTask && !chatWith && (
        <div className="drawer" role="dialog" aria-modal="true" aria-label={`${openHuman}'s desk`}>
          <div className="dhead">
            <button
              type="button"
              className="avatar avatar-edit-btn"
              title="Change avatar"
              aria-label={`Change ${openHuman}'s avatar`}
              aria-expanded={humanAvatarOpen}
              onClick={() => setHumanAvatarOpen(v => !v)}
            >
              <CharacterFace face={activeHumanMember?.face ?? null} size={44} shape="circle" />
              <span className="avatar-edit-badge" aria-hidden="true">✎</span>
            </button>
            <div className="meta">
              <h2>{openHuman}&apos;s desk</h2>
              <div className="role">{office.workspace}{activeHumanMember?.id === (patchedMembers.find(m => m.id === meId)?.id ?? patchedMembers[0]?.id) ? " · Founder / Owner" : " · Human member"}</div>
            </div>
            {activeHumanMember && (
              <button
                type="button"
                className={`btn sm${humanAvatarOpen ? " primary" : ""}`}
                aria-expanded={humanAvatarOpen}
                onClick={() => setHumanAvatarOpen(v => !v)}
              >
                {humanAvatarOpen ? "Done" : "Avatar"}
              </button>
            )}
            <button className="x" onClick={closeAll} aria-label="Close"><Px name="close" size="1em" /></button>
          </div>
          <div className="dbody">
            {humanAvatarOpen && activeHumanMember && (
              <div className="avatar-quick-tray">
                <div className="desk-sect-head">
                  <span className="sect">Choose avatar for {activeHumanMember.name}</span>
                  {savingHumanFace && <span className="spinner sm" />}
                </div>
                {humanFaceErr && <div className="note bad">{humanFaceErr}</div>}
                <CharacterPicker
                  value={activeHumanMember.face ?? "yusuf"}
                  onChange={next => void saveHumanFace(activeHumanMember, next)}
                />
              </div>
            )}
            {activeHumanMember?.id === (patchedMembers.find(m => m.id === meId)?.id ?? patchedMembers[0]?.id) && (
              <div className="owner-stroll-box">
                <div className="sect"><Px name="wave" /> Keliling kantor</div>
                <div className="owner-stroll-actions">
                  {(
                    [
                      { kind: "coffee", label: "☕ Coffee Bar" },
                      { kind: "agent", label: "💬 Sapa Agent" },
                      { kind: "pantry", label: "🍳 Pantry" },
                      { kind: "lounge", label: "🛋️ Lounge" },
                      { kind: "washroom", label: "🚻 Washroom" },
                      { kind: "board", label: "📋 Task Board" },
                    ] as const
                  ).map(act => (
                    <button
                      key={act.kind}
                      type="button"
                      className="btn sm"
                      onClick={() => {
                        setOpenHuman(null);
                        setTimeout(() => {
                          window.dispatchEvent(new CustomEvent("kantor:owner-stroll", { detail: { kind: act.kind } }));
                        }, 80);
                      }}
                    >
                      {act.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
        <ChatPanel
          key={`${chatWith.agentId}:${chatTarget?.sessionId ?? (chatTarget?.startFresh ? "fresh" : "resume")}`}
          ws={office.workspaceId}
          agent={{ id: chatWith.agentId, name: chatWith.name, emoji: chatWith.emoji, face: chatWith.face, role: chatWith.description }}
          isMika={isManager(chatWith.name)}
          projectId={null}
          laptopOn={office.open}
          initialPrompt={chatPrompt}
          initialSessionId={chatTarget?.sessionId ?? null}
          startFresh={chatTarget?.startFresh}
          onClose={() => { setChatTarget(null); setChatPrompt(""); }}
          onMakeTask={(detail, agentId) => { const d = allDesks.find(x => x.agentId === agentId) ?? chatWith; setChatTarget(null); openAgentDrawer(d.agentId, "create", detail); }}
        />
      )}
      {/* Floating button to chat with the office manager, like a help button on a website. */}
      {mika && !chatWith && !openDesk && !openTask && !openHuman && (
        <button className="mikafab" onClick={() => { setChatPrompt(""); setChatTarget({ desk: mika }); }} aria-label={`Chat with ${MANAGER}, the office manager`}>
          <span className="mf-av"><CharacterFace face={mika.face} size={38} shape="circle" /></span>
          <span className="mf-txt"><b>Ask {MANAGER}</b><small>ideas, tasks, new agents</small></span>
        </button>
      )}
      {newProject && <NewProject ws={office.workspaceId}
        people={[...patchedMembers.map(m => ({ kind: "member" as const, id: m.id, name: m.name, emoji: null, face: m.face })), ...[...new Map(allDesks.map(d => [d.agentId, d])).values()].map(d => ({ kind: "agent" as const, id: d.agentId, name: d.name, emoji: d.emoji, face: d.face }))]}
        onDone={id => { setNewProject(false); if (id) { setCreatedProjectId(id); setToast("Project created and synced with Multica."); refresh(); } }} />}
      {standupOpen && (
        <StandupModal
          desks={uniqueDesks}
          participants={standupParticipants}
          attention={a}
          managerName={meetingAgent?.name ?? MANAGER}
          onOpenTask={t => { setStandupOpen(false); setStandupFocusId(null); openT(t); }}
          onAskManager={prompt => {
            setStandupOpen(false);
            setStandupFocusId(null);
            if (meetingAgent) {
              setChatPrompt(prompt);
              setChatTarget({ desk: meetingAgent });
            }
          }}
          onClose={() => { setStandupOpen(false); setStandupFocusId(null); }}
        />
      )}
      {orchDraft && (
        <OrchestratorModal
          ws={office.workspaceId}
          initialGoal={orchDraft.goal}
          initialSteps={orchDraft.steps}
          heading={orchDraft.heading}
          desks={uniqueDesks}
          projects={office.projects}
          onLaunched={handleWorkflowLaunched}
          onClose={() => setOrchDraft(null)}
        />
      )}
      {hubTab && (
        <WorkflowHubModal
          ws={office.workspaceId}
          workspaceName={office.workspace}
          initialTab={hubTab}
          onOpenTask={(id, w) => setOpenTask(id, w)}
          onClose={() => setHubTab(null)}
        />
      )}
      {toast && (
        <div
          className="toast"
          role="status"
          onMouseEnter={() => setToastPaused(true)}
          onMouseLeave={() => setToastPaused(false)}
          onFocus={() => setToastPaused(true)}
          onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setToastPaused(false); }}
        >
          <span>{toast}</span>
          <button type="button" className="toast-dismiss-inline" onClick={() => setToast(null)} aria-label="Close notification">×</button>
        </div>
      )}
      {openTask && <TaskPanel id={openTask.id} ws={openTask.ws} onClose={() => setOpenTask(null)} onChanged={refresh} />}
    </>
  );
}
