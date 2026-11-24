import "server-only";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { faceById } from "./character-presets";
import { withProcessLock } from "./process-lock";

const FILE = join(process.cwd(), "data", "characters.json");
type Store = Record<string, Record<string, string>>;
export const memberCharacterKey = (memberId: string) => `member:${memberId}`;
export function readCharacters(ws: string): Record<string, string> {
  try { return (JSON.parse(readFileSync(FILE, "utf8")) as Store)[ws] ?? {}; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return {}; throw e; }
}
export function characterFor(ws: string, agentId: string): string | null { return readCharacters(ws)[agentId] ?? null; }
export async function saveCharacter(ws: string, agentId: string, face: string) {
  if (!faceById(face)) throw new Error("Unknown character.");
  // Guard the read-modify-write so two concurrent saves can't clobber each other.
  await withProcessLock("characters", async () => {
    let all: Store = {};
    try { all = JSON.parse(readFileSync(FILE, "utf8")) as Store; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    all[ws] = { ...(all[ws] ?? {}), [agentId]: face };
    mkdirSync(join(process.cwd(), "data"), { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all, null, 2)); renameSync(tmp, FILE);
  });
}
