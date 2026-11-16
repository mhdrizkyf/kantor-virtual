// Adds the Kantor Virtual blocks to every agent's instructions:
// - the report format (## Summary / ## Questions), so the task pop-up can show a summary and question cards
// - how to set a Telegram reminder (see lib/reminders.ts)
// - how to write a WhatsApp draft so it gets a Send button (see lib/whatsapp.ts)
// Safe to run again: agents that already have it are skipped. Use --dry to only list what would change.
//   npm run agents:format -- --dry
//   npm run agents:format
import { workspaces, loadDirectory, updateAgent, call_ } from "../lib/multica";
import { AGENT_REPORT_FORMAT, FORMAT_MARKER } from "../lib/digest";
import { AGENT_REMINDERS, REMIND_MARKER } from "../lib/reminders";
import { AGENT_WHATSAPP, WA_MARKER } from "../lib/whatsapp";

const BLOCKS = [[FORMAT_MARKER, AGENT_REPORT_FORMAT, "report format"], [REMIND_MARKER, AGENT_REMINDERS, "reminders"], [WA_MARKER, AGENT_WHATSAPP, "WhatsApp drafts"]] as const;

const dry = process.argv.includes("--dry");

async function main() {
  for (const w of await workspaces()) {
    const { agents } = await loadDirectory(w.id);
    for (const a of agents) {
      const full = await call_<{ instructions?: string | null }>("GET", `/api/agents/${a.id}`, w.id);
      const cur = full.instructions ?? "";
      const missing = BLOCKS.filter(([marker]) => !cur.includes(marker));
      if (!missing.length) { console.log(`= ${w.name} · ${a.name}: already has it`); continue; }
      const names = missing.map(b => b[2]).join(" + ");
      if (dry) { console.log(`+ ${w.name} · ${a.name}: would add ${names}`); continue; }
      try {
        await updateAgent(w.id, a.id, { instructions: missing.reduce((acc, b) => (acc.trim() ? acc.trimEnd() + "\n" : "") + b[1], cur) });
        console.log(`+ ${w.name} · ${a.name}: added ${names}`);
      } catch (e) { console.log(`! ${w.name} · ${a.name}: ${e instanceof Error ? e.message.slice(0, 160) : e}`); }
    }
  }
}
main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
