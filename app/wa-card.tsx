"use client";
// "Send via WhatsApp" card for drafts an agent writes in a ```whatsapp block.
// It opens your own WhatsApp with the message filled in; you press Send there.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Px } from "./pixel-icon";
import { TaigaCard } from "./taiga-card";
import { GrowText } from "./auto-grow";
import { useVisiblePoll } from "./visible-poll";
import { findContact, normalizePhone, parseDraft, showTarget, isGroup, waLink, withNote, fmtSendAt, type Contact } from "@/lib/whatsapp";

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
export type Queued = { id: string; phone: string; name: string; text: string; at: string; status: "waiting" | "sent" | "failed"; error?: string; sentAt?: string; trigger?: { issueId: string; ws: string; title: string } };

/** The task a card sits on (set by the task pop-up), so a message can wait for that task to be done. */
export const WaTask = createContext<{ id: string; ws: string; title: string } | null>(null);
export type Bot = { status: "missing" | "off" | "starting" | "code" | "ready" | "error"; code?: string; phone?: string; name?: string; error?: string; queue?: Queued[] };
let bot: Bot | null = null;
let botLoading: Promise<Bot> | null = null;
const botSubs = new Set<(b: Bot) => void>();
export function setBot(b: Bot) { bot = b; botSubs.forEach(f => f(b)); }
export const loadBot = () => {
  if (botLoading) return botLoading;
  botLoading = fetch("/api/wa")
    .then(r => r.json())
    .then((j: Bot) => { setBot(j); return j; })
    .finally(() => { botLoading = null; });
  return botLoading;
};
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
  if (Array.isArray(cls) && cls.some(c => /^language-taiga$/i.test(String(c)))) return <TaigaCard block={textOf(code)} />;
  if (!isWa) return <pre {...rest}>{children}</pre>;
  const d = parseDraft(textOf(code));
  return <WaCard to={d.to} text={d.text} sendAt={d.sendAt} whenDone={d.whenDone} />;
}

const pad = (n: number) => String(n).padStart(2, "0");
const tomorrow9 = () => { const d = new Date(Date.now() + 864e5); return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: "09:00" }; };

