import "server-only";
import { join } from "node:path";
import { faceById } from "./character-presets";
import { readJsonFile, updateJsonLocked } from "./json-store";

const file = () => join(process.cwd(), "data", "characters.json");
type Store = Record<string, Record<string, string>>;
export const memberCharacterKey = (memberId: string) => `member:${memberId}`;
export function readCharacters(ws: string): Record<string, string> {
  return readJsonFile<Store>(file(), () => ({}))[ws] ?? {};
}
export function characterFor(ws: string, agentId: string): string | null { return readCharacters(ws)[agentId] ?? null; }
export async function saveCharacter(ws: string, agentId: string, face: string) {
  if (!faceById(face)) throw new Error("Unknown character.");
  // Guard the read-modify-write so two concurrent saves can't clobber each other.
  await updateJsonLocked<Store, void>("characters", file(), () => ({}), all => ({
    next: { ...all, [ws]: { ...(all[ws] ?? {}), [agentId]: face } },
    result: undefined,
  }));
}
