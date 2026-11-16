import { NextResponse } from "next/server";
import { readBook, writeBook } from "@/lib/contacts";
import { normalizePhone } from "@/lib/whatsapp";
import { me } from "@/lib/multica";

export const dynamic = "force-dynamic";
const bad = (m: string, status = 400) => NextResponse.json({ error: m }, { status });

/** WhatsApp contacts on this computer, the note added to messages, and your first name for that note. */
export async function GET() {
  const book = readBook();
  const name = await me().then(u => u.name).catch(() => "");
  return NextResponse.json({ ...book, me: name.trim().split(/\s+/)[0] || "me" });
}

/** Add or update a contact: { name, phone, oldName? } */
export async function POST(req: Request) {
  const b = (await req.json()) as { name?: string; phone?: string; oldName?: string };
  const name = (b.name ?? "").trim().slice(0, 80);
  const phone = normalizePhone(b.phone ?? "");
  if (!name) return bad("Write the person's name.");
  if (!phone) return bad("That phone number doesn't look right. Use a format like 0812… or +62 812….");
  const book = readBook();
  const drop = new Set([name.toLowerCase(), (b.oldName ?? "").toLowerCase()]);
  book.contacts = book.contacts.filter(c => !drop.has(c.name.toLowerCase()));
  book.contacts.push({ name, phone });
  return NextResponse.json(writeBook(book));
}

/** Remove a contact: { name } */
export async function DELETE(req: Request) {
  const b = (await req.json()) as { name?: string };
  const book = readBook();
  book.contacts = book.contacts.filter(c => c.name.toLowerCase() !== (b.name ?? "").toLowerCase());
  return NextResponse.json(writeBook(book));
}

/** Change the note added on top of each message: { note } ({me} becomes your first name; empty for no note). */
export async function PUT(req: Request) {
  const b = (await req.json()) as { note?: string };
  const book = readBook();
  book.note = (b.note ?? "").slice(0, 300);
  return NextResponse.json(writeBook(book));
}