type When = { date: string; time: string } | "done" | null;
function WaCard({ to, text, sendAt, whenDone }: { to: string; text: string; sendAt: { date: string; time: string } | null; whenDone: boolean }) {
  const task = useContext(WaTask);
  const [when, setWhen] = useState<When>(whenDone && task ? "done" : sendAt);
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
  // Approved earlier to go out when this task is done: show where it stands.
  const pending = task && who ? assistant?.queue?.find(q => q.trigger?.issueId === task.id && q.phone === who.phone && q.text === full) : undefined;
  useVisiblePoll(() => loadBot().catch(() => {}), 30_000, pending?.status === "waiting");
  async function cancelPending() {
    if (!pending) return;
    const j = await (await fetch("/api/wa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel", id: pending.id }) })).json();
    if (j.error) { setErr(j.error); return; }
    setBot({ ...(bot ?? { status: "ready" }), queue: j.queue });
    setSentAt(null);
    try { if (who) localStorage.removeItem(sentKey(who.phone, full)); } catch { /* ignore */ }
  }
  async function approve(w: When = when) {
    const phone = target(); if (!phone) return;
    if ((sentAt || prevSent) && !confirm(`This message was already ${sentAt ?? prevSent}. Send it again?`)) return;
    setSending(true);
    try {
      const name = who?.name ?? newName.trim();
      const body = w === "done" ? { action: "when-done", phone, name, text: full, issueId: task?.id, ws: task?.ws, title: task?.title }
        : w ? { action: "schedule", phone, name, text: full, ...w } : { action: "send", phone, text: full };
      const j = await (await fetch("/api/wa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
      if (j.error) throw new Error(j.error);
      const label = w === "done" ? "approved to go out when this task is done"
        : w ? `scheduled for ${fmtSendAt(w)}`
        : `sent ${new Date(j.at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
      setSentAt(label);
      if (j.queue) setBot({ ...(bot ?? { status: "ready" }), queue: j.queue });
      if (w !== "done") try { localStorage.setItem(sentKey(phone, full), label); } catch { /* ignore */ }
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
        {who && <small>{showTarget(who.phone)}</small>}
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
      {live && !pending && (
        <div className="wa-when">
          <Px name="clock" />
          <select className="input" aria-label="When to send" value={when === "done" ? "done" : when ? "later" : "now"}
            onChange={e => setWhen(e.target.value === "done" ? "done" : e.target.value === "later" ? (when && when !== "done" ? when : tomorrow9()) : null)}>
            <option value="now">Send right away</option>
            <option value="later">Send at a set time</option>
            {task && <option value="done">Send when this task is done</option>}
          </select>
          {when && when !== "done" && <>
            <input type="date" className="input" aria-label="Send date" value={when.date} onChange={e => setWhen({ ...when, date: e.target.value })} />
            <input type="time" className="input" aria-label="Send time" value={when.time} onChange={e => setWhen({ ...when, time: e.target.value })} />
          </>}
        </div>
      )}
      {pending ? (
        <div className={`wa-row wa-pending ${pending.status}`}>
          <span className="hint">
            {pending.status === "waiting" ? <><Px name="done" /> Approved. It goes out from the assistant&apos;s number as soon as this task is done.</>
              : pending.status === "sent" ? <><Px name="done" /> Sent {new Date(pending.sentAt ?? pending.at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}, when the task was done.</>
              : <><Px name="alert" /> Couldn&apos;t send when the task was done: {pending.error}</>}
          </span>
          {pending.status === "waiting" && <button type="button" className="btn sm" onClick={cancelPending}>Cancel</button>}
          {pending.status === "failed" && <button type="button" className="btn sm primary wa-go" onClick={() => { setWhen(null); approve(null); }} disabled={sending}><Px name="done" /> Send now</button>}
        </div>
      ) : live ? (
        <div className="wa-row">
          <span className="hint">{sentAt ? <><Px name="done" /> {sentAt[0].toUpperCase() + sentAt.slice(1)} from the assistant&apos;s number.</>
            : prevSent ? <><Px name="done" /> Already {prevSent}.</>
            : when === "done" ? <>Approve once now. It then goes out from the assistant&apos;s number by itself as soon as this task is done.</>
            : <>Goes out from the assistant&apos;s number{assistant?.phone ? ` (+${assistant.phone})` : ""} {when ? "at that time" : "right away"} once you approve.</>}</span>
          <button type="button" className="btn sm" onClick={copy}>{copied ? <><Px name="done" /> Copied</> : <><Px name="clip" /> Copy</>}</button>
          {!(who && isGroup(who.phone)) && <button type="button" className="btn sm" onClick={send} title="Open in your own WhatsApp instead">My WhatsApp</button>}
          <button type="button" className="btn sm primary wa-go" onClick={() => approve()} disabled={!b || sending}>
            {sending ? <><span className="spinner sm" /> Sending…</> : <><Px name="done" /> {sentAt || prevSent ? "Send again" : when === "done" ? "Approve, send when done" : when ? "Approve & schedule" : "Approve & send"}</>}</button>
        </div>
      ) : (
        <div className="wa-row">
          <span className="hint">{who && isGroup(who.phone) ? "Messages to a group go out from the assistant's number, which isn't connected right now. Copy the text and send it in the group yourself." : sent ? <><Px name="done" /> Opened in WhatsApp. Press Send there.</> : "Opens your WhatsApp with this text. Nothing is sent until you press Send."}</span>
          <button type="button" className="btn sm" onClick={copy}>{copied ? <><Px name="done" /> Copied</> : <><Px name="clip" /> Copy</>}</button>
          {!(who && isGroup(who.phone)) && <button type="button" className="btn sm primary wa-go" onClick={send} disabled={!b}><Px name="chat" /> {sent ? "Open again" : "Send via WhatsApp"}</button>}
        </div>
      )}
    </div>
  );
}
