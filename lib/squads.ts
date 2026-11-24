import "server-only";
import { join } from "node:path";
import { validSquad } from "./squad-plan";
import { readJsonFile, updateJsonLocked } from "./json-store";

const file = () => join(process.cwd(), "data", "squads.json");
type Store = Record<string, Record<string, string>>;

export function readSquads(ws: string): Record<string, string> {
  return readJsonFile<Store>(file(), () => ({}))[ws] ?? {};
}

export async function saveSquad(ws: string, agentId: string, value: string): Promise<string> {
  const squad = validSquad(value);
  // Guard the read-modify-write so two concurrent moves can't clobber each other's save.
  return updateJsonLocked<Store, string>("squads", file(), () => ({}), all => ({
    next: { ...all, [ws]: { ...(all[ws] ?? {}), [agentId]: squad } },
    result: squad,
  }));
}
