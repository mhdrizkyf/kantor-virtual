// WhatsApp contacts and the "sent by my assistant" note. Kept in data/contacts.json on this computer only (git-ignored).
import "server-only";
import { join } from "node:path";
import type { Contact } from "./whatsapp";
import { DEFAULT_NOTE } from "./whatsapp";
import { readJsonFile, updateJsonLocked, writeJsonAtomic } from "./json-store";

const file = () => join(process.cwd(), "data", "contacts.json");
export type ContactBook = { contacts: Contact[]; note: string };

const normalizeBook = (j: Partial<ContactBook>): ContactBook => ({
  contacts: Array.isArray(j.contacts) ? j.contacts : [],
  note: typeof j.note === "string" ? j.note : DEFAULT_NOTE,
});

export function readBook(): ContactBook {
  return normalizeBook(readJsonFile<Partial<ContactBook>>(file(), () => ({}), { tolerateInvalid: true }));
}
export function writeBook(b: ContactBook) {
  b.contacts.sort((x, y) => x.name.localeCompare(y.name));
  writeJsonAtomic(file(), b);
  return b;
}
export async function updateBook(mutator: (book: ContactBook) => ContactBook | void): Promise<ContactBook> {
  return updateJsonLocked<Partial<ContactBook>, ContactBook>(
    "contacts",
    file(),
    () => ({}),
    raw => {
      const book = normalizeBook(raw);
      const next = mutator(book) ?? book;
      next.contacts.sort((x, y) => x.name.localeCompare(y.name));
      return { next, result: next };
    },
    { tolerateInvalid: true },
  );
}
