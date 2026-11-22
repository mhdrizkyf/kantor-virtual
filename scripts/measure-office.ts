// Measure both Office loading strategies against the configured Multica API.
// Run each mode in a fresh process so the workspace-list cache does not skew counts.
import { performance } from "node:perf_hooks";
import { workspaces, loadWorkspace, me } from "../lib/multica";
import { buildOffice } from "../lib/office";

const baseline = process.argv.includes("--baseline");
const pick = process.argv.find(x => x.startsWith("--ws="))?.slice(5) ?? process.env.MULTICA_WORKSPACE_ID;
const original = globalThis.fetch;
let calls = 0;
globalThis.fetch = ((...args: Parameters<typeof fetch>) => { calls++; return original(...args); }) as typeof fetch;

async function main() {
  const start = performance.now();
  const [all] = await Promise.all([workspaces(), me().catch(() => null)]);
  const selected = all.find(w => w.id === pick || w.slug === pick) ?? all[0];
  if (baseline) await Promise.all(all.map(w => loadWorkspace(w.id).then(buildOffice)));
  else buildOffice(await loadWorkspace(selected.id));
  console.log(JSON.stringify({ mode: baseline ? "baseline" : "selected", workspaces: all.length,
    selected: selected.slug, apiCalls: calls, elapsedMs: Math.round(performance.now() - start) }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
