"use client";
import { useState } from "react";
import type { TaskView } from "@/lib/office";
import type { ActivityEvent } from "@/lib/munder-workflows";
import { Px, PxText, type PxName } from "./pixel-icon";

const EVENT_ICON: Record<ActivityEvent["kind"], PxName> = {
  handoff: "mail",
  approve: "done",
  revise: "edit",
  delegate: "rocket",
  standup: "team",
  coffee: "coffee",
  door: "office",
  drag: "wave",
  chain: "play",
  watchdog: "alert",
  schedule: "clock",
};

export function QuickApprovalBar({
  items,
  onApprove,
  onRevise,
  onOpenTask,
}: {
  items: TaskView[];
  onApprove: (t: TaskView) => Promise<void>;
  onRevise: (t: TaskView, feedback: string) => Promise<void>;
  onOpenTask: (t: TaskView) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [index, setIndex] = useState(0);
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!items.length) return null;
  const current = items[Math.min(index, items.length - 1)];
  const hasOpenQuestions = (current.questionCount ?? 0) > 0;

  if (collapsed) {
    return (
      <button type="button" className="hud-pill hud-approve-pill" onClick={() => setCollapsed(false)}>
        <Px name="eyes" />
        <span>Review queue</span>
        <b>{items.length}</b>
      </button>
    );
  }

  async function handleApprove() {
    setBusy(true);
    setErr(null);
    try {
      await onApprove(current);
      setRevising(false);
      setFeedback("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleRevise(e: React.FormEvent) {
    e.preventDefault();
    if (!feedback.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await onRevise(current, feedback.trim());
      setRevising(false);
      setFeedback("");
    } catch (errVal) {
      setErr(errVal instanceof Error ? errVal.message : String(errVal));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="hud-approve" aria-label="Quick approval queue">
      <div className="hud-approve-head">
        <span className="hud-kicker">
          <Px name={hasOpenQuestions ? "person" : "eyes"} /> {hasOpenQuestions ? "Needs decision" : "Needs review"}
          <b>{Math.min(index, items.length - 1) + 1}/{items.length}</b>
        </span>
        <div className="hud-pager">
          {items.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous review item"
                onClick={() => { setIndex(i => (i - 1 + items.length) % items.length); setRevising(false); setErr(null); }}
              >←</button>
              <button
                type="button"
                aria-label="Next review item"
                onClick={() => { setIndex(i => (i + 1) % items.length); setRevising(false); setErr(null); }}
              >→</button>
            </>
          )}
          <button type="button" aria-label="Minimize review bar" onClick={() => setCollapsed(true)}>–</button>
        </div>
      </div>

      <button type="button" className="hud-approve-title" onClick={() => onOpenTask(current)}>
        <b><PxText text={current.title} /></b>
        <small>{current.assignee ?? "Agent"}{current.project ? ` · ${current.project}` : ""}</small>
      </button>

      {current.summary && current.summary.length > 0 && (
        <ul className="hud-summary" aria-label="Agent summary preview">
          {current.summary.slice(0, 2).map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}

      {hasOpenQuestions && (
        <div className="hud-q-guard" role="note">
          <Px name="alert" /> {current.questionCount} open question{current.questionCount === 1 ? "" : "s"} — answer before approving.
        </div>
      )}

      {revising ? (
        <form className="hud-revise-form" onSubmit={handleRevise}>
          <input
            className="input"
            autoFocus
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            placeholder="Write quick revision notes…"
            disabled={busy}
          />
          <div className="hud-approve-actions">
            <button type="button" className="btn sm" disabled={busy} onClick={() => { setRevising(false); setErr(null); }}>Cancel</button>
            <button type="submit" className="btn sm primary" disabled={busy || !feedback.trim()}>
              {busy ? "Sending…" : "Send changes"}
            </button>
          </div>
        </form>
      ) : (
        <div className="hud-approve-actions">
          {hasOpenQuestions ? (
            <button type="button" className="btn sm primary" onClick={() => onOpenTask(current)}>
              <Px name="chat" /> Answer &amp; Inspect
            </button>
          ) : (
            <button type="button" className="btn sm primary" disabled={busy} onClick={handleApprove}>
              {busy ? <><span className="spinner sm" /> Approving…</> : <><Px name="check" /> Approve</>}
            </button>
          )}
          <button type="button" className="btn sm" disabled={busy} onClick={() => setRevising(true)}>
            <Px name="edit" /> Revise
          </button>
          {!hasOpenQuestions && (
            <button type="button" className="btn sm ghost" onClick={() => onOpenTask(current)}>
              Inspect
            </button>
          )}
        </div>
      )}
      {err && <p className="hud-err" role="alert">{err}</p>}
    </aside>
  );
}

export function LiveActivityFeed({
  events,
  open,
  onToggle,
  onSelectEvent,
}: {
  events: ActivityEvent[];
  open: boolean;
  onToggle: () => void;
  onSelectEvent: (ev: ActivityEvent) => void;
}) {
  return (
    <div className="hud-feed-wrap">
      <button
        type="button"
        className={`hud-pill hud-feed-pill${open ? " is-open" : ""}`}
        aria-expanded={open}
        onClick={onToggle}
      >
        <i className="hud-live-dot" aria-hidden="true" />
        <span>Office Feed</span>
        {events.length > 0 && <b>{events.length}</b>}
      </button>

      {open && (
        <section className="hud-feed" aria-label="Live office activity feed">
          <header>
            <b>Live Activity</b>
            <small>Persisted handoffs, chains &amp; watchdog</small>
            <button type="button" aria-label="Close activity feed" onClick={onToggle}>×</button>
          </header>
          {events.length === 0 ? (
            <p className="hud-feed-empty">Quiet floor right now. Delegate a goal, drag an agent, or start a standup to see live office activity.</p>
          ) : (
            <ul>
              {events.map(ev => (
                <li key={ev.id}>
                  <button type="button" onClick={() => onSelectEvent(ev)}>
                    <span className="hud-ev-ic" aria-hidden="true"><Px name={EVENT_ICON[ev.kind] ?? "mail"} /></span>
                    <span className="hud-ev-txt">
                      <b>{ev.title}</b>
                      {ev.detail && <small>{ev.detail}</small>}
                    </span>
                    <time>{ev.at}</time>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
