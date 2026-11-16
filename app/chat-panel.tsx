"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { GrowText } from "./auto-grow";
import { useDraft, writeDraft } from "./drafts";
import remarkGfm from "remark-gfm";
import FilePicker, { uploadAll } from "./file-picker";
import FilePreview from "./file-preview";
import { Px, Emo, PxSpan, rehypePx, type PxName } from "./pixel-icon";

type Session = { id: string; agentId: string; title: string; updatedAt: string; unread: number; last: string };
type Msg = { id: string; mine: boolean; text: string; when: string; failed: string | null; files: { id: string; name: string; url: string }[] };

const md = (t: string) => <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypePx]} components={{ a: (p) => <a {...p} target="_blank" rel="noreferrer" />, span: PxSpan }}>{t}</ReactMarkdown>;

/** Name of the office-manager agent. Set per install with NEXT_PUBLIC_KANTOR_MANAGER. */
export const MANAGER = process.env.NEXT_PUBLIC_KANTOR_MANAGER?.trim() || "Mika";
export const isManager = (name: string) => name.trim().toLowerCase() === MANAGER.toLowerCase();

/** What the office manager can help with, shown as a reminder in the chat. */
const MIKA_CAN: { icon: PxName; label: string; hint: string; prompt: string }[] = [
  { icon: "idea", label: "Brainstorm", hint: "Throw in a rough idea, we shape it together", prompt: "I want to brainstorm about: " },
  { icon: "folder", label: "Start a project", hint: "A new room with a plan to go with it", prompt: "Help me set up a new project. The goal: " },
  { icon: "todo", label: "Create a task", hint: `${MANAGER} picks the agent and due date`, prompt: "Please create a new task: " },
  { icon: "hire", label: "Hire an agent", hint: "A new agent with a specific role", prompt: "I need a new agent for this role: " },
  { icon: "skill", label: "Teach an agent", hint: "Add a skill or change instructions", prompt: "Please add this skill to an agent: " },
  { icon: "clock", label: "Set up a routine", hint: "A task that runs every day or week", prompt: "I want a routine that runs automatically: " },
  { icon: "chart", label: "Team check-in", hint: "Who is busy, what is late, what is stuck", prompt: "How is the team doing right now? Anything late, stuck, or waiting on my decision?" },
];

type AgentInfo = { id: string; name: string; emoji: string | null; role: string };
const dayOf = (iso: string) => new Date(iso).toDateString();
function groupOf(iso: string) {
  const d = new Date(iso), now = new Date();
  if (dayOf(iso) === now.toDateString()) return "Today";
  if (dayOf(iso) === new Date(now.getTime() - 86400000).toDateString()) return "Yesterday";
  if (now.getTime() - d.getTime() < 7 * 86400000) return "This week";
  return "Older";
}
const AgentIc = ({ a }: { a?: AgentInfo | null }) => <span className="ch-ic">{a?.emoji ? <Emo e={a.emoji} /> : <Px name="agent" />}</span>;

