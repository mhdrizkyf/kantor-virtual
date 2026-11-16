// WhatsApp contacts and the "sent by my assistant" note. Kept in data/contacts.json on this computer only (git-ignored).
import "server-only";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Contact } from "./whatsapp";
import { DEFAULT_NOTE } from "./whatsapp";

const FILE = join(process.cwd(), "data", "contacts.json");
export type ContactBook = { contacts: Contact[]; note: string };

export function readBook(): ContactBook {
  try {
    const j = JSON.parse(readFileSync(FILE, "utf8")) as Partial<ContactBook>;
    return { contacts: Array.isArray(j.contacts) ? j.contacts : [], note: typeof j.note === "string" ? j.note : DEFAULT_NOTE };
  } catch { return { contacts: [], note: DEFAULT_NOTE }; }
}
export function writeBook(b: ContactBook) {
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  b.contacts.sort((x, y) => x.name.localeCompare(y.name));
  writeFileSync(FILE, JSON.stringify(b, null, 2));
  return b;
}
