"use client";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { Board, Card } from "@/lib/crew";
import { COLS, type Col } from "@/lib/board-cols";
import { Px, Emo, PxText } from "../pixel-icon";
import CharacterFace from "../character-face";
import { useOfficeSync } from "../use-office-sync";

const TaskPanel = dynamic(() => import("../task-panel"), { ssr: false });
const NewProject = dynamic(() => import("../new-project"), { ssr: false });

const LOOSE = "none";

function CardItem({ c, showProject, onOpen, draggable }: { c: Card; showProject: boolean; onOpen: () => void; draggable: boolean }) {
  return (
    <button className={`kcard ${c.dueFlag ?? ""}`} onClick={onOpen} draggable={draggable} onDragStart={e => { e.dataTransfer.setData("text/task-id", c.id); e.dataTransfer.effectAllowed = "move"; }}>
      <b className="kc-t"><PxText text={c.title} /></b>
      {showProject && <span className="kc-proj">{c.project ? <>{c.projectIcon ? <Emo e={c.projectIcon} /> : <Px name="folder" />} {c.project}</> : <><Px name="loose" /> No project</>}</span>}
      <span className="kc-foot">
        {c.who ? <span className={`kc-who ${c.who.kind}`}><i>{c.who.face ? <CharacterFace face={c.who.face} size={20} shape="circle" /> : c.who.name.slice(0, 1).toUpperCase()}</i>{c.who.name}</span>
          : <span className="kc-who none"><i>?</i>Unassigned</span>}
        {c.dueText && <span className={`due ${c.dueFlag ?? "ok"}`}>{c.dueFlag === "late" ? <><Px name="dot-late" /> </> : c.dueFlag === "risk" ? <><Px name="dot-risk" /> </> : <><Px name="calendar" /> </>}{c.dueText}</span>}
      </span>
    </button>
  );
}

function NewCard({ board, project, onDone }: { board: Board; project: string; onDone: (id: string | null) => void }) {
  const [title, setTitle] = useState(""); const [detail, setDetail] = useState("");
  const [who, setWho] = useState(""); const [due, setDue] = useState("");
  const [proj, setProj] = useState(project === "all" ? (board.projects[0]?.id ?? "") : project === LOOSE ? "" : project);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function submit(now: boolean) {
    setBusy(true); setErr(null);
    try {
      const [type, id] = who ? who.split(":") : [null, null];
      const r = await fetch("/api/task", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ws: board.workspaceId, title, detail, due, projectId: proj, now, assigneeType: type, assigneeId: id }) });
      const j = await r.json(); if (j.error) throw new Error(j.error);
      onDone(j.id);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  return (
    <>
      <div className="scrim" onClick={() => onDone(null)} />
      <form className="modal" role="dialog" aria-modal="true" aria-label="New task" onSubmit={e => { e.preventDefault(); submit(true); }}>
        <h2><Px name="edit" /> New task</h2>
        <input className="input" autoFocus placeholder="What needs doing? e.g. Tidy up the button components" value={title} onChange={e => setTitle(e.target.value)} aria-label="Title" />
        <textarea className="input" rows={4} placeholder="Details or instructions (optional)" value={detail} onChange={e => setDetail(e.target.value)} aria-label="Details" />
        <div className="formgrid">
          <label>Who takes it?
            <select className="input" value={who} onChange={e => setWho(e.target.value)}>
              <option value="">Nobody yet (decide later)</option>
              <optgroup label="AI agents">{board.people.filter(p => p.kind === "agent").map(p => <option key={p.id} value={`agent:${p.id}`}>{p.name}</option>)}</optgroup>
              <optgroup label="People">{board.people.filter(p => p.kind === "member").map(p => <option key={p.id} value={`member:${p.id}`}>{p.name}</option>)}</optgroup>
            </select>
          </label>
          <label>Project
            <select className="input" value={proj} onChange={e => setProj(e.target.value)}>
              {board.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              <option value="">No project</option>
            </select>
          </label>
          <label>Due date<input className="input" type="date" value={due} onChange={e => setDue(e.target.value)} /></label>
        </div>
        {who.startsWith("agent:") && <p className="hint">“Start now” puts it in the agent’s queue right away. “Save for later” parks it in Backlog.</p>}
        {err && <div className="note bad">{err}</div>}
        <div className="row">
          <button type="button" className="btn" onClick={() => onDone(null)}>Cancel</button>
          <button type="button" className="btn" disabled={(!title.trim() && !detail.trim()) || busy} onClick={() => submit(false)}>Save for later</button>
          <button className="btn primary" disabled={(!title.trim() && !detail.trim()) || busy}>{busy ? <><span className="spinner sm" /> Saving…</> : <><Px name="rocket" /> Start now</>}</button>
        </div>
      </form>
    </>
  );
}

