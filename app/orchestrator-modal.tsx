"use client";
import { useEffect, useState } from "react";
import type { Desk, Office } from "@/lib/office";
import { parseGoalPlan, type GoalStepDraft } from "@/lib/munder-workflows";
import type { WorkflowPlaybook } from "@/lib/playbooks";
import { Px } from "./pixel-icon";
import CharacterFace from "./character-face";

export type LaunchedWorkflow = {
  goal: string;
  mode: "chain" | "parallel" | "staged";
  parked: boolean;
  created: { id: string; title: string; agentId: string; status: string }[];
};

function deskBriefs(desks: Desk[]) {
  return desks.map(d => ({
    agentId: d.agentId,
    name: d.name,
    description: d.description,
    squad: d.squad,
    state: d.state,
    openTasks: d.tasks.length,
    runtimeOnline: d.state !== "off",
  }));
}

export default function OrchestratorModal({
  ws,
  initialGoal,
  initialSteps,
  heading = "Delegate Goal Across Team",
  desks,
  projects,
  onLaunched,
  onClose,
}: {
  ws: string;
  initialGoal: string;
  initialSteps?: GoalStepDraft[];
  heading?: string;
  desks: Desk[];
  projects: Office["projects"];
  onLaunched: (result: LaunchedWorkflow) => void;
  onClose: () => void;
}) {
  const [goal, setGoal] = useState(initialGoal);
  const [steps, setSteps] = useState<GoalStepDraft[]>(() => {
    if (initialSteps?.length) return initialSteps.map((s, i) => ({ ...s, stage: s.stage ?? i + 1 }));
    return parseGoalPlan(initialGoal, deskBriefs(desks)).map((s, i) => ({ ...s, stage: s.stage ?? i + 1 }));
  });
  const [mode, setMode] = useState<"chain" | "staged" | "parallel">("chain");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [due, setDue] = useState("");
  const [playbooks, setPlaybooks] = useState<WorkflowPlaybook[]>([]);
  const [savingPb, setSavingPb] = useState(false);
  const [pbName, setPbName] = useState("");
  const [pbNotice, setPbNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/playbooks?ws=${encodeURIComponent(ws)}`)
      .then(r => r.json())
      .then(j => { if (Array.isArray(j.playbooks)) setPlaybooks(j.playbooks); })
      .catch(() => {});
  }, [ws]);

  function regenerate() {
    if (!goal.trim()) return;
    setSteps(parseGoalPlan(goal, deskBriefs(desks)).map((s, i) => ({ ...s, stage: i + 1 })));
  }

  function applyPlaybook(pb: WorkflowPlaybook) {
    const briefs = deskBriefs(desks);
    const goalText = goal.trim() || pb.name;
    const mapped: GoalStepDraft[] = pb.steps.map((st, idx) => {
      const hintQuery = `${st.roleHint ?? ""} ${st.title}`;
      const picked = parseGoalPlan(hintQuery, briefs)[0]?.agentId ?? desks[idx % Math.max(1, desks.length)]?.agentId ?? "";
      const detail = goal.trim() ? `Goal: ${goal.trim()}\n\n${st.detail}` : st.detail;
      return {
        id: `pb-step-${idx + 1}-${Date.now()}`,
        title: goal.trim() ? `${st.title}: ${goal.trim().slice(0, 48)}` : st.title,
        detail,
        agentId: picked,
        stage: st.stage,
      };
    });
    setGoal(goalText);
    setMode(pb.mode);
    setSteps(mapped);
    setPbNotice(`Loaded playbook "${pb.name}"`);
  }

  async function saveCurrentAsPlaybook() {
    const valid = steps.filter(s => s.title.trim());
    if (!pbName.trim() || !valid.length) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/playbooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ws,
          name: pbName.trim(),
          mode,
          steps: valid.map((s, idx) => ({
            title: s.title.trim(),
            detail: s.detail.trim(),
            roleHint: desks.find(d => d.agentId === s.agentId)?.squad,
            stage: s.stage ?? idx + 1,
          })),
        }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || "Could not save playbook.");
      if (Array.isArray(j.playbooks)) setPlaybooks(j.playbooks);
      setPbName("");
      setSavingPb(false);
      setPbNotice(`Saved playbook "${j.playbook.name}"`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function updateStep(id: string, patch: Partial<GoalStepDraft>) {
    setSteps(cur => cur.map(s => (s.id === id ? { ...s, ...patch } : s)));
  }

  function addStep() {
    const fallback = desks[steps.length % Math.max(1, desks.length)]?.agentId ?? "";
    const nextStage = mode === "staged" ? Math.min(8, (steps[steps.length - 1]?.stage ?? 1) + 1) : steps.length + 1;
    setSteps(cur => [
      ...cur,
      { id: `step-${Date.now()}`, title: "", detail: goal ? `Part of goal: ${goal}` : "", agentId: fallback, stage: nextStage },
    ]);
  }

  function removeStep(id: string) {
    setSteps(cur => cur.filter(s => s.id !== id));
  }

  async function launch(e: React.FormEvent) {
    e.preventDefault();
    const valid = steps.filter(s => s.title.trim() && s.agentId);
    if (!valid.length) {
      setErr("Add at least one step with a title and agent.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/orchestrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ws,
          goal,
          mode,
          projectId,
          due,
          injectContext: true,
          steps: valid.map((s, idx) => ({
            title: s.title.trim(),
            detail: s.detail.trim(),
            agentId: s.agentId,
            stage: s.stage ?? idx + 1,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Could not launch workflow.");
      onLaunched({ goal: goal.trim() || valid[0].title, mode, parked: !!data.parked, created: data.created });
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="scrim" onClick={() => !busy && onClose()} />
      <form className="modal orch-modal" role="dialog" aria-modal="true" aria-label={heading} onSubmit={launch}>
        <div className="standup-head">
          <div>
            <span className="hlabel">Goal Orchestrator · Multica Sync</span>
            <h2><Px name="rocket" /> {heading}</h2>
          </div>
          <button type="button" className="x" disabled={busy} onClick={onClose} aria-label="Close">
            <Px name="close" size="1em" />
          </button>
        </div>

        {playbooks.length > 0 && (
          <div className="orch-playbooks" aria-label="Workflow playbooks">
            <span className="sect">Playbooks</span>
            <div className="orch-pb-row">
              {playbooks.slice(0, 6).map(pb => (
                <button
                  key={pb.id}
                  type="button"
                  className="chip orch-pb-chip"
                  disabled={busy}
                  title={pb.description}
                  onClick={() => applyPlaybook(pb)}
                >
                  <Px name={pb.mode === "staged" ? "rocket" : "sparkle"} size="0.85em" /> {pb.name}
                </button>
              ))}
            </div>
            {pbNotice && <small className="hint">{pbNotice}</small>}
          </div>
        )}

        <div className="orch-goal-row">
          <input
            className="input"
            value={goal}
            onChange={e => setGoal(e.target.value)}
            placeholder="Describe the goal (use lines or → to auto-split steps)…"
            aria-label="Overall goal"
          />
          <button type="button" className="btn sm" onClick={regenerate} disabled={!goal.trim() || busy}>
            Auto-split
          </button>
        </div>

        <div className="orch-mode orch-mode-3" role="radiogroup" aria-label="Execution mode">
          <label className={`orch-mode-opt${mode === "chain" ? " on" : ""}`}>
            <input type="radio" name="orch-mode" checked={mode === "chain"} onChange={() => setMode("chain")} />
            <span>
              <b>Sequential chain</b>
              <small>One step at a time with auto handoff summary.</small>
            </span>
          </label>
          <label className={`orch-mode-opt${mode === "staged" ? " on" : ""}`}>
            <input type="radio" name="orch-mode" checked={mode === "staged"} onChange={() => setMode("staged")} />
            <span>
              <b>Staged (DAG)</b>
              <small>Same stage runs in parallel; next stage waits for approval.</small>
            </span>
          </label>
          <label className={`orch-mode-opt${mode === "parallel" ? " on" : ""}`}>
            <input type="radio" name="orch-mode" checked={mode === "parallel"} onChange={() => setMode("parallel")} />
            <span>
              <b>All parallel</b>
              <small>Every assigned agent starts immediately.</small>
            </span>
          </label>
        </div>

        <div className="orch-steps">
          <div className="orch-steps-head">
            <span className="sect">Workflow Steps ({steps.length})</span>
            <div className="chiprow">
              <button type="button" className="btn sm" onClick={() => setSavingPb(v => !v)} disabled={busy || !steps.some(s => s.title.trim())}>
                Save playbook
              </button>
              <button type="button" className="btn sm" onClick={addStep} disabled={busy || steps.length >= 8}>
                <Px name="plus" size="0.9em" /> Add step
              </button>
            </div>
          </div>

          {savingPb && (
            <div className="orch-save-pb">
              <input
                className="input"
                value={pbName}
                onChange={e => setPbName(e.target.value)}
                placeholder="Playbook name, e.g. Sprint Feature Pipeline…"
                maxLength={80}
              />
              <button type="button" className="btn sm primary" disabled={busy || !pbName.trim()} onClick={saveCurrentAsPlaybook}>
                Save
              </button>
            </div>
          )}

          {steps.map((step, i) => (
            <div key={step.id} className="orch-step">
              <span className="orch-num">{mode === "staged" ? `S${step.stage ?? i + 1}` : i + 1}</span>
              <div className="orch-fields">
                <div className="orch-top">
                  <input
                    className="input"
                    value={step.title}
                    onChange={e => updateStep(step.id, { title: e.target.value })}
                    placeholder={`Step ${i + 1} title…`}
                    aria-label={`Step ${i + 1} title`}
                  />
                  {mode === "staged" && (
                    <select
                      className="input orch-stage-pick"
                      value={step.stage ?? i + 1}
                      onChange={e => updateStep(step.id, { stage: Number(e.target.value) })}
                      aria-label={`Stage for step ${i + 1}`}
                    >
                      {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>Stage {n}</option>)}
                    </select>
                  )}
                  <div className="orch-agent-pick">
                    <CharacterFace face={desks.find(d => d.agentId === step.agentId)?.face} size={30} shape="circle" />
                    <select
                      className="input"
                      value={step.agentId}
                      onChange={e => updateStep(step.id, { agentId: e.target.value })}
                      aria-label={`Agent for step ${i + 1}`}
                    >
                      {desks.map(d => (
                        <option key={d.agentId} value={d.agentId}>{d.name}{d.tasks.length >= 5 ? ` (${d.tasks.length} open)` : ""}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <textarea
                  className="input orch-detail"
                  rows={2}
                  value={step.detail}
                  onChange={e => updateStep(step.id, { detail: e.target.value })}
                  placeholder="Instructions or handoff context…"
                />
              </div>
              {steps.length > 1 && (
                <button
                  type="button"
                  className="x"
                  aria-label={`Remove step ${i + 1}`}
                  onClick={() => removeStep(step.id)}
                  disabled={busy}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="formgrid">
          <label>
            Project
            <select className="input" value={projectId} onChange={e => setProjectId(e.target.value)}>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              <option value="">No project</option>
            </select>
          </label>
          <label>
            Due date (optional)
            <input className="input" type="date" value={due} onChange={e => setDue(e.target.value)} />
          </label>
        </div>

        {err && <div className="note bad">{err}</div>}

        <div className="row">
          <button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || !steps.some(s => s.title.trim())}>
            {busy ? <><span className="spinner sm" /> Dispatching…</> : <><Px name="rocket" /> Launch {steps.filter(s => s.title.trim()).length} task{steps.filter(s => s.title.trim()).length === 1 ? "" : "s"}</>}
          </button>
        </div>
      </form>
    </>
  );
}
