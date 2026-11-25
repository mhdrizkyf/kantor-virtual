"use client";
import OfficeAmbience from "./office-ambience";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Office, Desk, TaskView, RunView } from "@/lib/office";
import TaskPanel from "./task-panel";
import type { Building } from "./page";
import OfficeSwitch from "./office-switch";

import ChatPanel, { MANAGER, isManager } from "./chat-panel";
import { Px, PxText, type PxName } from "./pixel-icon";
import CharacterFace from "./character-face";
import CharacterPicker from "./character-picker";
import { useHandoverDetector, type Handover } from "./handover";
import NewProject from "./new-project";
import { useVisiblePoll } from "./visible-poll";
import AgentDeskDrawer, { type DeskDrawerTab } from "./agent-desk-drawer";
import ReferenceOffice, { type OfficeWalk, type ReviewTaskInfo } from "./reference-office";
import ThemeToggle from "./theme-toggle";
import StandupModal from "./standup-modal";
import OrchestratorModal, { type LaunchedWorkflow } from "./orchestrator-modal";
import { LiveActivityFeed, QuickApprovalBar } from "./office-hud";
import { formatClockNow, type ActivityEvent, type DropZone, type FloorPropKind, type GoalStepDraft } from "@/lib/munder-workflows";
import { isLunchHour } from "@/lib/office-time";
import {
  HARVEST_LIGHTING_STORAGE_KEY,
  harvestPhaseLabel,
  parseHarvestLighting,
  resolveHarvestPhase,
  type HarvestLightingMode,
  type HarvestPhase,
} from "@/lib/harvest-theme";

