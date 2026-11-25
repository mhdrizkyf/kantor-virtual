"use client";
import { useCallback, useEffect, useState } from "react";
import type { WorkspaceMetrics } from "@/lib/metrics";
import { Px, PxText } from "./pixel-icon";

type ChainStepView = {
  id: string;
  stage: number;
  key: string;
  title: string;
  status: string;
  assignee: string | null;
  started: boolean;
};

type ChainView = {
  id: string;
  ws: string;
  title: string;
  status: "active" | "paused" | "completed" | "cancelled";
  paused: boolean;
  stageCount: number;
  totalSteps: number;
  doneSteps: number;
  createdAt: string | null;
  updatedAt: string | null;
  steps: ChainStepView[];
};

export default function WorkflowHubModal({
  ws,
  workspaceName,
  initialTab = "chains",
  onOpenTask,
  onClose,
}: {
  ws: string;
  workspaceName: string;
  initialTab?: "chains" | "metrics";
  onOpenTask: (id: string, ws: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"chains" | "metrics">(initialTab);
  const [chains, setChains] = useState<ChainView[] | null>(null);
  const [metrics, setMetrics] = useState<WorkspaceMetrics | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadChains = useCallback(async () => {
    setErr(null);
    const r = await fetch(`/api/chains?ws=${encodeURIComponent(ws)}`);
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || "Could not load chains.");
    setChains(j.chains ?? []);
  }, [ws]);

  const loadMetrics = useCallback(async () => {
    setErr(null);
    const r = await fetch(`/api/metrics?ws=${encodeURIComponent(ws)}`);
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error || "Could not load metrics.");
    setMetrics(j);
  }, [ws]);

  useEffect(() => {
    if (tab === "chains") {
      loadChains().catch(e => setErr(e instanceof Error ? e.message : String(e)));
    } else {
      loadMetrics().catch(e => setErr(e instanceof Error ? e.message : String(e)));
    }
  }, [tab, loadChains, loadMetrics]);

  async function mutateChain(id: string, action: "pause" | "resume" | "cancel" | "skip" | "delete" | "run", issueId?: string) {
    setBusyId(`${id}:${action}:${issueId ?? ""}`);
    setErr(null);
    try {
      const r = await fetch("/api/chains", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ws, id: id || undefined, action, issueId }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || "Chain update failed.");
      await loadChains();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section className="modal wfhub-modal" role="dialog" aria-modal="true" aria-label="Workflows and Insights">
        <div className="standup-head">
          <div>
            <span className="hlabel">{workspaceName} · Multica Workflow Hub</span>
            <h2><Px name="rocket" /> Workflows &amp; Insights</h2>
          </div>
          <button type="button" className="x" onClick={onClose} aria-label="Close">
            <Px name="close" size="1em" />
          </button>
        </div>

        <div className="tabs" role="tablist" style={{ padding: 0 }}>
          <button type="button" role="tab" className="tab" aria-selected={tab === "chains"} aria-pressed={tab === "chains"} onClick={() => setTab("chains")}>
            <Px name="play" /> Task Chains {chains ? `(${chains.filter(c => c.status === "active" || c.status === "paused").length})` : ""}
          </button>
          <button type="button" role="tab" className="tab" aria-selected={tab === "metrics"} aria-pressed={tab === "metrics"} onClick={() => setTab("metrics")}>
            <Px name="sparkle" /> Operational Insights
          </button>
        </div>

        {err && <div className="note bad">{err}</div>}

        {tab === "chains" && (
          <div className="wfhub-body">
            <div className="wfhub-bar">
              <span className="desc">Sequential &amp; staged workflows with automatic handoff context.</span>
              <button
                type="button"
                className="btn sm"
                disabled={!!busyId}
                onClick={() => mutateChain("", "run")}
              >
                <Px name="refresh" /> Check &amp; advance now
              </button>
            </div>
            {!chains ? (
              <div className="loading"><span className="spinner" /> Loading chains…</div>
            ) : chains.length === 0 ? (
              <p className="desc">No task chains yet. Use the Delegate bar in the Office to launch a sequential or staged workflow.</p>
            ) : (
              <div className="wfhub-chains">
                {chains.map(c => {
                  const pct = c.totalSteps ? Math.round((c.doneSteps / c.totalSteps) * 100) : 0;
                  const active = c.status === "active" || c.status === "paused";
                  return (
                    <article key={c.id} className={`wf-chain st-${c.status}`}>
                      <header className="wf-chain-head">
                        <div>
                          <b><PxText text={c.title} /></b>
                          <small>
                            {c.doneSteps}/{c.totalSteps} steps done · {c.stageCount} stage{c.stageCount === 1 ? "" : "s"} · {c.status}
                          </small>
                        </div>
                        <div className="wf-chain-actions">
                          {c.status === "active" && (
                            <button type="button" className="btn sm" disabled={!!busyId} onClick={() => mutateChain(c.id, "pause")}>Pause</button>
                          )}
                          {c.status === "paused" && (
                            <button type="button" className="btn sm primary" disabled={!!busyId} onClick={() => mutateChain(c.id, "resume")}>Resume</button>
                          )}
                          {active ? (
                            <button type="button" className="btn sm" disabled={!!busyId} onClick={() => mutateChain(c.id, "cancel")}>Cancel</button>
                          ) : (
                            <button type="button" className="btn sm" disabled={!!busyId} onClick={() => mutateChain(c.id, "delete")}>Remove</button>
                          )}
                        </div>
                      </header>
                      <div className="wf-progress" aria-label={`${pct}% complete`}><i style={{ width: `${pct}%` }} /></div>
                      <ol className="wf-steps">
                        {c.steps.map(st => {
                          const done = /^(done|cancelled|canceled|completed|skipped)$/.test(st.status);
                          return (
                            <li key={st.id} className={done ? "is-done" : st.started ? "is-live" : ""}>
                              <span className="wf-stage-tag">S{st.stage}</span>
                              <button type="button" className="wf-step-link" onClick={() => { onClose(); onOpenTask(st.id, c.ws); }}>
                                <b><PxText text={st.title} /></b>
                                <small>{st.key}{st.assignee ? ` · ${st.assignee}` : ""} · {st.status}</small>
                              </button>
                              {active && !done && (
                                <button type="button" className="btn sm" disabled={!!busyId} onClick={() => mutateChain(c.id, "skip", st.id)} title="Skip this step so the next stage can start">
                                  Skip
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ol>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === "metrics" && (
          <div className="wfhub-body">
            {!metrics ? (
              <div className="loading"><span className="spinner" /> Computing workspace insights…</div>
            ) : (
              <>
                <div className="wf-kpi-grid">
                  <div className="wf-kpi">
                    <small>Task run success rate</small>
                    <strong>{metrics.runs.successRate !== null ? `${metrics.runs.successRate}%` : "—"}</strong>
                    <span>{metrics.runs.completed} ok · {metrics.runs.failed} failed{metrics.runs.chatRuns > 0 ? ` · ${metrics.runs.chatRuns} chat replies excluded` : ""}</span>
                  </div>
                  <div className="wf-kpi">
                    <small>First-pass approval</small>
                    <strong>{metrics.review.firstPassRate !== null ? `${metrics.review.firstPassRate}%` : "—"}</strong>
                    <span>{metrics.review.approvedRecent} approved · {metrics.review.revisedRecent} revised</span>
                  </div>
                  <div className="wf-kpi">
                    <small>Avg run duration</small>
                    <strong>{metrics.runs.avgDurationMin !== null ? `${metrics.runs.avgDurationMin}m` : "—"}</strong>
                    <span>{metrics.runs.active} active right now</span>
                  </div>
                  <div className="wf-kpi">
                    <small>Quota &amp; failovers</small>
                    <strong>{metrics.runs.quotaFailures}</strong>
                    <span>{metrics.runs.activeFailovers} switched · {metrics.review.waitingAnswerNow} waiting Q</span>
                  </div>
                </div>

                {metrics.providers.length > 0 && (
                  <div>
                    <div className="sect">AI Engines</div>
                    <div className="wf-prov-row">
                      {metrics.providers.map(p => (
                        <span key={p.provider} className="runtime-chip">
                          <i className={p.onlineRuntimes > 0 ? "on" : ""} />
                          {p.provider}: {p.onlineRuntimes}/{p.totalRuntimes} online · {p.completed} ok / {p.failed} fail
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <div className="sect">Per-Agent Throughput &amp; Health</div>
                  <div className="wf-table-wrap">
                    <table className="wf-table">
                      <thead>
                        <tr>
                          <th>Agent</th>
                          <th>Open</th>
                          <th>Review</th>
                          <th>Runs (ok/fail)</th>
                          <th>Success</th>
                          <th>Avg time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.agents.map(a => (
                          <tr key={a.agentId}>
                            <td><b>{a.name}</b></td>
                            <td>{a.openTasks}</td>
                            <td>{a.inReview}</td>
                            <td>{a.completedRuns}/{a.failedRuns}</td>
                            <td>{a.successRate !== null ? `${a.successRate}%` : "—"}</td>
                            <td>{a.avgDurationMin !== null ? `${a.avgDurationMin}m` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </>
  );
}
