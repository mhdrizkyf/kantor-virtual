import "server-only";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { validSquad } from "./squad-plan";
import { withProcessLock } from "./process-lock";

const FILE = join(process.cwd(), "data", "squads.json");
type Store = Record<string, Record<string, string>>;

function readAll(): Store {
  try { return JSON.parse(readFileSync(FILE, "utf8")) as Store; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return {}; throw e; }
}

export function readSquads(ws: string): Record<string, string> { return readAll()[ws] ?? {}; }

export async function saveSquad(ws: string, agentId: string, value: string): Promise<string> {
  const squad = validSquad(value);
  // Guard the read-modify-write so two concurrent moves can't clobber each other's save.
  await withProcessLock("squads", async () => {
    const all = readAll();
    all[ws] = { ...(all[ws] ?? {}), [agentId]: squad };
    mkdirSync(join(process.cwd(), "data"), { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all, null, 2)); renameSync(tmp, FILE);
  });
  return squad;
}
