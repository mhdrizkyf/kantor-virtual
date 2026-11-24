"use client";
import { useState } from "react";
import type { Desk, Office } from "@/lib/office";
import { parseGoalPlan, type GoalStepDraft } from "@/lib/munder-workflows";
import { Px } from "./pixel-icon";
import CharacterFace from "./character-face";

export type LaunchedWorkflow = {
  goal: string;
  mode: "chain" | "parallel";
  parked: boolean;
  created: { id: string; title: string; agentId: string; status: string }[];
};

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
    if (initialSteps?.length) return initialSteps;
    return parseGoalPlan(
      initialGoal,
      desks.map(d => ({ agentId: d.agentId, name: d.name, description: d.description, squad: d.squad, state: d.state }))
    );
  });
  const [mode, setMode] = useState<"chain" | "parallel">("chain");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function regenerate() {
    if (!goal.trim()) return;
    setSteps(
      parseGoalPlan(
        goal,
        desks.map(d => ({ agentId: d.agentId, name: d.name, description: d.description, squad: d.squad, state: d.state }))
      )
    );
  }

  function updateStep(id: string, patch: Partial<GoalStepDraft>) {
    setSteps(cur => cur.map(s => (s.id === id ? { ...s, ...patch } : s)));
  }

  function addStep() {
    const fallback = desks[steps.length % Math.max(1, desks.length)]?.agentId ?? "";
    setSteps(cur => [
      ...cur,
      { id: `step-${Date.now()}`, title: "", detail: goal ? `Part of goal: ${goal}` : "", agentId: fallback },
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
          steps: valid.map(s => ({ title: s.title.trim(), detail: s.detail.trim(), agentId: s.agentId })),
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

        <div className="orch-mode" role="radiogroup" aria-label="Execution mode">
          <label className={`orch-mode-opt${mode === "chain" ? " on" : ""}`}>
            <input type="radio" name="orch-mode" checked={mode === "chain"} onChange={() => setMode("chain")} />
            <span>
              <b>Sequential chain</b>
              <small>Step 1 starts now; each next step triggers automatically after approval.</small>
            </span>
          </label>
          <label className={`orch-mode-opt${mode === "parallel" ? " on" : ""}`}>
            <input type="radio" name="orch-mode" checked={mode === "parallel"} onChange={() => setMode("parallel")} />
            <span>
              <b>Run in parallel</b>
              <small>Every assigned agent receives their task and starts immediately.</small>
            </span>
          </label>
        </div>

        <div className="orch-steps">
          <div className="orch-steps-head">
            <span className="sect">Workflow Steps ({steps.length})</span>
            <button type="button" className="btn sm" onClick={addStep} disabled={busy || steps.length >= 8}>
              <Px name="plus" size="0.9em" /> Add step
            </button>
          </div>
          {steps.map((step, i) => (
            <div key={step.id} className="orch-step">
              <span className="orch-num">{i + 1}</span>
              <div className="orch-fields">
                <div className="orch-top">
                  <input
                    className="input"
                    value={step.title}
                    onChange={e => updateStep(step.id, { title: e.target.value })}
                    placeholder={`Step ${i + 1} title…`}
                    aria-label={`Step ${i + 1} title`}
                  />
                  <div className="orch-agent-pick">
                    <CharacterFace face={desks.find(d => d.agentId === step.agentId)?.face} size={30} shape="circle" />
                    <select
                      className="input"
                      value={step.agentId}
                      onChange={e => updateStep(step.id, { agentId: e.target.value })}
                      aria-label={`Agent for step ${i + 1}`}
                    >
                      {desks.map(d => (
                        <option key={d.agentId} value={d.agentId}>{d.name}</option>
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