/** Chat with your agents in a pop-up: a fresh chat each time you open it, past chats on the left (like Claude). */
export default function ChatPanel({ ws, agent: start, laptopOn, onClose, onMakeTask }: {
  ws: string; agent: AgentInfo;
  isMika?: boolean; projectId?: string | null; laptopOn: boolean;
  onClose: () => void; onMakeTask: (detail: string, agentId: string) => void;
}) {
  const [agents, setAgents] = useState<AgentInfo[]>([start]);
  const [agent, setAgent] = useState<AgentInfo>(start);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [sid, setSid] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[] | null>([]);
  const [working, setWorking] = useState(false);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [onlyThis, setOnlyThis] = useState(true);
  const [histOpen, setHistOpen] = useState(false);
  const [pickAgent, setPickAgent] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const [showHelp, setShowHelp] = useState(false);
  const isMika = isManager(agent.name);
  // Unsent text is kept per chat (and per agent for a new chat), so closing the pop-up loses nothing.
  const draftKey = sid ? `chat:${sid}` : `chat:new:${agent.id}`;
  const draft = useMemo(() => ({ text }), [text]);
  const restore = useCallback((v: { text: string }) => setText(v.text ?? ""), []);
  useDraft(draftKey, draft, restore, { text: "" }, v => !v.text.trim());

  useEffect(() => {
    fetch(`/api/chat?ws=${ws}`).then(r => r.json()).then(j => {
      if (j.error) throw new Error(j.error);
      setSessions(j.sessions);
      if (j.agents?.length) setAgents(j.agents);
    }).catch(e => setErr(String(e.message ?? e)));
  }, [ws]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [onClose]);
  useEffect(() => { document.getElementById("chat-msg")?.focus(); }, [sid, agent.id]);

  const load = useCallback(async (id: string) => {
    const r = await fetch(`/api/chat/${id}?ws=${ws}`); const j = await r.json();
    if (j.error) throw new Error(j.error);
    setMsgs(j.messages); setWorking(j.working);
  }, [ws]);
  useEffect(() => { if (sid) { setMsgs(null); load(sid).catch(e => setErr(String(e.message ?? e))); } }, [sid, load]);
  useEffect(() => {
    if (!sid || !working) return;
    const t = setInterval(() => load(sid).catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [sid, working, load]);
  useEffect(() => { requestAnimationFrame(() => body.current && (body.current.scrollTop = body.current.scrollHeight)); }, [msgs, sending, working, showHelp]);

  const byId = (id: string) => agents.find(a => a.id === id) ?? null;
  function openChat(sx: Session) {
    const a = byId(sx.agentId); if (a) setAgent(a);
    setErr(null); setWorking(false); setShowHelp(false); setSid(sx.id); setHistOpen(false);
    setSessions(cur => cur?.map(x => x.id === sx.id ? { ...x, unread: 0 } : x) ?? cur);
  }
  function newChat(a: AgentInfo = agent) {
    setAgent(a); setSid(null); setMsgs([]); setWorking(false); setErr(null); setShowHelp(false); setPickAgent(false); setHistOpen(false);
  }

  async function send(content = text) {
    if (!content.trim() && !files.length) return;
    setErr(null); setSending(content);
    try {
      let id = sid;
      if (!id) {
        const title = content.trim().split("\n")[0].slice(0, 60) || "New chat";
        const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ws, agentId: agent.id, title }) });
        const j = await r.json(); if (j.error) throw new Error(j.error);
        id = j.id as string;
        writeDraft(`chat:new:${agent.id}`, null); writeDraft(`chat:${id}`, { text: content }); // the draft moves to the new chat
        setSid(id);
        setSessions(s => [{ id: id!, agentId: agent.id, title, updatedAt: new Date().toISOString(), unread: 0, last: "" }, ...(s ?? [])]);
      }
      const fileIds = files.length ? await uploadAll(files, ws) : [];
      const r = await fetch(`/api/chat/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ws, text: content, files: fileIds }) });
      const j = await r.json(); if (j.error) throw new Error(j.error);
      setMsgs(j.messages); setWorking(true); setText(""); setFiles([]);
      setSessions(s => s?.map(x => x.id === id ? { ...x, updatedAt: new Date().toISOString() } : x).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) ?? s);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setSending(null); }
  }

  const lastReply = [...(msgs ?? [])].reverse().find(m => !m.mine && m.text)?.text ?? "";
  const shown = (sessions ?? []).filter(x => !onlyThis || x.agentId === agent.id);
  const groups: [string, Session[]][] = [];
  for (const x of shown) { const g = groupOf(x.updatedAt); const last = groups[groups.length - 1]; if (last?.[0] === g) last[1].push(x); else groups.push([g, [x]]); }
  const fresh = !sid;

  return (
    <div className={`chatmodal ${histOpen ? "hist-open" : ""}`} role="dialog" aria-modal="true" aria-label={`Chat with ${agent.name}`}>
      <aside className="ch-side" aria-label="Chat history">
        <button className="btn primary ch-new" onClick={() => newChat()}><Px name="plus" size="0.9em" /> New chat</button>
        <div className="ch-filter" role="group" aria-label="Show chats">
          <button aria-pressed={onlyThis} onClick={() => setOnlyThis(true)}>This agent</button>
          <button aria-pressed={!onlyThis} onClick={() => setOnlyThis(false)}>All agents</button>
        </div>
        <div className="ch-list">
          {sessions === null && <div className="loading"><span className="spinner sm" /> Loading chats…</div>}
          {sessions && !shown.length && <p className="hint">No chats yet.</p>}
          {groups.map(([g, list]) => (
            <div key={g}>
              <div className="ch-group">{g}</div>
              {list.map(x => (
                <button key={x.id} className="ch-item" aria-current={x.id === sid ? "true" : undefined} onClick={() => openChat(x)} title={x.title}>
                  <AgentIc a={byId(x.agentId)} />
                  <span className="ch-t"><b>{x.title}</b><small>{byId(x.agentId)?.name ?? "Agent"}</small></span>
                  {x.unread > 0 && <span className="sl-badge">{x.unread}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>

      <section className="ch-main">
        <div className="dhead">
          <button className="btn sm ch-histbtn" onClick={() => setHistOpen(o => !o)} aria-expanded={histOpen}><Px name="clock" /> History</button>
          <div className="ch-who">
            <button className="ch-agentbtn" onClick={() => fresh && setPickAgent(p => !p)} disabled={!fresh} aria-expanded={pickAgent}
              title={fresh ? "Pick who to chat with" : undefined}>
              <span className="avatar">{agent.emoji ? <Emo e={agent.emoji} /> : <Px name="chat" />}</span>
              <span className="meta"><h2>{agent.name}{fresh && <span className="caret"> ▾</span>}</h2>
                <span className="role">{fresh ? "New chat · nothing gets done until you ask" : (sessions?.find(x => x.id === sid)?.title ?? "Chat")}</span></span>
            </button>
            {pickAgent && fresh && (
              <div className="ch-agents" role="listbox" aria-label="Pick an agent">
                {agents.map(a => (
                  <button key={a.id} role="option" aria-selected={a.id === agent.id} className="ch-item" onClick={() => newChat(a)}>
                    <AgentIc a={a} /><span className="ch-t"><b>{a.name}</b><small>{a.role ? a.role.split(/[.:\n]/)[0].slice(0, 50) : "AI agent"}</small></span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {isMika && <button className="btn sm" onClick={() => setShowHelp(h => !h)} aria-expanded={showHelp}><Px name="idea" /> What can {MANAGER} do?</button>}
          <button className="x" onClick={onClose} aria-label="Close"><Px name="close" size="1em" /></button>
        </div>

        <div className="dbody" ref={body}>
          {err && <div className="note bad">{err}</div>}
          {msgs === null ? <div className="loading"><span className="spinner" /> Opening chat…</div> : (
            <div className="thread">
              {msgs.length === 0 && !sending && !isMika && (
                <div className="ch-hello"><AgentIc a={agent} /><b>Chat with {agent.name}</b><span>Share an idea, ask for an opinion, or ask for an example.</span></div>
              )}
              {msgs.map(m => (
                <div key={m.id} className={`msg ${m.mine ? "me" : "bot"}`}>
                  <div className="from"><span>{m.mine ? "You" : <>{agent.emoji ? <Emo e={agent.emoji} /> : null} {agent.name}</>}</span><span>{m.when}</span></div>
                  {m.text && <div className="md">{md(m.text)}</div>}
                  {m.failed && <div className="note bad">{m.failed}</div>}
                  {m.files.map(f => <FilePreview key={f.id} f={f} />)}
                </div>
              ))}
              {sending !== null && <div className="msg me sending"><div className="from"><span>You</span><span><span className="spinner sm" /> sending…</span></div>{sending && <div className="md">{md(sending)}</div>}</div>}
              {isMika && !sending && (msgs.length === 0 || showHelp) && (
                <div className="mikahelp">
                  <b><Px name="wave" /> Hi! Here is what we can do together:</b>
                  <div className="mh-grid">
                    {MIKA_CAN.map(c => (
                      <button key={c.label} className="mh-item" onClick={() => { setText(c.prompt); setShowHelp(false); document.getElementById("chat-msg")?.focus(); }}>
                        <span className="mh-ic"><Px name={c.icon} /></span><span><b>{c.label}</b><small>{c.hint}</small></span>
                      </button>
                    ))}
                  </div>
                  <small className="mh-foot">Pick one to start. You can edit the message before sending it.</small>
                </div>
              )}
              {working && sending === null && (
                <div className="live live-running" role="status"><span className="dots"><i /><i /><i /></span>
                  {laptopOn ? `${agent.name} is typing…` : <><Px name="moon" /> Laptop off. {agent.name} replies when it is back on.</>}</div>
              )}
            </div>
          )}
        </div>

        <div className="compose">
          {lastReply && (
            <div className="chiprow proceed">
              <span className="hint">Happy with it?</span>
              <button className="btn sm" onClick={() => onMakeTask(lastReply, agent.id)}><Px name="todo" /> Turn into a task for {agent.name}</button>
              {isMika && <button className="btn sm" disabled={!!sending || working} onClick={() => send("OK, proceed. Please split what we discussed into tasks for the right agents (with due dates and who should review), create them, then list the tasks you created.")}><Px name="todo" /> Ask {MANAGER} to split it into team tasks</button>}
            </div>
          )}
          <GrowText id="chat-msg" value={text} onChange={e => setText(e.target.value)} placeholder={`Message ${agent.name}…`}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
            onPaste={e => { const p = [...e.clipboardData.files]; if (p.length) { e.preventDefault(); setFiles([...files, ...p]); } }} />
          <FilePicker files={files} onChange={setFiles} />
          <div className="row">
            <span className="hint">Cmd+Enter to send</span>
            <button className="btn primary" disabled={(!text.trim() && !files.length) || sending !== null} onClick={() => send()}>{sending !== null ? <><span className="spinner sm" /> Sending…</> : "Send"}</button>
          </div>
        </div>
      </section>
    </div>
  );
}