export default function BoardView({ board, initialProject }: { board: Board; initialProject: string }) {
  const router = useRouter();
  const [refreshing, start] = useTransition();
  const refresh = useCallback(() => start(() => router.refresh()), [router]);
  const [proj, setProj] = useState(initialProject);
  const [dropCol, setDropCol] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [moveNotice, setMoveNotice] = useState("");
  const [optimisticCols, setOptimisticCols] = useState<Record<string, Col>>({});
  useEffect(() => { setOptimisticCols({}); }, [board.cards]);

  const effectiveCards = useMemo(
    () => board.cards.map(c => (optimisticCols[c.id] ? { ...c, col: optimisticCols[c.id] } : c)),
    [board.cards, optimisticCols]
  );

  async function moveCard(id: string, status: string) {
    const targetCol = status as Col;
    const card = effectiveCards.find(c => c.id === id);
    if (moving || !card || card.col === targetCol) return;
    // Optimistically move card immediately in UI; roll back automatically if API rejects.
    setOptimisticCols(cur => ({ ...cur, [id]: targetCol }));
    setMoving(true);
    setDropCol(null);
    setMoveNotice(`Moved "${card.title}"…`);
    try {
      const res = await fetch(`/api/task/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ws: board.workspaceId, action: status === "done" ? "approve" : "move", status }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Could not move task");
      setMoveNotice("Task moved.");
      refresh();
    } catch (e) {
      setOptimisticCols(cur => {
        const next = { ...cur };
        delete next[id];
        return next;
      });
      setMoveNotice(e instanceof Error ? e.message : "Could not move task");
    } finally {
      setMoving(false);
      setDropCol(null);
    }
  }
  const [who, setWho] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newProject, setNewProject] = useState(false);
  const { liveConnected } = useOfficeSync(board.workspaceId, refresh);
  // Keep the chosen project in the URL so it can be shared or reloaded.
  useEffect(() => {
    const u = new URL(location.href);
    if (proj === "all") u.searchParams.delete("p"); else u.searchParams.set("p", proj);
    history.replaceState(null, "", u);
  }, [proj]);

  const shown = useMemo(() => effectiveCards.filter(c =>
    (proj === "all" || (proj === LOOSE ? !c.projectId : c.projectId === proj)) &&
    (who === "all" || (who === "agents" ? c.who?.kind === "agent" : who === "humans" ? c.who?.kind === "member" : who === "nobody" ? !c.who : c.who?.id === who))
  ), [effectiveCards, proj, who]);
  const current = board.projects.find(p => p.id === proj);
  const total = effectiveCards.filter(c => c.col !== "done").length;

  return (
    <>
      <header className="top">
        <div className="wrap hbar">
          <div className="brand"><h1><Px name="board" /> Task Board</h1><p className="pdesc">Every task in this workspace, by project.</p></div>
          <div className="chiprow">
            <button className="btn primary" onClick={() => setAdding(true)}><Px name="plus" size="0.9em" /> New task</button>
            <span className="clock">
              {liveConnected && <i className="live-sse-dot" title="Real-time SSE connected" />}
              {refreshing ? <><span className="spinner sm" /> Refreshing…</> : `${total} open task${total === 1 ? "" : "s"}`}
            </span>
          </div>
        </div>
      </header>
      <main className="wrap pagewide">
        <nav className="projtabs" aria-label="Pick a project">
          <button className="ptab" aria-pressed={proj === "all"} onClick={() => setProj("all")}>
            <span className="pt-ic"><Px name="all" /></span><span className="pt-t"><b>All</b><small>{total} open</small></span>
          </button>
          {board.projects.map(p => (
            <button key={p.id} className="ptab" aria-pressed={proj === p.id} onClick={() => setProj(p.id)}>
              <span className="pt-ic">{p.icon ? <Emo e={p.icon} /> : <Px name="folder" />}</span>
              <span className="pt-t"><b>{p.name}</b><small>{p.done}/{p.total} done</small></span>
              <span className="pt-bar" aria-hidden><i style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} /></span>
            </button>
          ))}
          <button className="ptab" aria-pressed={proj === LOOSE} onClick={() => setProj(LOOSE)}>
            <span className="pt-ic"><Px name="loose" /></span><span className="pt-t"><b>No project</b><small>{board.loose} open</small></span>
          </button>
          <button className="ptab ptab-new" onClick={() => setNewProject(true)}>
            <span className="pt-ic"><Px name="plus" /></span><span className="pt-t"><b>New project</b><small>group tasks under a goal</small></span>
          </button>
        </nav>

        <div className="boardbar">
          <p className="desc">
            {proj === "all" ? `${total} open across ${board.projects.length} project${board.projects.length === 1 ? "" : "s"}, plus ${board.loose} without one.` :
              proj === LOOSE ? "Loose tasks that don't belong to a project yet." :
              current ? <>{current.icon ? <><Emo e={current.icon} /> </> : null}{`${current.name}: ${current.open} open, ${current.done} done${current.due ? ` · due ${new Date(current.due + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}.`}</> : ""}
          </p>
          <label className="whofilter">Show tasks for
            <select className="input" value={who} onChange={e => setWho(e.target.value)}>
              <option value="all">everyone</option>
              <option value="agents">All agents</option>
              <option value="humans">All people</option>
              <option value="nobody">Unassigned</option>
              {board.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>

        <p role="status" className="hint">{moveNotice || "Drag tasks between columns. Open a task to start or stop active work."}</p><div className="kanban" aria-busy={moving}>
          {COLS.map(col => {
            const cs = shown.filter(c => c.col === col.id);
            const list = col.id === "done" ? cs.slice(0, 20) : cs;
            return (
              <section key={col.id} className={`kcol c-${col.id} ${dropCol === col.id ? "drop-target" : ""}`} aria-label={col.title} onDragOver={e => { if (!moving) { e.preventDefault(); setDropCol(col.id); } }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropCol(null); }} onDrop={e => { e.preventDefault(); setDropCol(null); void moveCard(e.dataTransfer.getData("text/task-id"), col.id); }}>
                <div className="kc-head"><b><Px name={col.icon} /> {col.title}</b><span className="count">{cs.length}</span><small>{col.sub}</small></div>
                <div className="kc-list">
                  {list.map(c => { const locked = c.col === "in_progress" || c.col === "done"; return <div key={c.id} className="movable-card"><CardItem c={c} showProject={proj === "all"} onOpen={() => setOpen(c.id)} draggable={!locked} /><select aria-label={`Move ${c.title} to column`} value="" disabled={moving || locked} onChange={e => void moveCard(c.id, e.target.value)}><option value="">Move to…</option>{COLS.filter(x => x.id !== c.col && x.id !== "in_progress").map(x => <option key={x.id} value={x.id}>{x.title}</option>)}</select></div>; })}
                  {!cs.length && <p className="kc-empty">{col.id === "in_review" ? <>Nothing to review <Px name="coffee" /></> : col.id === "done" ? "Nothing finished yet. Keep going!" : "Empty"}</p>}
                </div>
              </section>
            );
          })}
        </div>
      </main>
      {newProject && <NewProject ws={board.workspaceId} people={board.people} onDone={id => { setNewProject(false); if (id) { setProj(id); refresh(); } }} />}
      {adding && <NewCard board={board} project={proj} onDone={id => { setAdding(false); refresh(); if (id) setOpen(id); }} />}
      {open && <div className="scrim" onClick={() => setOpen(null)} />}
      {open && <TaskPanel id={open} ws={board.workspaceId} onClose={() => setOpen(null)} onChanged={refresh} />}
    </>
  );
}
