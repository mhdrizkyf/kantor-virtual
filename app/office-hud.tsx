"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Desk, Office, RunView, TaskView } from "@/lib/office";
import type { ActivityEvent } from "@/lib/munder-workflows";
import {
  buildOfficeFeedItems,
  countUnreadFeedEvents,
  filterOfficeFeed,
  summarizeOfficeFeedPill,
  type OfficeFeedTab,
} from "@/lib/office-feed";
import CharacterFace from "./character-face";
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
  chat: "chat",
};

const FEED_SEEN_PREFIX = "kantor:feed-seen:";

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
  workspaceId,
  desks,
  attention,
  events,
  open,
  liveConnected,
  refreshing,
  updatedAt,
  rerunningId,
  onToggle,
  onClose,
  onRefresh,
  onApprove,
  onRetry,
  onChatAgent,
  onOpenDesk,
  onOpenTask,
  onSelectEvent,
  onOpenStandup,
  onOpenDelegate,
}: {
  workspaceId: string;
  desks: readonly Desk[];
  attention: Office["attention"];
  events: ActivityEvent[];
  open: boolean;
  liveConnected?: boolean;
  refreshing?: boolean;
  updatedAt?: string;
  rerunningId?: string | null;
  onToggle: () => void;
  onClose: () => void;
  onRefresh: () => void;
  onApprove: (t: TaskView) => Promise<void>;
  onRetry: (f: RunView) => Promise<void>;
  onChatAgent: (d: Desk) => void;
  onOpenDesk: (d: Desk) => void;
  onOpenTask: (t: { id: string; ws: string }) => void;
  onSelectEvent: (ev: ActivityEvent) => void;
  onOpenStandup: () => void;
  onOpenDelegate: () => void;
}) {
  const [tab, setTab] = useState<OfficeFeedTab>("all");
  const [query, setQuery] = useState("");
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [lastSeenId, setLastSeenId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Restore last-seen activity event per workspace so unread badge reflects truly new activity
  useEffect(() => {
    try {
      setLastSeenId(localStorage.getItem(`${FEED_SEEN_PREFIX}${workspaceId}`));
    } catch {
      setLastSeenId(null);
    }
  }, [workspaceId]);

  // Mark feed read whenever panel is open and events are loaded
  useEffect(() => {
    if (!open || !events.length) return;
    const newest = events[0].id;
    setLastSeenId(newest);
    try {
      localStorage.setItem(`${FEED_SEEN_PREFIX}${workspaceId}`, newest);
    } catch { /* ignore storage errors */ }
  }, [open, events, workspaceId]);

  // Dismiss feed panel when clicking outside
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onClose]);

  const allItems = useMemo(
    () => buildOfficeFeedItems({ desks, attention, events, wsId: workspaceId }),
    [desks, attention, events, workspaceId],
  );
  const visibleItems = useMemo(
    () => filterOfficeFeed(allItems, tab, query),
    [allItems, tab, query],
  );

  const workingCount = useMemo(() => desks.filter(d => d.state === "working").length, [desks]);
  const reviewCount = attention.review.length;
  const failedCount = attention.failed.length;
  const attentionCount = reviewCount + failedCount;
  const unreadCount = useMemo(
    () => (open ? 0 : countUnreadFeedEvents(events, lastSeenId)),
    [open, events, lastSeenId],
  );

  const pill = useMemo(
    () => summarizeOfficeFeedPill({ workingCount, reviewCount, failedCount, unreadCount }),
    [workingCount, reviewCount, failedCount, unreadCount],
  );

  async function handleInlineApprove(task: TaskView) {
    setApprovingId(task.id);
    try {
      await onApprove(task);
    } finally {
      setApprovingId(null);
    }
  }

  return (
    <div className="hud-feed-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`hud-pill hud-feed-pill is-${pill.tone}${open ? " is-open" : ""}`}
        aria-expanded={open}
        onClick={onToggle}
      >
        <i className={`hud-live-dot is-${pill.tone}`} aria-hidden="true" />
        <span>Office Feed</span>
        {pill.summary && <span className="hud-pill-meta">{pill.summary}</span>}
        {pill.badgeCount > 0 && (
          <b title={`${pill.badgeCount} aktivitas baru`}>{pill.badgeCount > 9 ? "9+" : pill.badgeCount}</b>
        )}
      </button>

      {open && (
        <section className="hud-feed" aria-label="Office Feed live hub">
          <header className="hud-feed-head">
            <div className="hud-feed-title-row">
              <b>Office Feed</b>
              <span className={`hud-live-chip${liveConnected ? " is-live" : ""}`}>
                <i aria-hidden="true" />
                {liveConnected ? "Live" : updatedAt ? `Sync ${updatedAt}` : "Sync"}
              </span>
            </div>
            <div className="hud-feed-head-actions">
              <button
                type="button"
                aria-label="Segarkan Office Feed"
                title="Segarkan sekarang"
                disabled={refreshing}
                onClick={onRefresh}
              >
                <Px name="refresh" />
              </button>
              <button type="button" aria-label="Tutup Office Feed" onClick={onClose}>×</button>
            </div>
          </header>

          <div className="hud-feed-tabs" role="tablist" aria-label="Filter Office Feed">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "all"}
              className={tab === "all" ? "is-active" : ""}
              onClick={() => setTab("all")}
            >
              Semua <em>{allItems.length}</em>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "active"}
              className={tab === "active" ? "is-active" : ""}
              onClick={() => setTab("active")}
            >
              Aktif <em>{workingCount}</em>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "attention"}
              className={tab === "attention" ? "is-active" : ""}
              onClick={() => setTab("attention")}
            >
              Review <em>{attentionCount}</em>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "history"}
              className={tab === "history" ? "is-active" : ""}
              onClick={() => setTab("history")}
            >
              Riwayat <em>{events.length}</em>
            </button>
          </div>

          <div className="hud-feed-search">
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Cari agent, task, atau aktivitas…"
              aria-label="Cari di Office Feed"
            />
            {query && (
              <button type="button" aria-label="Hapus pencarian" onClick={() => setQuery("")}>×</button>
            )}
          </div>

          {visibleItems.length === 0 ? (
            <p className="hud-feed-empty">
              {query
                ? `Tidak ada hasil untuk "${query}".`
                : tab === "active"
                  ? "Belum ada agent yang sedang mengerjakan task saat ini."
                  : tab === "attention"
                    ? "Semua beres! Tidak ada task yang menunggu review atau gagal."
                    : "Kantor sedang tenang. Delegasikan task atau mulai standup untuk melihat aktivitas live."}
            </p>
          ) : (
            <ul className="hud-feed-list">
              {visibleItems.map(item => {
                if (item.kind === "live-working") {
                  return (
                    <li key={item.id} className="hud-feed-card is-working">
                      <button
                        type="button"
                        className="hud-feed-main"
                        onClick={() => {
                          onClose();
                          if (item.issueId) onOpenTask({ id: item.issueId, ws: item.ws });
                          else onOpenDesk(item.desk);
                        }}
                      >
                        <CharacterFace face={item.face} size={30} shape="rounded" />
                        <span className="hud-ev-txt">
                          <span className="hud-ev-top">
                            <span className="hud-ev-badge is-working">{item.badge}</span>
                            <time>{item.time}</time>
                          </span>
                          <b><PxText text={item.title} /></b>
                          <small>{item.detail}</small>
                        </span>
                      </button>
                      <div className="hud-feed-inline">
                        <button
                          type="button"
                          className="hud-feed-act"
                          onClick={() => { onClose(); onChatAgent(item.desk); }}
                        >
                          Chat
                        </button>
                        <button
                          type="button"
                          className="hud-feed-act ghost"
                          onClick={() => { onClose(); onOpenDesk(item.desk); }}
                        >
                          Meja
                        </button>
                      </div>
                    </li>
                  );
                }

                if (item.kind === "live-review") {
                  const hasQuestions = item.questionCount > 0;
                  return (
                    <li key={item.id} className="hud-feed-card is-review">
                      <button
                        type="button"
                        className="hud-feed-main"
                        onClick={() => { onClose(); onOpenTask(item.task); }}
                      >
                        {item.face ? (
                          <CharacterFace face={item.face} size={30} shape="rounded" />
                        ) : (
                          <span className="hud-ev-ic is-review" aria-hidden="true"><Px name="eyes" /></span>
                        )}
                        <span className="hud-ev-txt">
                          <span className="hud-ev-top">
                            <span className="hud-ev-badge is-review">{item.badge}</span>
                            <time>{item.time}</time>
                          </span>
                          <b><PxText text={item.title} /></b>
                          <small>{item.detail}</small>
                        </span>
                      </button>
                      <div className="hud-feed-inline">
                        {hasQuestions ? (
                          <button
                            type="button"
                            className="hud-feed-act primary"
                            onClick={() => { onClose(); onOpenTask(item.task); }}
                          >
                            Jawab
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="hud-feed-act primary"
                            disabled={approvingId === item.task.id}
                            onClick={() => void handleInlineApprove(item.task)}
                          >
                            {approvingId === item.task.id ? "…" : "Approve"}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                }

                if (item.kind === "live-failed") {
                  return (
                    <li key={item.id} className="hud-feed-card is-failed">
                      <button
                        type="button"
                        className="hud-feed-main"
                        onClick={() => {
                          onClose();
                          if (item.run.issueId) onOpenTask({ id: item.run.issueId, ws: item.run.ws });
                        }}
                      >
                        {item.face ? (
                          <CharacterFace face={item.face} size={30} shape="rounded" />
                        ) : (
                          <span className="hud-ev-ic is-failed" aria-hidden="true"><Px name="failed" /></span>
                        )}
                        <span className="hud-ev-txt">
                          <span className="hud-ev-top">
                            <span className="hud-ev-badge is-failed">{item.badge}</span>
                            <time>{item.time}</time>
                          </span>
                          <b><PxText text={item.title} /></b>
                          <small>{item.detail}</small>
                        </span>
                      </button>
                      {item.run.issueId && (
                        <div className="hud-feed-inline">
                          <button
                            type="button"
                            className="hud-feed-act danger"
                            disabled={rerunningId === item.run.id}
                            onClick={() => void onRetry(item.run)}
                          >
                            {rerunningId === item.run.id ? "…" : "Retry"}
                          </button>
                        </div>
                      )}
                    </li>
                  );
                }

                return (
                  <li key={item.id} className="hud-feed-card">
                    <button
                      type="button"
                      className="hud-feed-main"
                      onClick={() => onSelectEvent(item.event)}
                    >
                      {item.face ? (
                        <CharacterFace face={item.face} size={28} shape="rounded" />
                      ) : (
                        <span className="hud-ev-ic" aria-hidden="true">
                          <Px name={EVENT_ICON[item.activityKind] ?? "mail"} />
                        </span>
                      )}
                      <span className="hud-ev-txt">
                        <span className="hud-ev-top">
                          <span className={`hud-ev-badge is-${item.tone}`}>{item.badge}</span>
                          <time>{item.time}</time>
                        </span>
                        <b>{item.title}</b>
                        {item.detail && <small>{item.detail}</small>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <footer className="hud-feed-foot">
            <button type="button" onClick={onOpenStandup}>
              <Px name="team" /> Standup
            </button>
            <button type="button" onClick={onOpenDelegate}>
              <Px name="rocket" /> Delegasi task
            </button>
          </footer>
        </section>
      )}
    </div>
  );
}
