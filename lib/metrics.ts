// Operational Workflow Metrics & Analytics computed from live Multica snapshot + persistent activity log.
import type { Snapshot } from "./multica";
import { isQuotaError } from "./quota";
import type { StoredActivityEvent } from "./activity-log";

export type AgentMetric = {
  agentId: string;
  name: string;
  completedRuns: number;
  failedRuns: number;
  activeRuns: number;
  successRate: number | null;
  avgDurationMin: number | null;
  openTasks: number;
  inReview: number;
};

export type ProviderMetric = {
  provider: string;
  completed: number;
  failed: number;
  quotaFailures: number;
  onlineRuntimes: number;
  totalRuntimes: number;
};

export type WorkspaceMetrics = {
  workspaceId: string;
  workspaceName: string;
  generatedAt: string;
  runs: {
    total: number;
    completed: number;
    failed: number;
    active: number;
    successRate: number | null;
    avgDurationMin: number | null;
    quotaFailures: number;
    activeFailovers: number;
  };
  review: {
    inReviewNow: number;
    waitingAnswerNow: number;
    overdueNow: number;
    approvedRecent: number;
    revisedRecent: number;
    firstPassRate: number | null;
  };
  agents: AgentMetric[];
  providers: ProviderMetric[];
};

const ACTIVE = new Set(["queued", "dispatched", "running", "in_progress", "preparing", "started"]);
const CLOSED = new Set(["done", "cancelled", "canceled", "completed", "duplicate"]);

export function computeWorkspaceMetrics(
  s: Snapshot,
  activity: Pick<StoredActivityEvent, "kind">[] = [],
  now = new Date()
): WorkspaceMetrics {
  const tz = process.env.KANTOR_TIMEZONE || "Asia/Jakarta";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
  const rtProvider = new Map(s.runtimes.map(r => [r.id, r.provider]));

  let completed = 0;
  let failed = 0;
  let active = 0;
  let quotaFailures = 0;
  const durations: number[] = [];

  const byAgent = new Map<string, { completed: number; failed: number; active: number; durations: number[] }>();
  const byProvider = new Map<string, { completed: number; failed: number; quotaFailures: number }>();

  for (const r of s.runs) {
    const aStat = byAgent.get(r.agent_id) ?? { completed: 0, failed: 0, active: 0, durations: [] };
    byAgent.set(r.agent_id, aStat);

    const prov = rtProvider.get(r.runtime_id) ?? "other";
    const pStat = byProvider.get(prov) ?? { completed: 0, failed: 0, quotaFailures: 0 };
    byProvider.set(prov, pStat);

    if (r.status === "completed") {
      completed++;
      aStat.completed++;
      pStat.completed++;
      const start = Date.parse(r.started_at ?? r.created_at);
      const end = Date.parse(r.completed_at ?? "");
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        const mins = (end - start) / 60000;
        if (mins <= 240) { // ignore outliers >4h
          durations.push(mins);
          aStat.durations.push(mins);
        }
      }
    } else if (r.status === "failed") {
      failed++;
      aStat.failed++;
      pStat.failed++;
      if (isQuotaError(r.error)) {
        quotaFailures++;
        pStat.quotaFailures++;
      }
    } else if (ACTIVE.has(r.status)) {
      active++;
      aStat.active++;
    }
  }

  const finished = completed + failed;
  const avg = (arr: number[]) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null);

  const openIssues = s.issues.filter(i => !CLOSED.has(i.status));
  const inReviewNow = openIssues.filter(i => i.status === "in_review").length;
  const waitingAnswerNow = s.asking?.size ?? 0;
  const overdueNow = openIssues.filter(i => i.due_date && i.due_date < today && i.status !== "in_review").length;

  const approvedRecent = activity.filter(e => e.kind === "approve").length;
  const revisedRecent = activity.filter(e => e.kind === "revise").length;
  const reviewActions = approvedRecent + revisedRecent;
  const firstPassRate = reviewActions > 0 ? Math.round((approvedRecent / reviewActions) * 100) : null;

  const agents: AgentMetric[] = s.agents.map(a => {
    const st = byAgent.get(a.id) ?? { completed: 0, failed: 0, active: 0, durations: [] };
    const tot = st.completed + st.failed;
    const mine = openIssues.filter(i => i.assignee_type === "agent" && i.assignee_id === a.id);
    return {
      agentId: a.id,
      name: a.name,
      completedRuns: st.completed,
      failedRuns: st.failed,
      activeRuns: st.active,
      successRate: tot > 0 ? Math.round((st.completed / tot) * 100) : null,
      avgDurationMin: avg(st.durations),
      openTasks: mine.length,
      inReview: mine.filter(i => i.status === "in_review").length,
    };
  }).sort((a, b) => (b.completedRuns + b.openTasks) - (a.completedRuns + a.openTasks) || a.name.localeCompare(b.name));

  const providerKeys = new Set([...s.runtimes.map(r => r.provider), ...byProvider.keys()]);
  const providers: ProviderMetric[] = [...providerKeys].map(provider => {
    const rts = s.runtimes.filter(r => r.provider === provider);
    const st = byProvider.get(provider) ?? { completed: 0, failed: 0, quotaFailures: 0 };
    return {
      provider,
      completed: st.completed,
      failed: st.failed,
      quotaFailures: st.quotaFailures,
      onlineRuntimes: rts.filter(r => r.status === "online").length,
      totalRuntimes: rts.length,
    };
  }).sort((a, b) => b.totalRuntimes - a.totalRuntimes || a.provider.localeCompare(b.provider));

  return {
    workspaceId: s.workspace.id,
    workspaceName: s.workspace.name,
    generatedAt: now.toISOString(),
    runs: {
      total: s.runs.length,
      completed,
      failed,
      active,
      successRate: finished > 0 ? Math.round((completed / finished) * 100) : null,
      avgDurationMin: avg(durations),
      quotaFailures,
      activeFailovers: Object.keys(s.moved ?? {}).length,
    },
    review: {
      inReviewNow,
      waitingAnswerNow,
      overdueNow,
      approvedRecent,
      revisedRecent,
      firstPassRate,
    },
    agents,
    providers,
  };
}
