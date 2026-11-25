// Reusable Workflow Playbook templates (built-in starters + workspace-saved custom templates in data/playbooks.json).
import "server-only";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readJsonFile, updateJsonLocked } from "./json-store";

export type PlaybookStep = {
  title: string;
  detail: string;
  roleHint?: string;
  stage: number;
};

export type WorkflowPlaybook = {
  id: string;
  name: string;
  description: string;
  mode: "chain" | "parallel" | "staged";
  builtIn?: boolean;
  steps: PlaybookStep[];
  createdAt?: string;
};

export const BUILTIN_PLAYBOOKS: WorkflowPlaybook[] = [
  {
    id: "builtin:research-execute-qa",
    name: "Research → Execute → QA",
    description: "Classic 3-step sequential delivery with automatic context handoff.",
    mode: "chain",
    builtIn: true,
    steps: [
      { title: "Research & outline brief", detail: "Gather facts, outline key requirements, and post a crisp storyline for review.", roleHint: "research", stage: 1 },
      { title: "Build main deliverable", detail: "Implement or produce the core deliverable using the approved brief from Stage 1.", roleHint: "delivery", stage: 2 },
      { title: "QA review & executive summary", detail: "Verify completeness, check edge cases, and post a concise final summary.", roleHint: "qa", stage: 3 },
    ],
  },
  {
    id: "builtin:staged-launch",
    name: "Staged Launch (Research → Design + Copy → QA)",
    description: "Stage 1 aligns scope; Stage 2 fans out Design & Content in parallel; Stage 3 verifies.",
    mode: "staged",
    builtIn: true,
    steps: [
      { title: "Define launch goals & audience", detail: "Synthesize goals, audience, and key messages into a 1-page brief.", roleHint: "research", stage: 1 },
      { title: "Create visual assets & layout", detail: "Produce the visual mockup/assets aligned with the Stage 1 brief.", roleHint: "design", stage: 2 },
      { title: "Write launch copy & messaging", detail: "Draft crisp messaging and captions aligned with the Stage 1 brief.", roleHint: "content", stage: 2 },
      { title: "Final QA & launch checklist", detail: "Review combined visuals + copy from Stage 2 and prepare the final sign-off checklist.", roleHint: "qa", stage: 3 },
    ],
  },
  {
    id: "builtin:weekly-ops-report",
    name: "Weekly Report Pipeline",
    description: "Collect updates in parallel, then compile the executive summary.",
    mode: "staged",
    builtIn: true,
    steps: [
      { title: "Gather delivery progress & blockers", detail: "Summarize completed work, open items, and risks from this week.", roleHint: "delivery", stage: 1 },
      { title: "Compile metrics & insights", detail: "Pull key KPIs, trends, and anomalies from available data.", roleHint: "analyst", stage: 1 },
      { title: "Draft executive weekly report", detail: "Combine Stage 1 inputs into a structured summary deck/report.", roleHint: "manager", stage: 2 },
    ],
  },
];

type Store = Record<string, WorkflowPlaybook[]>;
const file = () => join(process.cwd(), "data", "playbooks.json");

export function listPlaybooks(wsId: string): WorkflowPlaybook[] {
  const store = readJsonFile<Store>(file(), () => ({}), { tolerateInvalid: true });
  const custom = Array.isArray(store[wsId]) ? store[wsId] : [];
  return [...custom, ...BUILTIN_PLAYBOOKS];
}

export async function savePlaybook(
  wsId: string,
  input: { name: string; description?: string; mode: "chain" | "parallel" | "staged"; steps: PlaybookStep[] }
): Promise<WorkflowPlaybook> {
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new Error("Playbook name is required.");
  const steps = (input.steps ?? [])
    .filter(s => s.title?.trim())
    .slice(0, 8)
    .map((s, idx) => ({
      title: s.title.trim().slice(0, 120),
      detail: (s.detail ?? "").trim().slice(0, 800),
      roleHint: s.roleHint?.trim().slice(0, 40) || undefined,
      stage: Number.isInteger(s.stage) && s.stage >= 1 && s.stage <= 8 ? s.stage : idx + 1,
    }));
  if (!steps.length) throw new Error("Add at least one step to save a playbook.");

  const pb: WorkflowPlaybook = {
    id: `pb-${randomUUID().slice(0, 8)}`,
    name,
    description: (input.description ?? "").trim().slice(0, 180) || `${steps.length} steps (${input.mode})`,
    mode: input.mode === "parallel" || input.mode === "staged" ? input.mode : "chain",
    steps,
    createdAt: new Date().toISOString(),
  };

  return updateJsonLocked<Store, WorkflowPlaybook>(
    "playbooks",
    file(),
    () => ({}),
    current => {
      const prev = Array.isArray(current[wsId]) ? current[wsId] : [];
      const next = [pb, ...prev.filter(x => x.name.toLowerCase() !== name.toLowerCase())].slice(0, 40);
      return { next: { ...current, [wsId]: next }, result: pb };
    },
    { tolerateInvalid: true }
  );
}

export async function deletePlaybook(wsId: string, id: string): Promise<boolean> {
  if (id.startsWith("builtin:")) return false;
  return updateJsonLocked<Store, boolean>(
    "playbooks",
    file(),
    () => ({}),
    current => {
      const prev = Array.isArray(current[wsId]) ? current[wsId] : [];
      const next = prev.filter(x => x.id !== id);
      return { next: { ...current, [wsId]: next }, result: next.length !== prev.length };
    },
    { tolerateInvalid: true }
  );
}
