"use client";
import { useMemo, useState } from "react";
import type { Desk, Office, TaskView } from "@/lib/office";
import { buildStandupSummary } from "@/lib/munder-workflows";
import CharacterFace from "./character-face";
import { Px, PxText } from "./pixel-icon";

export default function StandupModal({
  desks,
  participants,
  attention,
  managerName,
  onOpenTask,
  onAskManager,
  onClose,
}: {
  desks: Desk[];
  participants: Desk[];
  attention: Office["attention"];
  managerName: string;
  onOpenTask: (t: TaskView) => void;
  onAskManager: (prompt: string) => void;
  onClose: () => void;
}) {
  const [focus, setFocus] = useState("");
  const summary = useMemo(
    () =>
      buildStandupSummary(
        desks.map(d => ({
          agentId: d.agentId,
          name: d.name,
          description: d.description,
          squad: d.squad,
          state: d.state,
          bubble: d.bubble,
        })),
        {
          overdue: attention.overdue.length,
          review: attention.review.length,
          failed: attention.failed.length,
        }
      ),
    [desks, attention]
  );

  function launchWithManager() {
    const prompt = focus.trim()
      ? `${summary.promptText}\n\nAdditional focus for this standup: ${focus.trim()}`
      : summary.promptText;
    onAskManager(prompt);
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section className="modal standup-modal" role="dialog" aria-modal="true" aria-label="Team Standup Huddle">
        <div className="standup-head">
          <div>
            <span className="hlabel">Meeting Area · Live Huddle</span>
            <h2><Px name="team" /> Team Standup</h2>
          </div>
          <button type="button" className="x" onClick={onClose} aria-label="End standup">
            <Px name="close" size="1em" />
          </button>
        </div>

        <div className="standup-cast" aria-label="Agents gathered in meeting room">
          {participants.map(p => (
            <span key={p.agentId} className={`standup-chip st-${p.state}`}>
              <CharacterFace face={p.face} size={28} />
              <span>
                <b>{p.name}</b>
                <small>{p.state === "working" ? "Working" : p.state === "review" ? "Needs review" : p.squad}</small>
              </span>
            </span>
          ))}
        </div>

        <div className="standup-grid">
          <div className="standup-col">
            <div className="sect"><Px name="doing" /> Working now ({summary.working.length})</div>
            {summary.working.length ? (
              <ul>
                {summary.working.map(d => (
                  <li key={d.agentId}><b>{d.name}</b><small>{d.bubble}</small></li>
                ))}
              </ul>
            ) : (
              <p className="desc">No agents actively running right now.</p>
            )}
          </div>

          <div className="standup-col">
            <div className="sect"><Px name="eyes" /> Waiting &amp; blocked ({attention.review.length + attention.overdue.length})</div>
            {attention.review.length + attention.overdue.length > 0 ? (
              <ul>
                {[...attention.review, ...attention.overdue].slice(0, 5).map(t => (
                  <li key={t.id}>
                    <button type="button" className="standup-task" onClick={() => onOpenTask(t)}>
                      <b><PxText text={t.title} /></b>
                      <small>{t.assignee ?? "Unassigned"}{t.dueText ? ` · ${t.dueText}` : ""}</small>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="desc">All clear — nothing waiting on review.</p>
            )}
          </div>

          <div className="standup-col">
            <div className="sect"><Px name="sparkle" /> Ready &amp; free ({summary.available.length})</div>
            {summary.available.length ? (
              <ul>
                {summary.available.map(d => (
                  <li key={d.agentId}><b>{d.name}</b><small>{d.squad}</small></li>
                ))}
              </ul>
            ) : (
              <p className="desc">Everyone is currently occupied.</p>
            )}
          </div>
        </div>

        <label className="standup-focus">
          <span className="sect">Agenda or focus note (optional)</span>
          <input
            className="input"
            value={focus}
            onChange={e => setFocus(e.target.value)}
            placeholder="e.g. Prioritize launch landing page and unblock copywriting…"
          />
        </label>

        <div className="row">
          <button type="button" className="btn" onClick={onClose}>
            Wrap up &amp; return to desks
          </button>
          <button type="button" className="btn primary" onClick={launchWithManager}>
            <Px name="chat" /> Ask {managerName} to plan next steps
          </button>
        </div>
      </section>
    </>
  );
}