const REFRESH_MS = 30_000;

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
  const [chatWith, setChatWith] = useState<Desk | null>(null);
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
  const [toastPaused, setToastPaused] = useState(false);
  const [srToastText, setSrToastText] = useState("");
  const announceToast = useCallback((msg: string) => {
    if (!msg || typeof document === "undefined") return;
    const docAny = document as unknown as { ariaNotify?: (text: string) => void };
    if (typeof docAny.ariaNotify === "function") {
      docAny.ariaNotify(msg);
    } else {
      setSrToastText(msg);
    }
  }, []);
  const [rerunning, setRerunning] = useState<string | null>(null);
  const [newProject, setNewProject] = useState(false);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState("all");
  const [compose, setCompose] = useState("");
  const [composeMode, setComposeMode] = useState<"message" | "delegate">("message");
  const [composeAgentId, setComposeAgentId] = useState("");
  const [chatPrompt, setChatPrompt] = useState("");
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [standupOpen, setStandupOpen] = useState(false);
  const [standupFocusId, setStandupFocusId] = useState<string | null>(null);
  const [coffeeTick, setCoffeeTick] = useState(0);
  const [feedOpen, setFeedOpen] = useState(false);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [orchDraft, setOrchDraft] = useState<{ goal: string; heading?: string; steps?: GoalStepDraft[] } | null>(null);
  const [previewStep, setPreviewStep] = useState<number | null>(null);
  const [flowNotice, setFlowNotice] = useState("");
  const [harvestLighting, setHarvestLightingState] = useState<HarvestLightingMode>("auto");
  const [harvestPhase, setHarvestPhase] = useState<HarvestPhase>("day");
  useEffect(() => {
    try {
      setHarvestLightingState(parseHarvestLighting(localStorage.getItem(HARVEST_LIGHTING_STORAGE_KEY)));
    } catch {
      // Ignore storage access failures in private browsing.
    }
  }, []);
  const setHarvestLighting = useCallback((next: HarvestLightingMode) => {
    setHarvestLightingState(next);
    try { localStorage.setItem(HARVEST_LIGHTING_STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);
  const wsSlug = buildings.find(b => b.id === office.workspaceId)?.slug ?? office.workspaceId;
  const logEvent = useCallback((ev: Omit<ActivityEvent, "id" | "at">) => {
    setActivity(cur => [{ ...ev, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: formatClockNow() }, ...cur].slice(0, 25));
  }, []);
  const activeWork = office.rooms.some(r => r.desks.some(d => d.state === "working")) || office.idleDesks.some(d => d.state === "working");
  const [lunchHour, setLunchHour] = useState(false);
  useEffect(() => {
    const update = () => {
      const now = new Date();
      setLunchHour(office.switchOpen && isLunchHour(office.timeZone, now, { ...office.workCalendar, activeWork }));
      setHarvestPhase(resolveHarvestPhase(harvestLighting, office.timeZone, office.switchOpen, now));
    };
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => { update(); timer = setTimeout(tick, 60_000 - Date.now() % 60_000 + 50); };
    tick();
    document.addEventListener("visibilitychange", update);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", update); };
  }, [office.timeZone, office.switchOpen, office.workCalendar, activeWork, harvestLighting]);
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
  useEffect(() => {
    if (!toast) { setToastPaused(false); return; }
    announceToast(toast);
  }, [toast, announceToast]);
  useEffect(() => {
    if (!toast || toastPaused) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast, toastPaused]);

  useVisiblePoll(refresh, REFRESH_MS);
  const allDesks = useMemo(() => [...office.rooms.flatMap(r => r.desks), ...office.idleDesks], [office.rooms, office.idleDesks]);
  const uniqueDesks = useMemo(() => [...new Map(allDesks.map(d => [d.agentId, d])).values()].map(d => (deskPatches[d.agentId] ? { ...d, ...deskPatches[d.agentId] } : d)), [allDesks, deskPatches]);
  useEffect(() => { setDeskPatches({}); setMemberFacePatches({}); }, [office]);
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
  }, [openTask, newProject, orchDraft, standupOpen, openDeskId, openHuman, attentionOpen, controlsOpen, feedOpen, previewStep]);

  const a = attention;
  const human = useMemo(() => (person === "All" ? a.human : a.human.filter(t => t.assignee === person)), [a.human, person]);
  const openT = (t: { id: string; ws: string }) => { setAttentionOpen(false); setOpenTask(t.id, t.ws); };
  const total = a.overdue.length + a.human.length + a.review.length + a.failed.length;
  const runs: RunView[] = openDesk ? office.agentsDetail[openDesk.agentId]?.runs ?? [] : [];
  const allTasks: TaskView[] = openDesk ? office.agentsDetail[openDesk.agentId]?.tasks ?? [] : [];
  const closeAll = () => { setOpenTask(null); setOpenDeskId(null); setOpenHuman(null); setChatWith(null); };
  const visibleRooms = useMemo(() => {
    const rooms = roomId === "all" ? office.rooms : office.rooms.filter(r => r.id === roomId);
    return rooms.map(r => ({
      ...r,
      desks: r.desks.map(d => (deskPatches[d.agentId] ? { ...d, ...deskPatches[d.agentId] } : d)),
    }));
  }, [office.rooms, roomId, deskPatches]);
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
    const f = (event: Event) => { const id = (event as CustomEvent<{ agentId: string }>).detail?.agentId; if (id && uniqueDesks.some(d => d.agentId === id)) openAgentDrawer(id, "tasks"); };
    const openChat = (event: Event) => {
      const id = (event as CustomEvent<{ agentId: string }>).detail?.agentId;
      const target = id ? uniqueDesks.find(d => d.agentId === id) : null;
      if (target) { setChatPrompt(""); setChatWith(target); }
    };
    addEventListener("kantor:desk", f);
    addEventListener("kantor:chat", openChat);
    return () => {
      removeEventListener("kantor:desk", f);
      removeEventListener("kantor:chat", openChat);
    };
  }, [uniqueDesks, openAgentDrawer]);

  // Agents walk over to hand work off.
  const officeRef = useRef<HTMLElement>(null);
  const [walks, setWalks] = useState<OfficeWalk[]>([]);
  const walkingIds = useMemo(() => new Set(walks.map(w => w.from)), [walks]);
  const here = (p: string) => !!seen[p] && Date.now() - Date.parse(seen[p]) < 5 * 60000;
  const reviewer = (ownerName && here(ownerName) ? ownerName : people.find(here)) ?? ownerName;
  const ownerActorId = useMemo(() => {
    const o = office.members.find(m => m.id === meId) ?? office.members[0];
    return o ? `person:${o.id}` : null;
  }, [office.members, meId]);
  const resolveActorKey = useCallback((k: string) => {
    if (!k.startsWith("person:")) return k;
    const raw = k.slice(7);
    const byId = office.members.find(m => m.id === raw);
    if (byId) return `person:${byId.id}`;
    const byName = office.members.find(m => m.name === raw);
    if (byName) return `person:${byName.id}`;
    return ownerActorId ?? k;
  }, [office.members, ownerActorId]);
  const nameOf = (k: string) => {
    if (!k.startsWith("person:")) return allDesks.find(d => d.agentId === k)?.name ?? "Agent";
    const raw = k.slice(7);
    return office.members.find(m => m.id === raw || m.name === raw)?.name ?? raw;
  };
  const startWalks = useCallback((hs: (Handover & { kind?: OfficeWalk["kind"] })[]) => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!hs.length) return;
    setRoomId("all");
    const resolved = hs.map(h => ({
      ...h,
      from: resolveActorKey(h.from),
      to: resolveActorKey(h.to),
      face: uniqueDesks.find(d => d.agentId === h.from)?.face ?? null,
      key: h.from + ":" + Date.now() + Math.random(),
    }));
    setWalks(cur => [...cur, ...resolved.filter(h => !cur.some(c => c.from === h.from))]);
    setFlowNotice(resolved.map(h => `${h.fromName} → ${h.toName}: ${h.title}`).join(" · "));
    resolved.forEach(h => logEvent({ kind: "handoff", title: `${h.fromName} → ${h.toName}`, detail: h.title, agentId: h.to.startsWith("person:") ? undefined : h.to }));
  }, [uniqueDesks, logEvent, resolveActorKey]);
  useHandoverDetector(office, reviewer, nameOf, startWalks);
  useEffect(() => {
    const f = (e: Event) => { const d = (e as CustomEvent).detail; startWalks([{ ...d, fromName: nameOf(d.from), toName: nameOf(d.to) }]); };
    addEventListener("kantor:handover", f); return () => removeEventListener("kantor:handover", f);
  });
  useEffect(() => {
    const f = (event: Event) => {
      const detail = (event as CustomEvent<{ action: string; title: string; agentId: string | null }>).detail;
      if (!detail) return;
      if (detail.action === "approve" || detail.action === "done") {
        setFlowNotice(`Approved: ${detail.title}`);
        if (detail.agentId) {
          window.dispatchEvent(new CustomEvent("kantor:speech", {
            detail: { actorId: detail.agentId, tone: "approved", badge: "Approved", text: "Approved! Back to desk ✓", pixelKind: "heart", ms: 3400 },
          }));
        }
      } else if (detail.action === "assigned" || detail.action === "queued") {
        setFlowNotice(`${detail.action === "assigned" ? "Assigned" : "Queued"}: ${detail.title}`);
        const agent = uniqueDesks.find(d => d.agentId === detail.agentId);
        if (agent && ownerActorId) {
          startWalks([{ from: ownerActorId, to: agent.agentId, title: detail.title, fromName: ownerName ?? "You", toName: agent.name, kind: "assign" }]);
        }
      } else if (detail.action === "revise" || detail.action === "reply") {
        setFlowNotice(`Feedback sent: ${detail.title}`);
        const agent = uniqueDesks.find(d => d.agentId === detail.agentId);
        if (agent) {
          window.dispatchEvent(new CustomEvent("kantor:speech", {
            detail: { actorId: agent.agentId, tone: "revise", badge: "Revising", text: "Got it — revising now ✎", pixelKind: "mail", ms: 3200 },
          }));
          if (ownerActorId) {
            startWalks([{ from: ownerActorId, to: agent.agentId, title: detail.title, fromName: ownerName ?? "You", toName: agent.name, kind: "revise" }]);
          }
        }
      }
    };
    addEventListener("kantor:workflow", f); return () => removeEventListener("kantor:workflow", f);
  }, [ownerActorId, ownerName, startWalks, uniqueDesks]);
  const [flowPaused, setFlowPaused] = useState(false);
  useEffect(() => {
    if (!flowNotice) { setFlowPaused(false); return; }
    announceToast(flowNotice);
  }, [flowNotice, announceToast]);
  useEffect(() => {
    if (!flowNotice || flowPaused) return;
    const t = setTimeout(() => setFlowNotice(""), 5000);
    return () => clearTimeout(t);
  }, [flowNotice, flowPaused]);
  useEffect(() => {
    if (previewStep === null) return;
    const first = uniqueDesks[0];
    if (previewStep === 0 && first) {
      const fromId = ownerActorId ?? uniqueDesks[1]?.agentId;
      const fromLabel = ownerActorId ? (ownerName ?? "Owner") : (uniqueDesks[1]?.name ?? "Manager");
      if (fromId && fromId !== first.agentId) {
        startWalks([{ from: fromId, to: first.agentId, title: "Q4 Launch Brief", fromName: fromLabel, toName: first.name, kind: "assign" }]);
      }
    } else if (previewStep === 3 && first) {
      window.dispatchEvent(new CustomEvent("kantor:speech", {
        detail: { actorId: first.agentId, tone: "approved", badge: "Approved", text: "Approved! Back to desk ✓", pixelKind: "heart", ms: 3400 },
      }));
    }
    const durations = [4200, 3200, 7500, 3200];
    const timer = setTimeout(() => setPreviewStep(step => step === 3 ? null : step === null ? null : step + 1), durations[previewStep] ?? 3200);
    return () => clearTimeout(timer);
  }, [previewStep, ownerActorId, ownerName, startWalks, uniqueDesks]);

  const reviewTasksByAgent = useMemo(() => {
    const out: Record<string, ReviewTaskInfo> = {};
    for (const t of a.review) {
      const desk = uniqueDesks.find(d => d.name === t.assignee);
      if (desk && !out[desk.agentId]) {
        out[desk.agentId] = { id: t.id, ws: t.ws, title: t.title };
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
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<{ text: string; tone: "ok" | "error"; key: number } | null>(null);
  const [sendPaused, setSendPaused] = useState(false);
  const flowToastRef = useRef<HTMLDivElement>(null);
  const sendToastRef = useRef<HTMLDivElement>(null);
  const toastRegionRef = useRef<HTMLDivElement>(null);
  const sessions = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!sendStatus) { setSendPaused(false); return; }
    announceToast(sendStatus.text);
  }, [sendStatus, announceToast]);

  useEffect(() => {
    if (!sendStatus || sendPaused) return;
    const ms = sendStatus.tone === "error" ? 7000 : 4000;
    const t = setTimeout(() => setSendStatus(null), ms);
    return () => clearTimeout(t);
  }, [sendStatus, sendPaused]);

  const modalDialogOpen = !!(chatWith || openTask || newProject || standupOpen || orchDraft);

  // Sync toast region anchor coords with .office stage and promote active toasts via popover="manual" when supported
  useEffect(() => {
    const syncPos = () => {
      const stageEl = officeRef.current;
      const regionEl = toastRegionRef.current;
      if (!stageEl || !regionEl) return;
      const r = stageEl.getBoundingClientRect();
      regionEl.style.setProperty("--toast-left", `${Math.max(12, Math.round(r.left + 16))}px`);
      regionEl.style.setProperty("--toast-bottom", `${Math.max(16, Math.round(window.innerHeight - r.bottom + 82))}px`);
    };
    syncPos();
    const ro = typeof ResizeObserver !== "undefined" && officeRef.current ? new ResizeObserver(syncPos) : null;
    if (ro && officeRef.current) ro.observe(officeRef.current);
    window.addEventListener("resize", syncPos);
    return () => { ro?.disconnect(); window.removeEventListener("resize", syncPos); };
  }, [flowNotice, sendStatus, modalDialogOpen]);

  useEffect(() => {
    if (typeof HTMLElement === "undefined" || !Object.hasOwn(HTMLElement.prototype, "popover")) return;
    for (const [el, active] of [
      [flowToastRef.current, !!flowNotice && previewStep === null && !modalDialogOpen],
      [sendToastRef.current, !!sendStatus && !modalDialogOpen],
    ] as const) {
      if (!el) continue;
      if (active) {
        if (el.getAttribute("popover") !== "manual") el.setAttribute("popover", "manual");
        try { if (!el.matches(":popover-open")) el.showPopover(); } catch { /* ignore */ }
      } else {
        try { if (el.matches(":popover-open")) el.hidePopover(); } catch { /* ignore */ }
      }
    }
  }, [flowNotice, previewStep, sendStatus, modalDialogOpen]);

  const dismissFlowNotice = useCallback((restoreFocus = false) => {
    const wasFocused = restoreFocus && !!flowToastRef.current?.contains(document.activeElement);
    setFlowNotice("");
    if (wasFocused) {
      requestAnimationFrame(() => {
        const nextBtn = sendToastRef.current?.querySelector<HTMLButtonElement>("button.toast-close");
        (nextBtn ?? document.getElementById("office-ask"))?.focus();
      });
    }
  }, []);

  const dismissSendStatus = useCallback((restoreFocus = false) => {
    const wasFocused = restoreFocus && !!sendToastRef.current?.contains(document.activeElement);
    setSendStatus(null);
    if (wasFocused) {
      requestAnimationFrame(() => {
        const nextBtn = flowToastRef.current?.querySelector<HTMLButtonElement>("button.toast-close");
        (nextBtn ?? document.getElementById("office-ask"))?.focus();
      });
    }
  }, []);

  async function askManager() {
    if (!composeAgent || !compose.trim() || sending) return;
    const target = composeAgent, message = compose.trim();
    setSending(true); setSendStatus(null);
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
      setSendStatus({ text: `Message delivered to ${target.name}`, tone: "ok", key: Date.now() });
      logEvent({ kind: "handoff", title: `Message → ${target.name}`, detail: message.slice(0, 80), agentId: target.agentId });
      window.dispatchEvent(new CustomEvent("kantor:letter", { detail: { agentId: target.agentId } }));
    } catch(e) { setSendStatus({ text: e instanceof Error ? e.message : String(e), tone: "error", key: Date.now() }); }
    finally { setSending(false); }
  }

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
    if (agent) {
      window.dispatchEvent(new CustomEvent("kantor:speech", {
        detail: { actorId: agent.agentId, tone: "approved", badge: "Approved", text: "Approved! Back to desk ✓", pixelKind: "heart", ms: 3400 },
      }));
    }
    logEvent({ kind: "approve", title: `Approved: ${t.title}`, detail: t.assignee ?? undefined, agentId: agent?.agentId, issueId: t.id, ws: t.ws });
    setToast(`Approved "${t.title}"`);
    refresh();
  }, [uniqueDesks, logEvent, refresh]);

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
      window.dispatchEvent(new CustomEvent("kantor:speech", {
        detail: { actorId: agent.agentId, tone: "revise", badge: "Revising", text: "Got it — revising now ✎", pixelKind: "mail", ms: 3200 },
      }));
      if (ownerActorId) {
        startWalks([{ from: ownerActorId, to: agent.agentId, title: t.title, fromName: ownerName ?? "You", toName: agent.name, kind: "revise" }]);
      }
    }
    logEvent({ kind: "revise", title: `Revision sent: ${t.title}`, detail: feedback, agentId: agent?.agentId, issueId: t.id, ws: t.ws });
    setToast(`Sent revision notes to ${t.assignee ?? "agent"}`);
    refresh();
  }, [uniqueDesks, ownerActorId, ownerName, startWalks, logEvent, refresh]);

  const handleWorkflowLaunched = useCallback((res: LaunchedWorkflow) => {
    setOrchDraft(null);
    setCompose("");
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
    });
    setToast(
      res.parked
        ? `Delegated ${res.created.length} task(s). Parked until the office opens.`
        : `Delegated ${res.created.length} task(s) in ${res.mode === "chain" ? "sequential chain" : "parallel"} mode!`
    );
    refresh();
  }, [mika, ownerActorId, ownerName, uniqueDesks, startWalks, logEvent, office.workspaceId, refresh]);

  function submitComposer(e: React.FormEvent) {
    e.preventDefault();
    if (!compose.trim()) return;
    if (composeMode === "delegate") {
      setOrchDraft({ goal: compose.trim() });
      return;
    }
    void askManager();
  }

  return (
    <>
      <header className="top office-top">
        <div className="wrap hbar">
          <button type="button" className="office-nav-button" onClick={() => { setControlsOpen(false); setAttentionOpen(false); window.dispatchEvent(new Event("kantor:nav-toggle")); }} aria-label="Toggle navigation" title="Navigation">☰</button>
          <div className="brand"><h1>{office.workspace}</h1><span className={`office-live ${office.switchOpen ? "is-open" : "is-closed"}`}><i />{office.switchOpen ? "Office open" : "Office closed"}</span></div>
          {(() => {
            const cq = office.codexQuota;
            const pct5h = cq ? cq.remaining5h : (office.open ? 100 : 0);
            const pctWk = cq ? cq.remainingWeekly : pct5h;
            const minPct = Math.min(pct5h, pctWk);
            const tone = !cq?.online ? "is-off" : minPct < 15 ? "is-low" : minPct < 40 ? "is-warn" : "is-ok";
            const tipParts = [
              `Codex ${cq?.planType ? `(${cq.planType.toUpperCase()})` : ""}`.trim(),
              `5h remaining: ${pct5h}%${cq?.reset5hAt ? ` · resets ${cq.reset5hAt}` : ""}`,
              `Weekly remaining: ${pctWk}%${cq?.resetWeeklyAt ? ` · resets ${cq.resetWeeklyAt}` : ""}`,
              cq?.creditsBalance ? `Extra credits: ${cq.creditsBalance}` : null,
              cq?.updatedAt ? `Synced ${cq.updatedAt}` : null,
            ].filter(Boolean);
            return (
              <div className="header-engines">
                <span className={`codex-meter ${tone}`} title={tipParts.join(" • ")}>
                  <b>Codex</b>
                  <i><em style={{ width: `${pct5h}%` }} /></i>
                  <small className="codex-pct">{`5h ${pct5h}%`}</small>
                  {cq && <small className={`codex-wk${pctWk < 20 ? " is-low" : pctWk < 40 ? " is-warn" : ""}`}>{`7d ${pctWk}%`}</small>}
                </span>
              </div>
            );
          })()}
          <div className="office-top-actions">
            <OfficeAmbience open={office.switchOpen} timeZone={office.timeZone} calendar={office.workCalendar} activeWork={activeWork} />
            <button type="button" className="office-top-button" aria-label="Team Standup" aria-expanded={standupOpen} onClick={() => openStandup()}><Px name="team" /><span className="btn-label">Standup</span></button>
            <button type="button" className={`office-top-button${total > 0 ? " has-attn" : ""}`} aria-label={total > 0 ? `Attention (${total})` : "Attention"} onClick={() => { setControlsOpen(false); setAttentionOpen(v => !v); }} aria-expanded={attentionOpen}><Px name="bell" /><span className="btn-label">Attention</span>{total > 0 && <b>{total}</b>}</button>
            <button type="button" className="office-top-button" aria-label="New project" onClick={() => setNewProject(true)}><Px name="plus" /><span className="btn-label">Project</span></button>
            <button type="button" className="office-top-button" aria-label="Office controls" onClick={() => { setAttentionOpen(false); setControlsOpen(v => !v); }} aria-expanded={controlsOpen}><Px name="gear" /><span className="btn-label">Controls</span></button>
          </div>
          {controlsOpen && <div className="office-controls" role="region" aria-label="Office controls">
            <div className="office-controls-head"><b>Office controls</b><button onClick={() => setControlsOpen(false)} aria-label="Close controls">×</button></div>
            <div className="office-controls-row">
              <OfficeSwitch key={office.workspaceId + String(office.switchOpen)} ws={office.workspaceId} name={office.workspace} switchOpen={office.switchOpen} laptopOn={office.open} parked={office.parked} onDone={msg => { logEvent({ kind: "door", title: msg }); setToast(msg); refresh(); }} />
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
              {office.codexQuota ? (
                <>
                  <span className="runtime-chip" title={`Codex 5h rolling window${office.codexQuota.reset5hAt ? ` · resets ${office.codexQuota.reset5hAt}` : ""}`}>
                    <i className={office.codexQuota.online ? "on" : ""} />
                    Codex 5h · {office.codexQuota.remaining5h}% left
                  </span>
                  <span className="runtime-chip" title={`Codex 7-day quota${office.codexQuota.resetWeeklyAt ? ` · resets ${office.codexQuota.resetWeeklyAt}` : ""}`}>
                    <i className={office.codexQuota.remainingWeekly > 15 ? "on" : ""} />
                    Weekly · {office.codexQuota.remainingWeekly}% left
                  </span>
                </>
              ) : (
                runtimeSummary.filter(([p]) => p === "codex").map(([provider, list]) => (
                  <span className="runtime-chip" key={provider} title={list.map(r => r.name).join(", ")}>
                    <i className={list.some(r => r.online) ? "on" : ""} />Codex {list.filter(r => r.online).length}/{list.length}
                  </span>
                ))
              )}
            </div>
            <div className="office-controls-foot"><span className="clock">{refreshing ? "Refreshing…" : `Updated ${office.updatedAt}`}</span></div>
            <button className="office-preview-button" onClick={() => { setControlsOpen(false); setRoomId("all"); setPreviewStep(0); }}>▶ Preview workflow animation <small>Visual only; no Multica task changes</small></button>
          </div>}
        </div>
      </header>

      <main className="wrap office-home">
        <section className="office" aria-label="Office floor plan" ref={officeRef}>
          {office.alerts.length > 0 && <div className="office-alerts">{office.alerts.map(x => <div key={x} className="alert" role="alert"><Px name="alert" /> {x}</div>)}</div>}

          <ReferenceOffice
            desks={roomId.startsWith("squad:") ? visibleRooms.flatMap(r => r.desks) : uniqueDesks}
            humans={patchedMembers}
            ownerId={patchedMembers.find(m => m.id === meId)?.id ?? patchedMembers[0]?.id ?? null}
            officeOpen={office.switchOpen}
            lunch={lunchHour}
            previewWorking={previewStep === 1}
            previewReviewId={previewStep === 2 ? (uniqueDesks[0]?.agentId ?? null) : null}
            huddleIds={huddleIds}
            coffeeTick={coffeeTick}
            reviewTasksByAgent={reviewTasksByAgent}
            floorTheme="harvest"
            harvestPhase={harvestPhase}
            onDesk={d => openAgentDrawer(d.agentId, "tasks")}
            onHuman={name => { setOpenHuman(name); setHumanAvatarOpen(false); setHumanFaceErr(null); setOpenDeskId(null); }}
            onMeeting={focusId => openStandup(focusId)}
            onPropClick={handlePropClick}
            onDropAgent={handleDropAgent}
            onOpenTask={(id, ws) => setOpenTask(id, ws)}
            walks={walks}
            onDone={key => setWalks(items => items.filter(x => x.key !== key))}
            onDelivered={h => { if (h.title === "Preview handover") setPreviewStep(step => step === 2 ? 3 : step); }}
          />

          <div className="office-hud-layer">
            <LiveActivityFeed
              events={activity}
              open={feedOpen}
              onToggle={() => setFeedOpen(v => !v)}
              onSelectEvent={ev => {
                setFeedOpen(false);
                if (ev.issueId) { setOpenTask(ev.issueId, ev.ws ?? office.workspaceId); return; }
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

          <div ref={toastRegionRef} role="region" aria-label="Notifications" className="office-toast-region">
            {!modalDialogOpen && flowNotice && previewStep === null && (
              <div
                id="office-flow-toast"
                ref={flowToastRef}
                className="workflow-notice office-toast-item"
                onMouseEnter={() => setFlowPaused(true)}
                onMouseLeave={() => setFlowPaused(false)}
                onFocus={() => setFlowPaused(true)}
                onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFlowPaused(false); }}
                onToggle={e => { if ((e as unknown as { newState?: string }).newState === "closed") dismissFlowNotice(true); }}
              >
                <span className="toast-ic is-ok" aria-hidden="true"><Px name="check" /></span>
                <span className="toast-msg">{flowNotice}</span>
                <button
                  type="button"
                  className="toast-close"
                  aria-label="Close notification"
                  {...({ popovertarget: "office-flow-toast", popovertargetaction: "hide" } as Record<string, string>)}
                  onClick={() => dismissFlowNotice(true)}
                >
                  ×
                </button>
              </div>
            )}
            {!modalDialogOpen && sendStatus && (
              <div
                id="office-send-toast"
                ref={sendToastRef}
                className={`composer-feedback office-toast-item is-${sendStatus.tone}${flowNotice && previewStep === null ? " is-stacked" : ""}`}
                onMouseEnter={() => setSendPaused(true)}
                onMouseLeave={() => setSendPaused(false)}
                onFocus={() => setSendPaused(true)}
                onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSendPaused(false); }}
                onToggle={e => { if ((e as unknown as { newState?: string }).newState === "closed") dismissSendStatus(true); }}
              >
                <span className={`toast-ic is-${sendStatus.tone}`} aria-hidden="true">
                  <Px name={sendStatus.tone === "error" ? "alert" : "check"} />
                </span>
                <span className="toast-msg">{sendStatus.text}</span>
                <button
                  type="button"
                  className="toast-close"
                  aria-label="Close notification"
                  {...({ popovertarget: "office-send-toast", popovertargetaction: "hide" } as Record<string, string>)}
                  onClick={() => dismissSendStatus(true)}
                >
                  ×
                </button>
              </div>
            )}
          </div>

          <form className="office-composer" onSubmit={submitComposer}>
            <div className="composer-mode" role="group" aria-label="Command bar mode">
              <button type="button" aria-pressed={composeMode === "message"} onClick={() => setComposeMode("message")}>Message</button>
              <button type="button" aria-pressed={composeMode === "delegate"} onClick={() => setComposeMode("delegate")}>Delegate</button>
            </div>
            {composeMode === "message" && (
              <select aria-label="Choose agent to message" value={composeAgent?.agentId ?? ""} onChange={e => setComposeAgentId(e.target.value)}>
                {uniqueDesks.map(d => <option key={d.agentId} value={d.agentId}>{d.name}</option>)}
              </select>
            )}
            <label htmlFor="office-ask">{composeMode === "delegate" ? "Delegate goal" : "Message"}</label>
            <input
              id="office-ask"
              value={compose}
              onChange={e => setCompose(e.target.value)}
              placeholder={
                !uniqueDesks.length
                  ? "Add an agent to start collaborating"
                  : composeMode === "delegate"
                    ? "Describe a goal to split & delegate across agents (use → to separate steps)…"
                    : "Write a message. Enter sends…"
              }
              disabled={!uniqueDesks.length}
            />
            <button type="submit" disabled={!uniqueDesks.length || sending || !compose.trim()}>
              {sending ? "Sending…" : composeMode === "delegate" ? "Plan & Delegate →" : "Send →"}
            </button>
          </form>
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
          onOpenChat={() => {
            const target = openDesk;
            setOpenDeskId(null);
            setChatPrompt("");
            setChatWith(target);
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
        <ChatPanel ws={office.workspaceId} agent={{ id: chatWith.agentId, name: chatWith.name, emoji: chatWith.emoji, face: chatWith.face, role: chatWith.description }}
          isMika={isManager(chatWith.name)} projectId={null} laptopOn={office.open} initialPrompt={chatPrompt}
          onClose={() => { setChatWith(null); setChatPrompt(""); }}
          onMakeTask={(detail, agentId) => { const d = allDesks.find(x => x.agentId === agentId) ?? chatWith; setChatWith(null); openAgentDrawer(d.agentId, "create", detail); }} />
      )}
      {/* Floating button to chat with the office manager, like a help button on a website. */}
      {mika && !chatWith && !openDesk && !openTask && !openHuman && (
        <button className="mikafab" onClick={() => { setChatPrompt(""); setChatWith(mika); }} aria-label={`Chat with ${MANAGER}, the office manager`}>
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
              setChatWith(meetingAgent);
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
      {/* Pre-populated live region fallback when document.ariaNotify() is unavailable */}
      <div className="toast-sr-wrap">
        {srToastText && <p className="toast-sr-only">Screen reader announcements</p>}
        <div className="toast-sr-only" aria-live="polite" aria-atomic="true">{srToastText}</div>
      </div>
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
