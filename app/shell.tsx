"use client";
// Page frame: a sidebar (workspace switcher, menu, notifications) that collapses into a slim icon rail.
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InboxView } from "./api/inbox/route";
import { Px, PxText, type PxName } from "./pixel-icon";
import { sharedJson, useVisiblePoll } from "./visible-poll";
import CharacterFace from "./character-face";
import Stapler from "./stapler";
import ThemeToggle from "./theme-toggle";

const TaskPanel = dynamic(() => import("./task-panel"), { ssr: false });
const Messages = dynamic(() => import("./messages"), { ssr: false });
const Reminders = dynamic(() => import("./reminders"), { ssr: false });
const Contacts = dynamic(() => import("./contacts"), { ssr: false });
const CommandPalette = dynamic(() => import("./command-palette"), { ssr: false });

export type Nav = { id: string; slug: string; name: string; attention?: number; switchOpen?: boolean };
export type RosterAgent = { agentId: string; name: string; description: string; face: string | null; state: string };
export type Section = "kantor" | "papan" | "tim" | "files";

const MENU: { id: Section; path: string; icon: PxName; title: string; sub: string }[] = [
  { id: "kantor", path: "/", icon: "office", title: "Office", sub: "who's doing what, live" },
  { id: "papan", path: "/papan", icon: "board", title: "Task Board", sub: "every task, by project" },
  { id: "tim", path: "/tim", icon: "team", title: "Team Members", sub: "people, agents & workload" },
  { id: "files", path: "/files", icon: "books", title: "Knowledge & Files", sub: "each agent's OneDrive folder" },
];
const KEY = "kantor-side";
const INBOX_MS = 60_000;
const initial = (s: string) => s.trim().slice(0, 1).toUpperCase();

function NewWorkspace({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState(""); const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setErr(null);
    try {
      const j = await (await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description: desc }) })).json();
      if (j.error) throw new Error(j.error);
      location.href = `/?ws=${j.slug}`;
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }
  return (
    <>
      <div className="scrim" onClick={() => !busy && onClose()} />
      <form className="modal" role="dialog" aria-modal="true" aria-label="New workspace" onSubmit={e => { e.preventDefault(); submit(); }}>
        <h2><Px name="office" /> New workspace</h2>
        <p className="desc">A workspace is a separate office with its own projects, agents and people.</p>
        <label className="sect" htmlFor="nw-name">Name</label>
        <input id="nw-name" className="input" autoFocus placeholder="e.g. Marketing Studio" value={name} onChange={e => setName(e.target.value)} />
        <label className="sect" htmlFor="nw-desc">What is it for? (optional)</label>
        <input id="nw-desc" className="input" placeholder="e.g. Campaigns, social posts and launch planning" value={desc} onChange={e => setDesc(e.target.value)} />
        <p className="hint">It starts empty. Add an AI engine in Multica Desktop, then add agents from Team Members.</p>
        {err && <div className="note bad">{err}</div>}
        <div className="row">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!name.trim() || busy}>{busy ? <><span className="spinner sm" /> Creating…</> : "Create workspace"}</button>
        </div>
      </form>
    </>
  );
}

