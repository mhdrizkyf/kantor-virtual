"use client";
// WhatsApp contacts drawer: the people your assistant drafts messages for, and the note added on top of each message.
import { useEffect, useState } from "react";
import { Px } from "./pixel-icon";
import { GrowText } from "./auto-grow";
import { useBook, saveContact, setBook, loadBook } from "./wa-card";
import { showPhone, withNote, DEFAULT_NOTE } from "@/lib/whatsapp";

export default function Contacts({ onClose }: { onClose: () => void }) {
  const b = useBook();
  const [name, setName] = useState(""); const [phone, setPhone] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadBook(true).catch(e => setErr(String(e.message ?? e))); }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [onClose]);

  async function add() {
    setBusy(true); setErr(null); setOk(null);
    try { await saveContact(name, phone, editing ?? undefined); setOk(`${name.trim()} saved.`); setName(""); setPhone(""); setEditing(null); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }
  async function remove(n: string) {
    const j = await (await fetch("/api/contacts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: n }) })).json();
    if (j.error) setErr(j.error); else setBook({ ...j, me: b?.me ?? "me" });
  }
  async function saveNote() {
    const j = await (await fetch("/api/contacts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) })).json();
    if (j.error) setErr(j.error); else { setBook({ ...j, me: b?.me ?? "me" }); setNote(null); setOk("Note saved."); }
  }
  const curNote = note ?? b?.note ?? "";

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer reminddrawer" role="dialog" aria-modal="true" aria-label="WhatsApp contacts">
        <div className="dhead">
          <span className="avatar"><Px name="person" /></span>
          <div className="meta"><h2>WhatsApp contacts</h2><div className="role">for messages your assistants draft</div></div>
          <button className="x" onClick={onClose} aria-label="Close"><Px name="close" size="1em" /></button>
        </div>
        <div className="dbody">
          <p className="hint">Ask any assistant to draft a WhatsApp message (e.g. &ldquo;draft a WhatsApp to Wanda about Friday&rsquo;s session&rdquo;). The draft gets a <b>Send via WhatsApp</b> button that opens your WhatsApp with the text filled in. Numbers are kept on this computer only.</p>
          <form className="rm-new" onSubmit={e => { e.preventDefault(); add(); }}>
            <label className="sect" htmlFor="ct-name">{editing ? `Edit ${editing}` : "Add a contact"}</label>
            <div className="rm-when">
              <input id="ct-name" className="input" placeholder="Name, e.g. Wanda" value={name} onChange={e => { setName(e.target.value); setOk(null); }} maxLength={80} />
              <input className="input" aria-label="WhatsApp number" placeholder="0812 3456 7890" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} />
              <button className="btn primary" disabled={!name.trim() || !phone.trim() || busy}>{busy ? <span className="spinner sm" /> : <Px name={editing ? "done" : "plus"} size="0.9em" />} {editing ? "Save" : "Add"}</button>
              {editing && <button type="button" className="btn" onClick={() => { setEditing(null); setName(""); setPhone(""); }}>Cancel</button>}
            </div>
          </form>
          {ok && <div className="note good">{ok}</div>}
          {err && <div className="note bad">{err}</div>}
          <h3 className="sect">Contacts</h3>
          {!b && !err && <div className="loading"><span className="spinner" /> Loading…</div>}
          {b && !b.contacts.length && <p className="desc">No contacts yet. You can also add a number right on a draft the first time.</p>}
          <ul className="rm-list">
            {b?.contacts.map(c => (
              <li key={c.name}>
                <span className="rm-ic"><Px name="person" /></span>
                <span className="rm-t"><b>{c.name}</b><small>{showPhone(c.phone)}</small></span>
                <button className="btn sm" onClick={() => { setEditing(c.name); setName(c.name); setPhone("+" + c.phone); setOk(null); }} aria-label={`Edit ${c.name}`}><Px name="edit" /></button>
                <button className="btn sm" onClick={() => remove(c.name)} aria-label={`Remove ${c.name}`}>Remove</button>
              </li>
            ))}
          </ul>
          <h3 className="sect">Note on top of each message</h3>
          <GrowText className="input" rows={2} maxPx={140} value={curNote} onChange={e => setNote(e.target.value)} aria-label="Note on top of each message" />
          <p className="hint">{"{me}"} becomes your first name. Preview: <i>{b ? withNote(curNote, b.me, "").trim() || "(no note)" : ""}</i></p>
          <div className="row" style={{ display: "flex", gap: 8 }}>
            <button className="btn sm primary" disabled={note === null} onClick={saveNote}>Save note</button>
            <button className="btn sm" onClick={() => setNote(DEFAULT_NOTE)}>Reset to default</button>
          </div>
        </div>
      </div>
    </>
  );
}
