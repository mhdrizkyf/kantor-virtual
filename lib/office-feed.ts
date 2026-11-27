import type { Desk, Office, RunView, TaskView } from "./office";
import type { ActivityEvent, ActivityKind } from "./munder-workflows";

export type OfficeFeedTab = "all" | "active" | "attention" | "history";

export type OfficeFeedItem =
  | {
      id: string;
      kind: "live-working";
      badge: string;
      tone: "working";
      title: string;
      detail: string;
      time: string;
      agentId: string;
      agentName: string;
      face: string | null;
      desk: Desk;
      issueId: string | null;
      ws: string;
    }
  | {
      id: string;
      kind: "live-review";
      badge: string;
      tone: "review";
      title: string;
      detail: string;
      time: string;
      agentId: string | null;
      agentName: string;
      face: string | null;
      task: TaskView;
      questionCount: number;
    }
  | {
      id: string;
      kind: "live-failed";
      badge: string;
      tone: "failed";
      title: string;
      detail: string;
      time: string;
      agentId: string | null;
      agentName: string;
      face: string | null;
      run: RunView;
    }
  | {
      id: string;
      kind: "event";
      activityKind: ActivityKind;
      badge: string;
      tone: "neutral" | "ok" | "warn";
      title: string;
      detail: string;
      time: string;
      agentId: string | null;
      agentName: string | null;
      face: string | null;
      event: ActivityEvent;
    };

const EVENT_BADGE: Record<ActivityKind, { label: string; tone: "neutral" | "ok" | "warn" }> = {
  handoff: { label: "Handoff", tone: "neutral" },
  approve: { label: "Approved", tone: "ok" },
  revise: { label: "Revisi", tone: "warn" },
  delegate: { label: "Delegasi", tone: "neutral" },
  standup: { label: "Standup", tone: "neutral" },
  coffee: { label: "Break", tone: "neutral" },
  door: { label: "Kantor", tone: "neutral" },
  drag: { label: "Pindah", tone: "neutral" },
  chain: { label: "Chain", tone: "ok" },
  watchdog: { label: "Watchdog", tone: "warn" },
  schedule: { label: "Jadwal", tone: "neutral" },
  chat: { label: "Chat", tone: "neutral" },
};

export function buildOfficeFeedItems(opts: {
  desks: readonly Desk[];
  attention: Office["attention"];
  events: readonly ActivityEvent[];
  wsId: string;
}): OfficeFeedItem[] {
  const { desks, attention, events, wsId } = opts;
  const deskById = new Map(desks.map(d => [d.agentId, d]));
  const deskByName = new Map(desks.map(d => [d.name.toLowerCase(), d]));
  const out: OfficeFeedItem[] = [];

  for (const run of attention.failed) {
    const matched = deskByName.get(run.agent.toLowerCase()) ?? null;
    out.push({
      id: `failed:${run.id}`,
      kind: "live-failed",
      badge: "Gagal",
      tone: "failed",
      title: run.issueTitle || "Task gagal dijalankan",
      detail: `${run.agent} · ${run.error || "Terhenti tiba-tiba"}`,
      time: run.when,
      agentId: matched?.agentId ?? null,
      agentName: run.agent,
      face: matched?.face ?? null,
      run,
    });
  }

  for (const task of attention.review) {
    const matched =
      (task.assigneeId ? deskById.get(task.assigneeId) : null) ??
      (task.assignee ? deskByName.get(task.assignee.toLowerCase()) : null) ??
      null;
    const questionCount = task.questionCount ?? 0;
    const summaryHint = task.summary?.[0] || (task.project ? `Proyek ${task.project}` : "Menunggu persetujuan");
    out.push({
      id: `review:${task.id}`,
      kind: "live-review",
      badge: questionCount > 0 ? `${questionCount} tanya` : "Review",
      tone: "review",
      title: task.title,
      detail: `${task.assignee || "Agent"} · ${summaryHint}`,
      time: task.dueText || "Menunggu",
      agentId: matched?.agentId ?? task.assigneeId ?? null,
      agentName: task.assignee || matched?.name || "Agent",
      face: matched?.face ?? null,
      task,
      questionCount,
    });
  }

  for (const desk of desks) {
    if (desk.state !== "working") continue;
    const activeTask =
      desk.tasks.find(t => t.status === "in_progress") ??
      desk.tasks[0] ??
      null;
    const cleanBubble = desk.bubble.replace(/^Working on:\s*/i, "").trim();
    out.push({
      id: `working:${desk.agentId}`,
      kind: "live-working",
      badge: "Aktif",
      tone: "working",
      title: activeTask?.title || cleanBubble || "Sedang bekerja",
      detail: `${desk.name}${desk.squad ? ` · ${desk.squad}` : ""}`,
      time: "Live",
      agentId: desk.agentId,
      agentName: desk.name,
      face: desk.face,
      desk,
      issueId: activeTask?.id ?? null,
      ws: activeTask?.ws ?? wsId,
    });
  }

  for (const ev of events) {
    const matched = ev.agentId ? deskById.get(ev.agentId) ?? null : null;
    const meta = EVENT_BADGE[ev.kind] ?? { label: "Update", tone: "neutral" as const };
    out.push({
      id: `ev:${ev.id}`,
      kind: "event",
      activityKind: ev.kind,
      badge: meta.label,
      tone: meta.tone,
      title: ev.title,
      detail: ev.detail || (matched ? `${matched.name} · ${matched.squad}` : ""),
      time: ev.at,
      agentId: ev.agentId ?? null,
      agentName: matched?.name ?? null,
      face: matched?.face ?? null,
      event: ev,
    });
  }

  return out;
}

export function filterOfficeFeed(
  items: readonly OfficeFeedItem[],
  tab: OfficeFeedTab,
  rawQuery: string,
): OfficeFeedItem[] {
  const q = rawQuery.trim().toLowerCase();
  return items.filter(item => {
    if (tab === "active" && item.kind !== "live-working") return false;
    if (tab === "attention" && item.kind !== "live-review" && item.kind !== "live-failed") return false;
    if (tab === "history" && item.kind !== "event") return false;
    if (!q) return true;
    const hay = `${item.title} ${item.detail} ${item.agentName ?? ""} ${item.badge}`.toLowerCase();
    return hay.includes(q);
  });
}

export function countUnreadFeedEvents(events: readonly ActivityEvent[], lastSeenId: string | null): number {
  if (!events.length) return 0;
  if (!lastSeenId) return Math.min(events.length, 9);
  const idx = events.findIndex(ev => ev.id === lastSeenId);
  if (idx === -1) return Math.min(events.length, 9);
  return idx;
}

export function summarizeOfficeFeedPill(opts: {
  workingCount: number;
  reviewCount: number;
  failedCount: number;
  unreadCount: number;
}): {
  tone: "failed" | "review" | "working" | "idle";
  summary: string | null;
  badgeCount: number;
} {
  const { workingCount, reviewCount, failedCount, unreadCount } = opts;
  const parts: string[] = [];
  if (failedCount > 0) parts.push(`${failedCount} gagal`);
  if (reviewCount > 0) parts.push(`${reviewCount} review`);
  if (workingCount > 0 && parts.length < 2) parts.push(`${workingCount} aktif`);

  const tone =
    failedCount > 0
      ? "failed"
      : reviewCount > 0
        ? "review"
        : workingCount > 0
          ? "working"
          : "idle";

  return {
    tone,
    summary: parts.length > 0 ? parts.join(" · ") : null,
    badgeCount: unreadCount,
  };
}