export default function Shell({ buildings, current, section, roster = [], children }: { buildings: Nav[]; current: Nav; section: Section; roster?: RosterAgent[]; children: React.ReactNode }) {
  const router = useRouter();
  // Expanded by default on wide screens, a slim rail on phones. Your choice is remembered in this browser.
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (section === "kantor") { setOpen(matchMedia("(min-width: 1000px)").matches); return; }
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch { /* storage unavailable */ }
    setOpen(saved ? saved === "open" : matchMedia("(min-width: 900px)").matches);
  }, [section]);
  const toggle = (v: boolean) => { setOpen(v); try { localStorage.setItem(KEY, v ? "open" : "closed"); } catch { /* ignore */ } };
  useEffect(() => {
    if (section !== "kantor") return;
    const toggleNav = () => setOpen(v => !v);
    window.addEventListener("kantor:nav-toggle", toggleNav);
    return () => window.removeEventListener("kantor:nav-toggle", toggleNav);
  }, [section]);
  const narrow = () => !matchMedia("(min-width: 900px)").matches;

  // Workspace switcher
  const [wsOpen, setWsOpen] = useState(false);
  const [wsSummaries, setWsSummaries] = useState<Record<string, Pick<Nav, "attention" | "switchOpen">>>({});
  const [newWs, setNewWs] = useState(false);
  const wsBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!wsOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === "Escape" : !wsBox.current?.contains(e.target as Node)) setWsOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [wsOpen]);
  useEffect(() => {
    if (!wsOpen) return;
    let active = true;
    const missing = buildings.filter(b => b.id !== current.id && !wsSummaries[b.id]);
    void (async () => {
      for (let i = 0; i < missing.length && active; i += 2) {
        await Promise.all(missing.slice(i, i + 2).map(b =>
          sharedJson<Pick<Nav, "attention" | "switchOpen">>(`/api/workspace-summary?ws=${encodeURIComponent(b.id)}`)
            .then(v => { if (active) setWsSummaries(old => ({ ...old, [b.id]: v })); }).catch(() => {})));
      }
    })();
    return () => { active = false; };
  // The list is captured when the switcher opens; results update the badge without restarting the queue.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsOpen, buildings, current.id]);

  // Notifications
  const [unread, setUnread] = useState(0);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [items, setItems] = useState<InboxView[] | null>(null);
  const [inboxErr, setInboxErr] = useState<string | null>(null);
  const [task, setTask] = useState<string | null>(null);
  // Person-to-person messages
  const [dmOpen, setDmOpen] = useState(false);
  const [dmWith, setDmWith] = useState<string | null>(null);
  const [dmUnread, setDmUnread] = useState(0);
  const [remindOpen, setRemindOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdkOpen(v => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const loadDmCount = useCallback(() => {
    fetch(`/api/dm?ws=${current.id}&count=1`).then(r => r.json()).then(j => typeof j.unread === "number" && setDmUnread(j.unread)).catch(() => {});
  }, [current.id]);
  useEffect(() => { loadDmCount(); }, [loadDmCount]);
  useVisiblePoll(loadDmCount, INBOX_MS);
  useEffect(() => {
    const f = (e: Event) => { setDmWith((e as CustomEvent).detail?.userId ?? null); setDmOpen(true); };
    addEventListener("kantor:dm", f); return () => removeEventListener("kantor:dm", f);
  }, []);
  const loadCount = useCallback(() => {
    fetch(`/api/inbox?ws=${current.id}&count=1`).then(r => r.json()).then(j => typeof j.unread === "number" && setUnread(j.unread)).catch(() => {});
  }, [current.id]);
  // Reading a chat also clears its notifications, so refresh the bell count along with the Messages badge.
  const onDmUnread = useCallback((n: number) => { setDmUnread(n); loadCount(); }, [loadCount]);
  const loadItems = useCallback(async () => {
    setInboxErr(null);
    try { const j = await (await fetch(`/api/inbox?ws=${current.id}`)).json(); if (j.error) throw new Error(j.error); setItems(j.items); setUnread(j.unread); }
    catch (e) { setInboxErr(e instanceof Error ? e.message : String(e)); }
  }, [current.id]);
  useEffect(() => { loadCount(); }, [loadCount]);
  useVisiblePoll(loadCount, INBOX_MS);
  useEffect(() => { if (inboxOpen) loadItems(); }, [inboxOpen, loadItems]);
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s*/, "");
    document.title = unread ? `(${unread}) ${base}` : base;
  }, [unread]);
  async function read(id?: string) {
    const j = await (await fetch("/api/inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(id ? { ws: current.id, id } : { ws: current.id, all: true }) })).json().catch(() => null);
    if (j && typeof j.unread === "number") setUnread(j.unread);
    setItems(cur => cur?.map(i => (!id || i.id === id) ? { ...i, read: true } : i) ?? cur);
  }
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && inboxOpen && !task) setInboxOpen(false); };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [inboxOpen, task]);

  const path = MENU.find(m => m.id === section)!.path;
  const others = buildings.filter(b => b.id !== current.id);
  const tip = (t: string) => (open ? undefined : t);

  return (
    <div className={`shell ${section === "kantor" ? "office-shell" : ""} ${open ? "side-open" : "side-rail"}`}>
      <aside className="side" aria-label="Main menu">
        <div className="side-top">
          <button className="side-toggle" onClick={() => toggle(!open)} aria-label={open ? "Collapse menu" : "Expand menu"} title={open ? "Collapse menu" : "Expand menu"}>
            {open ? "«" : "»"}
          </button>
          {open && <b className="side-app">Virtual Office</b>}
        </div>

        <div className="ws-pick" ref={wsBox}>
          <button className="ws-cur" onClick={() => setWsOpen(o => !o)} aria-expanded={wsOpen} aria-haspopup="listbox" title={tip(`Workspace: ${current.name}`)}>
            <span className="ws-av">{initial(current.name)}</span>
            {open && <span className="ws-t"><small>Workspace</small><b>{current.name}</b></span>}
            {open && <span className="ws-caret">▾</span>}
          </button>
          {wsOpen && (
            <div className="ws-pop" role="listbox" aria-label="Switch workspace">
              <div className="ws-h">Switch workspace</div>
              {buildings.map(raw => { const b = { ...raw, ...wsSummaries[raw.id] }; return (
                <Link key={b.id} href={`${path}?ws=${b.slug}`} role="option" aria-selected={b.id === current.id} className="ws-opt"
                  onClick={() => { setWsOpen(false); if (narrow()) toggle(false); }}>
                  <span className="ws-av sm">{initial(b.name)}</span><span className="ws-n">{b.name}</span>
                  {b.switchOpen === false && <span title="Office closed"><Px name="lock" /></span>}
                  {b.attention ? <span className="count">{b.attention}</span> : null}
                  {b.id === current.id && <span className="ws-check"><Px name="check" /></span>}
                </Link>
              ); })}
              <button className="ws-opt ws-new" onClick={() => { setWsOpen(false); setNewWs(true); }}>
                <span className="ws-av sm"><Px name="plus" size="0.9em" /></span><span className="ws-n">New workspace</span>
              </button>
            </div>
          )}
        </div>

        <nav className="side-menu">
          <button type="button" className="side-link side-cmdk" onClick={() => { setCmdkOpen(true); if (narrow()) toggle(false); }} title={tip("Quick Jump (⌘K)")}>
            <span className="sl-ic"><Px name="compass" /></span>
            {open && <span className="sl-t"><b>Quick Jump</b><small>tasks, agents &amp; actions</small></span>}
            {open && <kbd className="cmdk-kbd">⌘K</kbd>}
          </button>
          {MENU.map(m => (
            <Link key={m.id} href={`${m.path}?ws=${current.slug}`} className="side-link" aria-current={m.id === section ? "page" : undefined}
              title={tip(m.title)} onClick={() => narrow() && toggle(false)}>
              <span className="sl-ic"><Px name={m.icon} /></span>{open && <span className="sl-t"><b>{m.title}</b><small>{m.sub}</small></span>}
            </Link>
          ))}
          <button className="side-link" onClick={() => { setDmWith(null); setDmOpen(true); if (narrow()) toggle(false); }} title={tip(dmUnread ? `Messages (${dmUnread} unread)` : "Messages")}>
            <span className="sl-ic"><Px name="chat" /></span>{open && <span className="sl-t"><b>Messages</b><small>chat with your teammates</small></span>}
            {dmUnread > 0 && <span className="sl-badge" aria-label={`${dmUnread} unread`}>{dmUnread > 99 ? "99+" : dmUnread}</span>}
          </button>
          <button className="side-link" onClick={() => { setRemindOpen(true); if (narrow()) toggle(false); }} title={tip("Reminders")}>
            <span className="sl-ic"><Px name="clock" /></span>{open && <span className="sl-t"><b>Reminders</b><small>sent to your Telegram</small></span>}
          </button>
          <button className="side-link" onClick={() => { setContactsOpen(true); if (narrow()) toggle(false); }} title={tip("WhatsApp contacts")}>
            <span className="sl-ic"><Px name="person" /></span>{open && <span className="sl-t"><b>WhatsApp contacts</b><small>for drafted messages</small></span>}
          </button>
          <button className="side-link" onClick={() => { setInboxOpen(true); if (narrow()) toggle(false); }} title={tip(unread ? `Notifications (${unread} unread)` : "Notifications")}>
            <span className="sl-ic"><Px name="bell" /></span>{open && <span className="sl-t"><b>Notifications</b><small>mentions, reviews & updates</small></span>}
            {unread > 0 && <span className="sl-badge" aria-label={`${unread} unread`}>{unread > 99 ? "99+" : unread}</span>}
          </button>
        </nav>
        {open && roster.length > 0 && <div className="agent-roster"><h2>AGENTS</h2>{roster.map(a => <button type="button" className="agent-row" key={a.agentId} onClick={() => { window.dispatchEvent(new CustomEvent("kantor:desk", { detail: { agentId: a.agentId } })); if (section === "kantor" || narrow()) toggle(false); }}><CharacterFace face={a.face} size={34} /><span><b>{a.name}</b><small>{a.description || a.state}</small></span><i className={a.state === "failed" ? "err" : !["off", "closed"].includes(a.state) ? "on" : ""} title={a.state === "home" ? "Online · standby" : a.state} /></button>)}</div>}
        <div className="side-foot">
          {open ? <ThemeToggle variant="segmented" /> : <ThemeToggle variant="compact" />}
        </div>
      </aside>
      {open && <div className="side-scrim" onClick={() => toggle(false)} />}

      <div className="shell-main">{children}</div>
      <Stapler ws={current.id} />

      {inboxOpen && !task && (
        <>
          <div className="scrim" onClick={() => setInboxOpen(false)} />
          <div className="drawer inboxdrawer" role="dialog" aria-modal="true" aria-label="Notifications">
            <div className="dhead">
              <span className="avatar"><Px name="bell" /></span>
              <div className="meta"><h2>Notifications</h2><div className="role">{unread ? `${unread} unread` : <>You&apos;re all caught up <Px name="coffee" /></>}</div></div>
              <button className="x" onClick={() => setInboxOpen(false)} aria-label="Close"><Px name="close" size="1em" /></button>
            </div>
            <div className="dbody">
              {unread > 0 && <div className="chiprow"><button className="btn sm" onClick={() => read()}><Px name="done" /> Mark all as read</button></div>}
              {inboxErr && <div className="note bad">{inboxErr}</div>}
              {!items && !inboxErr && <div className="loading"><span className="spinner" /> Loading notifications…</div>}
              {items && !items.length && <p className="desc">Nothing yet. When someone @mentions you, it shows up here.</p>}
              <ul className="inbox">
                {items?.map(i => (
                  <li key={i.id}>
                    <button className={`ib ${i.read ? "" : "unread"}`} onClick={() => {
                      if (!i.read) read(i.id);
                      if (i.dmWith) { setInboxOpen(false); setDmWith(i.dmWith); setDmOpen(true); } else if (i.issueId) setTask(i.issueId);
                    }}>
                      <span className="ib-ic"><Px name={i.icon} /></span>
                      <span className="ib-t"><b>{i.label}</b><span className="ib-title"><PxText text={i.title} /></span>{i.excerpt && <small>{i.excerpt}</small>}</span>
                      <span className="ib-when">{i.when}{!i.read && <i className="ib-dot" aria-label="unread" />}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
      {remindOpen && <Reminders ws={current.id} onClose={() => setRemindOpen(false)} />}
      {contactsOpen && <Contacts onClose={() => setContactsOpen(false)} />}
      {newWs && <NewWorkspace onClose={() => setNewWs(false)} />}
      {dmOpen && <Messages ws={current.id} start={dmWith} onClose={() => { setDmOpen(false); setDmWith(null); }} onUnread={onDmUnread} />}
      {cmdkOpen && (
        <CommandPalette
          current={current}
          buildings={buildings}
          section={section}
          roster={roster}
          onClose={() => setCmdkOpen(false)}
          onOpenTask={id => setTask(id)}
          onOpenDm={() => { setDmWith(null); setDmOpen(true); }}
          onOpenReminders={() => setRemindOpen(true)}
          onOpenContacts={() => setContactsOpen(true)}
          onOpenInbox={() => setInboxOpen(true)}
        />
      )}
      {task && <div className="scrim" onClick={() => { setTask(null); loadItems(); }} />}
      {task && <TaskPanel id={task} ws={current.id} onClose={() => { setTask(null); loadItems(); }} onChanged={() => router.refresh()} />}
    </div>
  );
}
