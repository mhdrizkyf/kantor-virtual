// Shared Kantor Virtual agent instruction blocks & compliance inspector/syncer.
// Used by both the Team Members UI (/api/crew/sync-instructions) and the CLI (scripts/report-format.ts).
import "server-only";
import { loadDirectory, updateAgent, call_, workspace } from "./multica";
import { AGENT_REPORT_FORMAT, FORMAT_MARKER } from "./digest";
import { AGENT_REMINDERS, REMIND_MARKER } from "./reminders";
import { AGENT_WHATSAPP, WA_MARKER } from "./whatsapp";
import { AGENT_TAIGA, TAIGA_MARKER } from "./taiga";
import { AGENT_SHOTS, SHOTS_MARKER } from "./screenshots";

export const INSTRUCTION_BLOCKS = [
  [FORMAT_MARKER, AGENT_REPORT_FORMAT, "report format"],
  [REMIND_MARKER, AGENT_REMINDERS, "reminders"],
  [WA_MARKER, AGENT_WHATSAPP, "WhatsApp drafts"],
  [TAIGA_MARKER, AGENT_TAIGA, "Taiga activities"],
  [SHOTS_MARKER, AGENT_SHOTS, "web screenshots"],
] as const;

export type InstructionDiff = {
  next: string;
  missing: string[];
  outdated: string[];
  changed: string[];
  upToDate: boolean;
};

/** Compute the updated instructions string and report any missing or outdated Virtual Office blocks. */
export function computeSyncedInstructions(current: string): InstructionDiff {
  let next = current ?? "";
  const missing: string[] = [];
  const outdated: string[] = [];
  const changed: string[] = [];
  for (const [marker, text, label] of INSTRUCTION_BLOCKS) {
    const at = next.indexOf(marker);
    if (at < 0) {
      next = (next.trim() ? next.trimEnd() + "\n" : "") + text;
      missing.push(label);
      changed.push(`added ${label}`);
      continue;
    }
    const start = next.lastIndexOf("\n", at) + 1;
    const after = next.indexOf("\n## Kantor Virtual", at + marker.length);
    const end = after < 0 ? next.length : after;
    const want = text.trim();
    if (next.slice(start, end).trim() === want) continue;
    next = next.slice(0, start) + want + (after < 0 ? "" : "\n") + next.slice(end);
    outdated.push(label);
    changed.push(`updated ${label}`);
  }
  return { next, missing, outdated, changed, upToDate: changed.length === 0 };
}

export type AgentInstructionHealth = {
  agentId: string;
  name: string;
  upToDate: boolean;
  missing: string[];
  outdated: string[];
  changed: string[];
};

export async function inspectWorkspaceInstructions(wsPick?: string | null): Promise<{
  workspaceId: string;
  workspaceName: string;
  agents: AgentInstructionHealth[];
  outdatedCount: number;
}> {
  const ws = await workspace(wsPick);
  const { agents } = await loadDirectory(ws.id);
  const results = await Promise.all(agents.map(async a => {
    const full = await call_<{ instructions?: string | null }>("GET", `/api/agents/${a.id}`, ws.id);
    const diff = computeSyncedInstructions(full.instructions ?? "");
    return {
      agentId: a.id,
      name: a.name,
      upToDate: diff.upToDate,
      missing: diff.missing,
      outdated: diff.outdated,
      changed: diff.changed,
    };
  }));
  return {
    workspaceId: ws.id,
    workspaceName: ws.name,
    agents: results,
    outdatedCount: results.filter(r => !r.upToDate).length,
  };
}

export async function syncWorkspaceInstructions(wsPick?: string | null, opts: { agentId?: string; dryRun?: boolean } = {}) {
  const ws = await workspace(wsPick);
  const { agents } = await loadDirectory(ws.id);
  const targets = opts.agentId ? agents.filter(a => a.id === opts.agentId) : agents;
  const updated: { agentId: string; name: string; changed: string[] }[] = [];
  const skipped: string[] = [];
  const failed: { agentId: string; name: string; error: string }[] = [];

  for (const a of targets) {
    try {
      const full = await call_<{ instructions?: string | null }>("GET", `/api/agents/${a.id}`, ws.id);
      const diff = computeSyncedInstructions(full.instructions ?? "");
      if (diff.upToDate) {
        skipped.push(a.name);
        continue;
      }
      if (!opts.dryRun) {
        await updateAgent(ws.id, a.id, { instructions: diff.next });
      }
      updated.push({ agentId: a.id, name: a.name, changed: diff.changed });
    } catch (e) {
      failed.push({ agentId: a.id, name: a.name, error: e instanceof Error ? e.message.slice(0, 160) : String(e) });
    }
  }
  return { workspaceId: ws.id, workspaceName: ws.name, updated, skipped, failed };
}
