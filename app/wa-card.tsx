"use client";
// "Send via WhatsApp" card for drafts an agent writes in a ```whatsapp block.
// It opens your own WhatsApp with the message filled in; you press Send there.
import { useEffect, useState, type ReactNode } from "react";
import { Px } from "./pixel-icon";
import { GrowText } from "./auto-grow";
import { findContact, normalizePhone, parseDraft, showPhone, waLink, withNote, type Contact } from "@/lib/whatsapp";

export type Book = { contacts: Contact[]; note: string; me: string };

// One shared copy of the contact book for every card and the contacts drawer.
let book: Book | null = null;
let loading: Promise<Book> | null = null;
const subs = new Set<(b: Book) => void>();
export function setBook(b: Book) { book = b; subs.forEach(f => f(b)); }
export function loadBook(force = false) {
  if (!force && book) return Promise.resolve(book);
  if (!force && loading) return loading;
  loading = fetch("/api/contacts").then(r => r.json()).then((j: Book) => { setBook(j); return j; }).finally(() => { loading = null; });
  return loading;
}
export function useBook() {
  const [b, setB] = useState<Book | null>(book);
  useEffect(() => { subs.add(setB); loadBook().catch(() => {}); return () => { subs.delete(setB); }; }, []);
  return b;
}
export async function saveContact(name: string, phone: string, oldName?: string) {
  const j = await (await fetch("/api/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, phone, oldName }) })).json();
  if (j.error) throw new Error(j.error);
  setBook({ ...j, me: book?.me ?? "me" });
}

// Status of the assistant's own WhatsApp number (shared by every card).
export type Bot = { status: "missing" | "off" | "starting" | "code" | "ready" | "error"; code?: string; phone?: string; name?: string; error?: string };
let bot: Bot | null = null;
const botSubs = new Set<(b: Bot) => void>();
export function setBot(b: Bot) { bot = b; botSubs.forEach(f => f(b)); }
export const loadBot = () => fetch("/api/wa").then(r => r.json()).then((j: Bot) => { setBot(j); return j; });
export function useBot() {
  const [b, setB] = useState<Bot | null>(bot);
  useEffect(() => { botSubs.add(setB); loadBot().catch(() => {}); return () => { botSubs.delete(setB); }; }, []);
  return b;
}

// Remember what was already sent from here, so reopening a chat doesn't invite a second send.
const sentKey = (phone: string, text: string) => {
  let h = 0; for (const ch of phone + "|" + text) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return "kantor-wa-sent:" + h;
};
const readSent = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

const textOf = (n: unknown): string => {
  const x = n as { type?: string; value?: string; children?: unknown[] };
  return x.type === "text" ? x.value ?? "" : (x.children ?? []).map(textOf).join("");
};

/** For ReactMarkdown `components.pre`: ```whatsapp blocks become a send card, other code stays as it is. */
export function WaPre(props: { node?: unknown; children?: ReactNode } & Record<string, unknown>) {
  const { node, children, ...rest } = props;
  const code = (node as { children?: { tagName?: string; properties?: { className?: unknown } }[] })?.children?.find(c => c.tagName === "code");
  const cls = code?.properties?.className;
  const isWa = Array.isArray(cls) ? cls.some(c => /^language-(whatsapp|wa)$/i.test(String(c))) : false;
  if (!isWa) return <pre {...rest}>{children}</pre>;
  const d = parseDraft(textOf(code));
  return <WaCard to={d.to} text={d.text} />;
}

function WaCard({ to, text }: { to: string; text: string }) {
  const b = useBook();
  const assistant = useBot();
  const live = assistant?.status === "ready";
  const [sending, setSending] = useState(false);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const match = b ? findContact(b.contacts, to) : null;
  const [pick, setPick] = useState<string | null>(null); // a contact chosen by hand
  const [newName, setNewName] = useState(to);
  const [newPhone, setNewPhone] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const who = b?.contacts.find(c => c.name === pick) ?? match;
  const full = msg ?? (b ? withNote(b.note, b.me, text) : text);

  function target() {
    setErr(null);
    if (who) return who.phone;
    const phone = normalizePhone(newPhone);
    if (!phone) { setErr("Add a phone number first, e.g. 0812… or +62 812…."); return null; }
    if (newName.trim()) saveContact(newName.trim(), newPhone).catch(e => setErr(`Couldn't save the contact: ${e.message}`));
    return phone;
  }
  function send() {
    const phone = target(); if (!phone) return;
    window.open(waLink(phone, full), "_blank", "noopener");
    setSent(true);
  }
  const prevSent = who ? readSent(sentKey(who.phone, full)) : null;
  async function approve() {
    const phone = target(); if (!phone) return;
    if ((sentAt || prevSent) && !confirm("This message was already sent. Send it again?")) return;
    setSending(true);
    try {
      const j = await (await fetch("/api/wa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "send", phone, text: full }) })).json();
      if (j.error) throw new Error(j.error);
      const at = new Date(j.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setSentAt(at);
      try { localStorage.setItem(sentKey(phone, full), new Date(j.at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })); } catch { /* ignore */ }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setSending(false);
  }
  async function copy() {
    try { await navigator.clipboard.writeText(full); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setErr("Couldn't copy. Select the text and copy it instead."); }
  }

  return (
    <div className="wa-card">
      <div className="wa-head">
        <span className="wa-ic"><Px name="chat" /></span>
        <b>WhatsApp to {who?.name ?? (to || "someone")}</b>
        {who && <small>{showPhone(who.phone)}</small>}
        {b && b.contacts.length > 0 && (
          <select className="input wa-pick" aria-label="Send to" value={who?.name ?? ""} onChange={e => setPick(e.target.value || null)}>
            {!who && <option value="">Pick a contact…</option>}
            {b.contacts.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        )}
      </div>
      {b && !who && (
        <div className="wa-new">
          <input className="input" aria-label="Name" placeholder="Name" value={newName} onChange={e => setNewName(e.target.value)} />
          <input className="input" aria-label="WhatsApp number" placeholder="WhatsApp number, e.g. 0812 3456 7890" inputMode="tel" value={newPhone} onChange={e => setNewPhone(e.target.value)} />
          <small className="hint">{to ? `${to} isn't in your WhatsApp contacts yet.` : "Who is this for?"} The number is saved on this computer for next time.</small>
        </div>
      )}
      <GrowText className="input wa-text" value={full} onChange={e => setMsg(e.target.value)} maxPx={360} aria-label="Message" />
      {err && <div className="note bad">{err}</div>}
      {live ? (
        <div className="wa-row">
          <span className="hint">{sentAt ? <><Px name="done" /> Sent from the assistant&apos;s number at {sentAt}.</>
            : prevSent ? <><Px name="done" /> Already sent ({prevSent}).</>
            : <>Sends from the assistant&apos;s number{assistant?.phone ? ` (+${assistant.phone})` : ""} once you approve.</>}</span>
          <button type="button" className="btn sm" onClick={copy}>{copied ? <><Px name="done" /> Copied</> : <><Px name="clip" /> Copy</>}</button>
          <button type="button" className="btn sm" onClick={send} title="Open in your own WhatsApp instead">My WhatsApp</button>
          <button type="button" className="btn sm primary wa-go" onClick={approve} disabled={!b || sending}>
            {sending ? <><span className="spinner sm" /> Sending…</> : <><Px name="done" /> {sentAt || prevSent ? "Send again" : "Approve & send"}</>}</button>
        </div>
      ) : (
        <div className="wa-row">
          <span className="hint">{sent ? <><Px name="done" /> Opened in WhatsApp. Press Send there.</> : "Opens your WhatsApp with this text. Nothing is sent until you press Send."}</span>
          <button type="button" className="btn sm" onClick={copy}>{copied ? <><Px name="done" /> Copied</> : <><Px name="clip" /> Copy</>}</button>
          <button type="button" className="btn sm primary wa-go" onClick={send} disabled={!b}><Px name="chat" /> {sent ? "Open again" : "Send via WhatsApp"}</button>
        </div>
      )}
    </div>
  );
}
