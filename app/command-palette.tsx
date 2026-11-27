"use client";
// Global Command Palette (Cmd+K / Ctrl+K): instant navigation across tasks, agent chats, desks, actions & workspaces.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Px, type PxName } from "./pixel-icon";
import CharacterFace from "./character-face";
import type { Nav, RosterAgent, Section } from "./shell";

type QuickTask = { id: string; key: string; title: string; status: string; statusLabel: string; assignee: string | null; project: string | null; ws: string };
type QuickAgent = { id: string; name: string; squad: string; state: string; bubble: string; face: string | null };

type PaletteItem = {
  id: string;
  group: string;
  title: string;
  subtitle: string;
  icon?: PxName;
  face?: string | null;
  shortcut?: string;
  run: () => void;
};

export default function CommandPalette({
  current,
  buildings,
  section,
  roster,
  onClose,
  onOpenTask,
  onOpenDm,
  onOpenReminders,
  onOpenContacts,
  onOpenInbox,
}: {
  current: Nav;
  buildings: Nav[];
  section: Section;
  roster: RosterAgent[];
  onClose: () => void;
  onOpenTask: (id: string) => void;
  onOpenDm: () => void;
  onOpenReminders: () => void;
  onOpenContacts: () => void;
  onOpenInbox: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [tasks, setTasks] = useState<QuickTask[]>([]);
  const [agents, setAgents] = useState<QuickAgent[]>(() =>
    roster.map(r => ({ id: r.agentId, name: r.name, squad: "", state: r.state, bubble: r.description, face: r.face }))
  );
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    let alive = true;
    fetch(`/api/quick-search?ws=${encodeURIComponent(current.id)}`)
      .then(r => r.json())
      .then(j => {
        if (!alive) return;
        if (Array.isArray(j.tasks)) setTasks(j.tasks);
        if (Array.isArray(j.agents) && j.agents.length) setAgents(j.agents);
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [current.id]);

  const allItems = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = [];
    const goOfficeEvent = (name: string, detail?: Record<string, unknown>) => {
      onClose();
      if (section !== "kantor") {
        router.push(`/?ws=${encodeURIComponent(current.slug)}`);
        setTimeout(() => window.dispatchEvent(new CustomEvent(name, { detail })), 450);
      } else {
        window.dispatchEvent(new CustomEvent(name, { detail }));
      }
    };

    // Quick Actions
    out.push(
      { id: "act-standup", group: "Quick Actions", title: "Call Team Standup Huddle", subtitle: "Gather agents around the meeting table", icon: "team", run: () => goOfficeEvent("kantor:action", { type: "standup" }) },
      { id: "act-workflows", group: "Quick Actions", title: "Open Workflows, Insights & Integrations", subtitle: "Task chains, metrics, webhook & health", icon: "rocket", run: () => goOfficeEvent("kantor:action", { type: "workflows" }) },
      { id: "act-integrations", group: "Quick Actions", title: "Integrations & Webhook Health", subtitle: "Telegram, WhatsApp, Taiga, Outbound Webhook", icon: "gear", run: () => goOfficeEvent("kantor:action", { type: "integrations" }) },
      { id: "act-delegate", group: "Quick Actions", title: "Delegate Multi-Step Goal", subtitle: "Split goal into sequential or parallel tasks", icon: "sparkle", run: () => goOfficeEvent("kantor:action", { type: "delegate" }) },
      { id: "act-project", group: "Quick Actions", title: "Create New Project", subtitle: "Add a project to Multica", icon: "plus", run: () => goOfficeEvent("kantor:action", { type: "new-project" }) },
    );

    // Agents: Direct Chat & Desk
    for (const a of agents) {
      out.push({
        id: `chat-${a.id}`,
        group: "Chat with Agent",
        title: `Chat with ${a.name}`,
        subtitle: a.squad ? `${a.squad} · continue active conversation` : "Continue active conversation (bukan task)",
        face: a.face,
        shortcut: "Chat",
        run: () => goOfficeEvent("kantor:chat", { agentId: a.id }),
      });
      out.push({
        id: `desk-${a.id}`,
        group: "Agent Desks",
        title: `${a.name}'s Desk`,
        subtitle: a.bubble || a.squad || a.state,
        face: a.face,
        shortcut: "Desk",
        run: () => goOfficeEvent("kantor:desk", { agentId: a.id }),
      });
    }

    // Open Tasks
    for (const t of tasks) {
      out.push({
        id: `task-${t.id}`,
        group: "Open Tasks",
        title: t.title,
        subtitle: [t.key, t.statusLabel, t.assignee, t.project].filter(Boolean).join(" · "),
        icon: t.status === "in_review" ? "eyes" : t.status === "in_progress" ? "doing" : "todo",
        run: () => { onClose(); onOpenTask(t.id); },
      });
    }

    // Navigation & Tools
    out.push(
      { id: "nav-office", group: "Navigate", title: "Office Floor", subtitle: "Live virtual office", icon: "office", run: () => { onClose(); router.push(`/?ws=${encodeURIComponent(current.slug)}`); } },
      { id: "nav-board", group: "Navigate", title: "Task Board", subtitle: "Kanban board by project", icon: "board", run: () => { onClose(); router.push(`/papan?ws=${encodeURIComponent(current.slug)}`); } },
      { id: "nav-team", group: "Navigate", title: "Team Members", subtitle: "People, agents & workload", icon: "team", run: () => { onClose(); router.push(`/tim?ws=${encodeURIComponent(current.slug)}`); } },
      { id: "nav-files", group: "Navigate", title: "Knowledge & Files", subtitle: "Agent OneDrive & shared folders", icon: "books", run: () => { onClose(); router.push(`/files?ws=${encodeURIComponent(current.slug)}`); } },
      { id: "nav-dm", group: "Navigate", title: "Messages (Teammates)", subtitle: "Direct messages with humans", icon: "chat", run: () => { onClose(); onOpenDm(); } },
      { id: "nav-rem", group: "Navigate", title: "Reminders", subtitle: "Telegram reminders", icon: "clock", run: () => { onClose(); onOpenReminders(); } },
      { id: "nav-wa", group: "Navigate", title: "WhatsApp Contacts & Bot", subtitle: "Drafts & linked assistant number", icon: "person", run: () => { onClose(); onOpenContacts(); } },
      { id: "nav-inbox", group: "Navigate", title: "Notifications", subtitle: "Mentions, reviews & updates", icon: "bell", run: () => { onClose(); onOpenInbox(); } },
    );

    // Workspaces
    for (const b of buildings) {
      if (b.id === current.id) continue;
      out.push({
        id: `ws-${b.id}`,
        group: "Switch Workspace",
        title: `Switch to ${b.name}`,
        subtitle: `Open ${b.name} office`,
        icon: "office",
        run: () => { onClose(); router.push(`/?ws=${encodeURIComponent(b.slug)}`); },
      });
    }

    return out;
  }, [agents, tasks, buildings, current, section, router, onClose, onOpenTask, onOpenDm, onOpenReminders, onOpenContacts, onOpenInbox]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // Curated default view: top actions, chat with agents, top 6 open tasks, navigation
      const chats = allItems.filter(i => i.group === "Chat with Agent").slice(0, 5);
      const topTasks = allItems.filter(i => i.group === "Open Tasks").slice(0, 6);
      const acts = allItems.filter(i => i.group === "Quick Actions");
      const navs = allItems.filter(i => i.group === "Navigate").slice(0, 4);
      return [...acts, ...chats, ...topTasks, ...navs];
    }
    const tokens = q.split(/\s+/).filter(Boolean);
    return allItems
      .filter(item => {
        const hay = `${item.title} ${item.subtitle} ${item.group}`.toLowerCase();
        return tokens.every(tok => hay.includes(tok));
      })
      .slice(0, 24);
  }, [allItems, query]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx(i => (filtered.length ? (i + 1) % filtered.length : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx(i => (filtered.length ? (i - 1 + filtered.length) % filtered.length : 0));
      } else if (e.key === "Enter" && filtered[activeIdx]) {
        e.preventDefault();
        filtered[activeIdx].run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, activeIdx, onClose]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section className="cmdk-modal" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="cmdk-head">
          <Px name="compass" />
          <input
            ref={inputRef}
            className="cmdk-input"
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Cari task, ngobrol dengan agent, pindah ruang, atau aksi cepat…"
            aria-label="Search commands, tasks, and agents"
          />
          <kbd className="cmdk-kbd">Esc</kbd>
        </div>
        <div className="cmdk-body" role="listbox" aria-label="Search results">
          {filtered.length === 0 ? (
            <p className="cmdk-empty">{loading ? "Loading workspace index…" : `No match for “${query}”.`}</p>
          ) : (
            filtered.map((item, idx) => {
              const showGroup = idx === 0 || filtered[idx - 1].group !== item.group;
              return (
                <div key={item.id}>
                  {showGroup && <div className="cmdk-group">{item.group}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={idx === activeIdx}
                    className={`cmdk-item${idx === activeIdx ? " is-active" : ""}`}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => item.run()}
                  >
                    <span className="cmdk-ic">
                      {item.face !== undefined ? <CharacterFace face={item.face} size={24} shape="circle" /> : <Px name={item.icon ?? "sparkle"} />}
                    </span>
                    <span className="cmdk-txt">
                      <b>{item.title}</b>
                      <small>{item.subtitle}</small>
                    </span>
                    {item.shortcut && <span className="cmdk-tag">{item.shortcut}</span>}
                  </button>
                </div>
              );
            })
          )}
        </div>
        <footer className="cmdk-foot">
          <span>↑↓ Navigate · ↵ Open · Esc Close</span>
          <span>{loading ? "Syncing index…" : `${tasks.length} open tasks · ${agents.length} agents`}</span>
        </footer>
      </section>
    </>
  );
}
