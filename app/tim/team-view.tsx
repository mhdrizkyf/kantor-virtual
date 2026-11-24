"use client";
import { useCallback, useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Team, Mate, Load } from "@/lib/crew";
import TaskPanel from "../task-panel";
import ChatPanel, { isManager } from "../chat-panel";
import { openChat } from "../messages";
import { Px, Emo, PxText, StateIcon, type PxName } from "../pixel-icon";
import { GrowText } from "../auto-grow";
import CharacterFace from "../character-face";
import CharacterPicker from "../character-picker";
import WorkflowHubModal from "../workflow-hub-modal";
import { useVisiblePoll } from "../visible-poll";

const LEVEL: Record<Load["level"], { icon: PxName; label: string; tip: string }> = {
  santai: { icon: "dot-on", label: "Free", tip: "no open tasks" },
  pas: { icon: "done", label: "Steady", tip: "1–3 open tasks" },
  sibuk: { icon: "busy", label: "Busy", tip: "4–6 open tasks" },
  kewalahan: { icon: "alert", label: "Overloaded", tip: "7 or more open tasks" },
};
const COL_LABEL = { backlog: "Backlog", todo: "Ready", in_progress: "In progress", in_review: "Needs review", done: "Done" } as const;

function Engine({ m, team, onSaved }: { m: Mate; team: Team; onSaved: (msg: string) => void }) {
  const [val, setVal] = useState(m.runtimeId ?? "");
  const [busy, setBusy] = useState(false);
  async function change(id: string) {
    const prev = val; setVal(id); setBusy(true);
    try {
      const j = await (await fetch("/api/crew", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ws: team.workspaceId, agentId: m.id, runtimeId: id }) })).json();
      if (j.error) throw new Error(j.error);
      onSaved(`${m.name}: ${j.message}`);
    } catch (e) { setVal(prev); onSaved(`Couldn't switch engine: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(false); }
  }
  return (
    <label className="engine"><Px name="gear" /> AI engine
      <select className="input" value={val} disabled={busy} onChange={e => change(e.target.value)}>
        {!team.runtimes.some(r => r.id === val) && <option value="">— none —</option>}
        {team.runtimes.map(r => (
          <option key={r.id} value={r.id} disabled={!r.usable && r.id !== val}>
            {r.name}{!r.usable ? ` (private${r.owner ? ` · ${r.owner}'s laptop` : ""})` : r.online ? "" : " (offline)"}
          </option>
        ))}
      </select>
      {busy && <span className="spinner sm" />}
    </label>
  );
}

function MateCard({ m, team, onOpenTask, onChat, onToast }: { m: Mate; team: Team; onOpenTask: (id: string) => void; onChat?: () => void; onToast: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [face, setFace] = useState(m.face ?? "yusuf");
  const [savingFace, setSavingFace] = useState(false);
  useEffect(() => { if (m.face) setFace(m.face); }, [m.face]);
  const L = m.load;
  const seg = (n: number) => `${L.open ? (n / L.open) * 100 : 0}%`;
  const openTasks = m.tasks.filter(t => t.col !== "done");

  async function saveAvatar(nextFace: string) {
    const prev = face;
    setFace(nextFace);
    setSavingFace(true);
    try {
      const payload = m.kind === "human"
        ? { ws: team.workspaceId, memberId: m.id, face: nextFace }
        : { ws: team.workspaceId, agentId: m.id, face: nextFace };
      const res = await fetch("/api/crew", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Could not save avatar.");
      onToast(`${m.name}'s avatar updated.`);
    } catch (e) {
      setFace(prev);
      onToast(`Couldn't update avatar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingFace(false);
    }
  }

  return (
    <article className={`mate ${m.kind} st-${m.state}`}>
      <div className="mate-top">
        <button
          type="button"
          className="avatar avatar-edit-btn"
          title="Change avatar"
          aria-label={`Change ${m.name}'s avatar`}
          aria-expanded={avatarOpen}
          onClick={() => setAvatarOpen(v => !v)}
        >
          <CharacterFace face={face} size={48} shape="circle" />
          <span className="status-dot" />
          <span className="avatar-edit-badge" aria-hidden="true">✎</span>
        </button>
        <div className="mate-id">
          <h3>{m.name}{m.isMe && <span className="me-tag">you</span>}</h3>
          {m.kind === "human" && <small>{[m.role, m.sub].filter(Boolean).join(" · ")}</small>}
        </div>
        <span className={`lvl l-${L.level}`} title={LEVEL[L.level].tip}><Px name={LEVEL[L.level].icon} /> {LEVEL[L.level].label}</span>
      </div>
      {avatarOpen && (
        <div className="avatar-quick-tray mate-avatar-tray">
          <div className="desk-sect-head">
            <span className="sect">Choose avatar</span>
            {savingFace && <span className="spinner sm" />}
          </div>
          <CharacterPicker value={face} onChange={next => void saveAvatar(next)} />
        </div>
      )}
      {m.kind === "agent" && m.sub && <p className="mate-desc">{m.sub}</p>}
      <p className="mate-status"><StateIcon state={m.state} />{m.status}</p>

      <div className="mate-load" aria-label={`Workload: ${L.open} open`}>
        <div className="loadbar" aria-hidden>
          <i className="lb-doing" style={{ width: seg(L.doing) }} /><i className="lb-review" style={{ width: seg(L.review) }} /><i className="lb-queued" style={{ width: seg(L.queued) }} />
        </div>
        <small>
          {L.open ? <><Px name="doing" /> {L.doing} in progress · <Px name="eyes" /> {L.review} in review · <Px name="queued" /> {L.queued} queued{L.late ? <b className="late-txt"> · <Px name="dot-late" /> {L.late} late</b> : null}</> : "No open tasks"}
        </small>
      </div>

      <div className="mate-proj">
        {m.projects.length ? m.projects.map(p => (
          <Link key={p.id} className="chip" href={`/papan?ws=${team.workspaceId}&p=${p.id}`}>{p.icon ? <Emo e={p.icon} /> : <Px name="folder" />} {p.name}{p.open ? <small> · {p.open}</small> : null}</Link>
        )) : <span className="desc">Not on any project yet</span>}
      </div>

      {m.kind === "agent" && <Engine m={m} team={team} onSaved={onToast} />}

      <div className="mate-actions">
        {openTasks.length > 0 && <button className="btn sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide tasks" : <><Px name="todo" /> {openTasks.length} open task{openTasks.length > 1 ? "s" : ""}</>}</button>}
        {onChat && <button className="btn sm" onClick={onChat}><Px name="chat" /> Chat</button>}
        <button type="button" className={`btn sm${avatarOpen ? " primary" : ""}`} aria-expanded={avatarOpen} onClick={() => setAvatarOpen(v => !v)}>✎ {avatarOpen ? "Done" : "Avatar"}</button>
        {m.kind === "agent" && <button className="btn sm" onClick={() => setEdit(true)}><Px name="gear" /> Edit profile</button>}
        {m.kind === "human" && !m.isMe && <button className="btn sm" onClick={() => openChat(m.id)}><Px name="chat" /> Message</button>}
      </div>
      {open && (
        <div className="tasks">
          {openTasks.map(t => (
            <button key={t.id} className="tasklink" onClick={() => onOpenTask(t.id)}>
              <span className="t"><PxText text={t.title} /><small>{t.project ? <>{t.projectIcon ? <Emo e={t.projectIcon} /> : <Px name="folder" />} {t.project}</> : <><Px name="loose" /> No project</>}</small></span>
              <span className="meta">
                <span className={`pill p-${t.col === "in_review" ? "review" : t.col === "in_progress" ? "doing" : "queued"}`}>{COL_LABEL[t.col]}</span>
                {t.dueText && <span className={`due ${t.dueFlag ?? "ok"}`}>{t.dueText}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      {edit && <EditAgent m={m} team={team} onDone={msg => { setEdit(false); if (msg) onToast(msg); }} />}
    </article>
  );
}

type Profile = { name: string; bio: string; instructions: string; emoji: string | null; hasPhoto: boolean };

/** Edit an agent's name, avatar, short bio and responsibilities (its working instructions). */
function EditAgent({ m, team, onDone }: { m: Mate; team: Team; onDone: (msg: string | null) => void }) {
  const [p, setP] = useState<Profile | null>(null);
  const [original, setOriginal] = useState<Profile | null>(null);
  const [face, setFace] = useState(m.face ?? "raya");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`/api/crew?ws=${team.workspaceId}&agentId=${m.id}`).then(r => r.json())
      .then(j => { if (j.error) throw new Error(j.error); setP(j); setOriginal(j); }).catch(e => setErr(String(e.message ?? e)));
  }, [m.id, team.workspaceId]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onDone(null); };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [onDone]);
  const set = (k: keyof Profile, v: string) => setP(cur => cur && { ...cur, [k]: v });
  async function save() {
    if (!p) return;
    setBusy(true); setErr(null);
    try {
      const profileChanged = !original || p.name !== original.name || p.bio !== original.bio || p.instructions !== original.instructions || p.emoji !== original.emoji;
      if (!profileChanged && face === m.face) { onDone(null); return; }
      const payload = profileChanged
        ? { ws: team.workspaceId, agentId: m.id, profile: { name: p.name, bio: p.bio, instructions: p.instructions, emoji: p.emoji, face } }
        : { ws: team.workspaceId, agentId: m.id, face };
      const j = await (await fetch("/api/crew", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })).json();
      if (j.error) throw new Error(j.error);
      onDone(j.message);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  const emojis = p?.emoji && !EMOJIS.includes(p.emoji) ? [p.emoji, ...EMOJIS] : EMOJIS;
  return createPortal(
    <>
      <div className="scrim" onClick={() => onDone(null)} />
      <form className="modal editagent" role="dialog" aria-modal="true" aria-label={`Edit ${m.name}`} onSubmit={e => { e.preventDefault(); save(); }}>
        <h2><Px name="gear" /> Edit {m.name}</h2>
        {!p && !err && <div className="loading"><span className="spinner" /> Loading profile…</div>}
        {p && (
          <>
            <label className="sect" htmlFor="ea-name">Name</label>
            <input id="ea-name" className="input" value={p.name} onChange={e => set("name", e.target.value)} maxLength={80} />
            <CharacterPicker value={face} onChange={setFace} />
            {!p.hasPhoto && <details className="extra"><summary>Emoji for Multica profile</summary><div className="emojipick">{emojis.map(x => <button type="button" key={x} aria-pressed={p.emoji === x} onClick={() => set("emoji", x)} aria-label={x}><Emo e={x} /></button>)}</div></details>}
            <label className="sect" htmlFor="ea-bio">Short bio</label>
            <GrowText id="ea-bio" className="input" rows={2} maxPx={160} value={p.bio} onChange={e => set("bio", e.target.value)} maxLength={300}
              placeholder="One or two lines shown on their card, e.g. Supports the whole research team: coaching, competency framework, team issues" />
            <label className="sect" htmlFor="ea-instr">Responsibilities and how they work</label>
            <GrowText id="ea-instr" className="input" rows={8} maxPx={420} value={p.instructions} onChange={e => set("instructions", e.target.value)}
              placeholder="Who they are, what they are responsible for, how they should work and reply." />
            <p className="hint">This is what the agent reads before every task, so changes apply from their next task or chat. The Virtual Office report and reminder rules are kept automatically.</p>
          </>
        )}
        {err && <div className="note bad">{err}</div>}
        <div className="row">
          <button type="button" className="btn" onClick={() => onDone(null)}>Cancel</button>
          <button className="btn primary" disabled={!p || busy || !p.name.trim()}>{busy ? <><span className="spinner sm" /> Saving…</> : <><Px name="done" /> Save</>}</button>
        </div>
      </form>
    </>, document.body);
}

const EMOJIS = ["🦊", "🐼", "🦉", "🐙", "🦄", "🐝", "🐢", "🦜", "🐳", "🦁", "🐨", "🤖"];

function Recruit({ team, onDone }: { team: Team; onDone: (msg: string | null) => void }) {
  const [kind, setKind] = useState<"human" | "agent" | null>(null);
  const [email, setEmail] = useState(""); const [role, setRole] = useState<"member" | "admin">("member");
  const [name, setName] = useState(""); const [emoji, setEmoji] = useState("🦊"); const [face, setFace] = useState("raya"); const [desc, setDesc] = useState("");
  const [instr, setInstr] = useState(""); const [rt, setRt] = useState(team.runtimes.find(r => r.usable && r.online)?.id ?? team.runtimes.find(r => r.usable)?.id ?? "");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setErr(null);
    try {
      const body = kind === "human" ? { ws: team.workspaceId, kind, email, role } : { ws: team.workspaceId, kind, name, emoji, face, role: desc, instructions: instr, runtimeId: rt };
      const j = await (await fetch("/api/crew", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
      if (j.error) throw new Error(j.error);
      onDone(j.message);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <>
      <div className="scrim" onClick={() => onDone(null)} />
      <form className="modal" role="dialog" aria-modal="true" aria-label="Add to team" onSubmit={e => { e.preventDefault(); submit(); }}>
        <h2><Px name="sparkle" /> Add to the team</h2>
        {!kind ? (
          <>
            <p className="desc">Who do you want to add to {team.workspace}?</p>
            <div className="pickkind">
              <button type="button" onClick={() => setKind("human")}><span><Px name="mail" /></span><b>Invite a person</b><small>Send an email invite. They can assign tasks, review, and be @mentioned.</small></button>
              <button type="button" onClick={() => setKind("agent")}><span><Px name="agent" /></span><b>Create an AI agent</b><small>A new AI teammate with its own role, ready for tasks.</small></button>
            </div>
          </>
        ) : kind === "human" ? (
          <>
            <label className="sect" htmlFor="rc-email">Email</label>
            <input id="rc-email" className="input" type="email" autoFocus placeholder="name@example.com" value={email} onChange={e => setEmail(e.target.value)} />
            <div className="chiprow">
              <label className="radio"><input type="radio" checked={role === "member"} onChange={() => setRole("member")} /> Member</label>
              <label className="radio"><input type="radio" checked={role === "admin"} onChange={() => setRole("admin")} /> Admin (can manage team & settings)</label>
            </div>
            <p className="hint">They get an email invite and show up under People once they accept.</p>
          </>
        ) : (
          <>
            <label className="sect" htmlFor="rc-name">Agent name</label>
            <input id="rc-name" className="input" autoFocus placeholder="e.g. Rara Research" value={name} onChange={e => setName(e.target.value)} />
            <CharacterPicker value={face} onChange={setFace} />
            <details className="extra"><summary>Emoji for Multica profile</summary><div className="emojipick">{EMOJIS.map(x => <button type="button" key={x} aria-pressed={emoji === x} onClick={() => setEmoji(x)} aria-label={x}><Emo e={x} /></button>)}</div></details>
            <label className="sect" htmlFor="rc-desc">What do they do?</label>
            <input id="rc-desc" className="input" placeholder="e.g. UX researcher who summarises user interviews" value={desc} onChange={e => setDesc(e.target.value)} />
            <details className="extra"><summary>Working instructions (optional)</summary>
              <textarea className="input" rows={5} placeholder="Leave empty to use default instructions based on the role." value={instr} onChange={e => setInstr(e.target.value)} />
            </details>
            <label className="sect" htmlFor="rc-rt">AI engine</label>
            <select id="rc-rt" className="input" value={rt} onChange={e => setRt(e.target.value)}>
              {team.runtimes.filter(r => r.usable).map(r => <option key={r.id} value={r.id}>{r.name}{r.online ? "" : " (offline)"}</option>)}
            </select>
            {!team.runtimes.some(r => r.usable) && <p className="note bad">None of the AI engines here are yours, so you can&apos;t create an agent yet. Connect your own laptop in Multica Desktop first.</p>}
          </>
        )}
        {err && <div className="note bad">{err}</div>}
        <div className="row">
          {kind && <button type="button" className="btn" onClick={() => { setKind(null); setErr(null); }}><Px name="back" size="0.8em" /> Back</button>}
          <button type="button" className="btn" onClick={() => onDone(null)}>Cancel</button>
          {kind && <button className="btn primary" disabled={busy || (kind === "human" ? !email.trim() : !name.trim() || !rt)}>
            {busy ? <><span className="spinner sm" /> Working…</> : kind === "human" ? <><Px name="mail" /> Send invite</> : <><Px name="sparkle" /> Create agent</>}</button>}
        </div>
      </form>
    </>
  );
}

export default function TeamView({ team }: { team: Team }) {
  const router = useRouter();
  const [refreshing, start] = useTransition();
  const refresh = useCallback(() => start(() => router.refresh()), [router]);
  const [tab, setTab] = useState<"all" | "human" | "agent">("all");
  const [task, setTask] = useState<string | null>(null);
  const [chat, setChat] = useState<Mate | null>(null);
  const [recruit, setRecruit] = useState(false);
  const [hubOpen, setHubOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [instrHealth, setInstrHealth] = useState<{ outdatedCount: number; agents: { agentId: string; name: string; upToDate: boolean; changed: string[] }[] } | null>(null);
  const [syncingInstr, setSyncingInstr] = useState(false);

  useEffect(() => {
    if (!team.agents.length) return;
    fetch(`/api/crew/sync-instructions?ws=${encodeURIComponent(team.workspaceId)}`)
      .then(r => r.json())
      .then(j => { if (typeof j.outdatedCount === "number") setInstrHealth(j); })
      .catch(() => {});
  }, [team.workspaceId, team.agents.length]);

  async function syncAllInstructions() {
    setSyncingInstr(true);
    try {
      const r = await fetch("/api/crew/sync-instructions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ws: team.workspaceId }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || "Could not sync agent instructions.");
      const updatedN = (j.updated ?? []).length;
      const failedN = (j.failed ?? []).length;
      setToast(
        updatedN
          ? `Synced Virtual Office rules for ${updatedN} agent${updatedN === 1 ? "" : "s"}${failedN ? ` (${failedN} failed)` : ""}.`
          : "All agent instructions are already up to date."
      );
      const check = await fetch(`/api/crew/sync-instructions?ws=${encodeURIComponent(team.workspaceId)}`).then(x => x.json()).catch(() => null);
      if (check && typeof check.outdatedCount === "number") setInstrHealth(check);
    } catch (e) {
      setToast(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncingInstr(false);
    }
  }

  useVisiblePoll(refresh, 60_000);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); }, [toast]);

  const busy = [...team.humans, ...team.agents].filter(m => m.load.level === "kewalahan" || m.load.late > 0);
  return (
    <>
      <header className="top">
        <div className="wrap hbar">
          <div className="brand"><h1><Px name="team" /> Team Members</h1><p className="pdesc">Who works here, how busy they are, and which projects they&apos;re on.</p></div>
          <div className="chiprow">
            <button className="btn" onClick={() => setHubOpen(true)}><Px name="sparkle" size="0.9em" /> Insights</button>
            <button className="btn primary" onClick={() => setRecruit(true)}><Px name="plus" size="0.9em" /> Add to team</button>
            <span className="clock">{refreshing ? <><span className="spinner sm" /> Refreshing…</> : `${team.humans.length} ${team.humans.length === 1 ? "person" : "people"} · ${team.agents.length} agent${team.agents.length === 1 ? "" : "s"}`}</span>
          </div>
        </div>
      </header>
      <main className="wrap pagewide">
        {busy.length > 0 && <div className="note"><span><Px name="busy" /> Could use a hand: {busy.map(m => `${m.name} (${m.load.late ? `${m.load.late} late` : LEVEL[m.load.level].label})`).join(", ")}. Try moving some tasks to someone else.</span></div>}
        {instrHealth && instrHealth.outdatedCount > 0 && (
          <div className="note instr-health-bar">
            <span>
              <Px name="gear" /> <b>{instrHealth.outdatedCount} agent{instrHealth.outdatedCount === 1 ? "" : "s"}</b> missing latest Virtual Office rules (report format, reminders, drafts):{" "}
              {instrHealth.agents.filter(a => !a.upToDate).slice(0, 5).map(a => a.name).join(", ")}
            </span>
            <button type="button" className="btn sm primary" disabled={syncingInstr} onClick={syncAllInstructions}>
              {syncingInstr ? <><span className="spinner sm" /> Syncing…</> : <><Px name="refresh" /> Sync all rules</>}
            </button>
          </div>
        )}
        <div className="tabs" style={{ padding: 0 }}>
          {([["all", "Everyone"], ["human", `People (${team.humans.length})`], ["agent", `AI agents (${team.agents.length})`]] as const).map(([k, l]) => (
            <button key={k} className="tab" aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>

        {tab !== "agent" && (
          <section className="crew" aria-label="People">
            <h2><Px name="person" /> People <small>set direction, review, and step in when mentioned</small></h2>
            <div className="crewgrid">{team.humans.map(m => <MateCard key={m.id} m={m} team={team} onOpenTask={setTask} onToast={msg => { setToast(msg); refresh(); }} />)}</div>
            {team.invites.length > 0 && (
              <div className="invites"><b><Px name="mail" /> Pending invites</b>
                <ul>{team.invites.map(i => <li key={i.email}>{i.email} <small>· {i.role} · sent {i.when}</small></li>)}</ul>
              </div>
            )}
          </section>
        )}
        {tab !== "human" && (
          <section className="crew" aria-label="AI agents">
            <h2><Px name="agent" /> AI agents <small>jump in as soon as they&apos;re called</small></h2>
            <div className="crewgrid">{team.agents.map(m => <MateCard key={m.id} m={m} team={team} onOpenTask={setTask} onChat={() => setChat(m)} onToast={msg => { setToast(msg); refresh(); }} />)}</div>
            {!team.agents.length && <p className="desc">No agents yet. Press “+ Add to team” to create the first one.</p>}
          </section>
        )}
      </main>
      {recruit && <Recruit team={team} onDone={msg => { setRecruit(false); if (msg) { setToast(msg); refresh(); } }} />}
      {hubOpen && (
        <WorkflowHubModal
          ws={team.workspaceId}
          workspaceName={team.workspace}
          initialTab="metrics"
          onOpenTask={id => setTask(id)}
          onClose={() => setHubOpen(false)}
        />
      )}
      {task && <div className="scrim" onClick={() => setTask(null)} />}
      {task && <TaskPanel id={task} ws={team.workspaceId} onClose={() => setTask(null)} onChanged={refresh} />}
      {chat && <div className="scrim" onClick={() => setChat(null)} />}
      {chat && (
        <ChatPanel ws={team.workspaceId} agent={{ id: chat.id, name: chat.name, emoji: chat.emoji, face: chat.face, role: chat.sub }}
          isMika={isManager(chat.name)} projectId={null} laptopOn={chat.runtimeOnline}
          onClose={() => setChat(null)} onMakeTask={() => { setChat(null); router.push(`/papan?ws=${team.workspaceId}`); }} />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
