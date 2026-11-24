// Adds the Kantor Virtual blocks to every agent's instructions.
// Delegates to lib/agent-instructions.ts so CLI and UI stay in sync.
//   npm run agents:format -- --dry
//   npm run agents:format
import { workspaces } from "../lib/multica";
import { syncWorkspaceInstructions } from "../lib/agent-instructions";

const dry = process.argv.includes("--dry");

async function main() {
  for (const w of await workspaces()) {
    const res = await syncWorkspaceInstructions(w.id, { dryRun: dry });
    for (const name of res.skipped) console.log(`= ${w.name} · ${name}: up to date`);
    for (const u of res.updated) console.log(`+ ${w.name} · ${u.name}: ${dry ? "would have " : ""}${u.changed.join(", ")}`);
    for (const f of res.failed) console.log(`! ${w.name} · ${f.name}: ${f.error}`);
  }
}
main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
