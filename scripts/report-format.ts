// Adds the Kantor Virtual blocks to every agent's instructions:
// - the report format (## Summary / ## Questions), so the task pop-up can show a summary and question cards
// - how to set a Telegram reminder (see lib/reminders.ts)
// - how to write a WhatsApp draft so it gets a Send button (see lib/whatsapp.ts)
// Safe to run again: blocks that are up to date are left alone, outdated ones are replaced. Use --dry to only list what would change.
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
      // Blocks already there but outdated are replaced in place; missing ones are added at the end.
      let next = cur; const changed: string[] = [];
      for (const [marker, text, label] of BLOCKS) {
        const at = next.indexOf(marker);
        if (at < 0) { next = (next.trim() ? next.trimEnd() + "\n" : "") + text; changed.push(`added ${label}`); continue; }
        const start = next.lastIndexOf("\n", at) + 1;
        const after = next.indexOf("\n## Kantor Virtual", at + marker.length);
        const end = after < 0 ? next.length : after;
        const want = text.trim();
        if (next.slice(start, end).trim() === want) continue;
        next = next.slice(0, start) + want + (after < 0 ? "" : "\n") + next.slice(end);
        changed.push(`updated ${label}`);
      }
      if (!changed.length) { console.log(`= ${w.name} · ${a.name}: up to date`); continue; }
      if (dry) { console.log(`+ ${w.name} · ${a.name}: would have ${changed.join(", ")}`); continue; }
      try {
        await updateAgent(w.id, a.id, { instructions: next });
        console.log(`+ ${w.name} · ${a.name}: ${changed.join(", ")}`);
      } catch (e) { console.log(`! ${w.name} · ${a.name}: ${e instanceof Error ? e.message.slice(0, 160) : e}`); }
    }
  }
}
main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
