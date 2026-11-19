"use client";
// Task pop-up: the agent's output on the left, "your part" on the right (summary, question cards, instructions, actions).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { GrowText } from "./auto-grow";
import { WaPre, WaTask } from "./wa-card";
import remarkGfm from "remark-gfm";
import type { TaskDetail } from "@/lib/detail";
import FilePicker, { uploadAll } from "./file-picker";
import FilePreview, { kindOf, ICON } from "./file-preview";
import { Px, Emo, PxText, PxSpan, rehypePx } from "./pixel-icon";
import MentionBox, { mentionLink, keepMentionUrl } from "./mention-box";
import { encodeMentions, type Mentionable } from "@/lib/mentions";
import { answersToText } from "@/lib/digest";
import { useAutoGrow } from "./auto-grow";
import { useDraft } from "./drafts";

/** Only the ```taiga and ```whatsapp blocks of a text (they become cards). */
const actionBlocks = (text: string) => (text.match(/^```(?:taiga|whatsapp|wa)\b[\s\S]*?^```/gim) ?? []).join("\n\n");
const md = (text: string) => <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypePx]} urlTransform={keepMentionUrl} components={{ a: mentionLink, span: PxSpan, pre: WaPre }}>{text}</ReactMarkdown>;
const POLL_MS = 4000;
type Tab = "chat" | "files" | "brief";

export default function TaskPanel({ id, ws, onClose, onChanged }: { id: string; ws: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<TaskDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Mentionable[]>([]);
  const [answers, setAnswers] = useState<Record<number, Ans>>({});
  const [link, setLink] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState<{ text: string; files: string[] } | null>(null);
  const [watchUntil, setWatchUntil] = useState(0);
  const [tab, setTab] = useState<Tab>("chat");
  const [pick, setPick] = useState<string | null>(null);
  const [seen, setSeen] = useState<Set<string> | null>(null);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirm, setConfirm] = useState<null | "approve" | "done">(null);
  const body = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);
  const seenKey = `kantor-seen:${id}`;
  const markSeen = (ids: string[]) => {
    const next = new Set([...(seen ?? []), ...ids]); setSeen(next);
    try { localStorage.setItem(seenKey, JSON.stringify([...next])); } catch { /* browser storage unavailable */ }
  };

  const sig = useRef("");
  const load = useCallback(async () => {
    const r = await fetch(`/api/task/${id}?ws=${ws}`); const j = await r.json();
    if (j.error) throw new Error(j.error);
    setD(j);
    // Refresh the office only when something changed (new message / status).
    const now = `${j.messages.length}|${j.status}|${j.live.state}`;
    if (sig.current && sig.current !== now) onChanged();
    sig.current = now;
    return j as TaskDetail;
  }, [id, ws, onChanged]);

  useEffect(() => { setD(null); setErr(null); lastCount.current = 0; load().catch(e => setErr(String(e))); }, [load]);
  // Unsent feedback and answers stay as a draft in this browser, so closing the pop-up loses nothing.
  type Draft = { text: string; answers: Record<number, Ans>; mid: string | null };
  const mid = d?.digest?.messageId ?? null;
  const [draftMid, setDraftMid] = useState<string | null>(null);
  const draft = useMemo<Draft>(() => ({ text, answers, mid: mid ?? draftMid }), [text, answers, mid, draftMid]);
  const restore = useCallback((v: Draft) => { setText(v.text ?? ""); setAnswers(v.answers ?? {}); setDraftMid(v.mid ?? null); }, []);
  useDraft<Draft>(`task:${id}`, draft, restore, { text: "", answers: {}, mid: null }, v => !v.text.trim() && !Object.values(v.answers).some(a => ansText(a)));
  // Answers belong to one set of questions: when the agent posts new questions, start fresh.
  const prevMid = useRef<string | null>(null);
  useEffect(() => {
    if (!mid) return;
    const before = prevMid.current ?? draftMid;
    if (before && before !== mid) setAnswers({});
    prevMid.current = mid;
  }, [mid, draftMid]);

  // Files you have already seen (stored in this browser). The first time a task opens, everything counts as seen.
  useEffect(() => {
    if (!d || seen) return;
    let stored: string[] | null = null;
    try { const raw = localStorage.getItem(seenKey); stored = raw ? JSON.parse(raw) : null; } catch { stored = null; }
    if (stored) setSeen(new Set(stored)); else markSeen(d.artifacts.map(a => a.id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);
  useEffect(() => {
    if (tab === "files" && d && seen && d.artifacts.some(a => !seen.has(a.id))) {
      setFreshIds(new Set(d.artifacts.filter(a => !seen.has(a.id)).map(a => a.id)));
      markSeen(d.artifacts.map(a => a.id));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, d]);

  // Always open at the latest message, and follow new ones.
  useEffect(() => {
    const n = (d?.messages.length ?? 0) + (pending ? 1 : 0);
    if (n !== lastCount.current && body.current && tab === "chat") {
      lastCount.current = n;
      requestAnimationFrame(() => body.current && (body.current.scrollTop = body.current.scrollHeight));
    }
  }, [d, pending, tab]);

  const watching = !!d && (d.live.state === "running" || d.live.state === "queued" || Date.now() < watchUntil);
  useEffect(() => {
    if (!watching) return;
    const t = setInterval(() => { load().catch(() => {}); }, POLL_MS);
    return () => clearInterval(t);
  }, [watching, load]);

  // Unsaved drafts count too, so nothing you typed is ever lost when you send.
  const flat = Object.fromEntries(Object.entries(answers).map(([n, a]) => [n, ansText(a)]));
  const answerText = d?.digest?.open ? answersToText(d.digest.questions, flat) : "";
  const answered = d?.digest?.open ? d.digest.questions.filter(q => flat[q.n]?.trim()).length : 0;
  const drafts = d?.digest?.open ? d.digest.questions.filter(q => answers[q.n] && !answers[q.n].saved && flat[q.n]?.trim()).length : 0;
  // Approving closes the task, so it is only offered when every answer is a plain "OK" and nothing else is typed.
  const onlyOk = d?.digest?.open ? d.digest.questions.every(q => !flat[q.n]?.trim() || (OK.test(flat[q.n].trim()) && !answers[q.n]?.note.trim())) : true;
  // A "yes" to "May I re-run…?" / "Boleh saya…?" means the agent still has work to do, so answering must not close the task.
  const followUp = !!d?.digest?.open && d.digest.questions.some(q => flat[q.n]?.trim() && !NO.test(flat[q.n].trim()) && ACT.test(q.text));
  const hasInput = answered > 0 || !!text.trim() || files.length > 0;
  const canApprove = !hasInput || (onlyOk && !followUp && !text.trim() && files.length === 0);

  async function act(action: string, extra: Record<string, string> = {}) {
    setBusy(action); setErr(null);
    const typed = encodeMentions(text, picked).trim();
    const out = action === "rename" ? extra.text ?? "" : [answerText, typed].filter(Boolean).join("\n\n");
    const shown = action === "revise" || action === "reply" || action === "reopen" ? out : "";
    if (shown || files.length) setPending({ text: shown, files: files.map(f => f.name) });
    try {
      const fileIds = files.length ? await uploadAll(files, ws, id) : [];
      const r = await fetch(`/api/task/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ws, action, ...extra, text: out, files: fileIds }) });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setD(j); setText(""); setPicked([]); setAnswers({}); setLink(""); setFiles([]); setConfirm(null); onChanged();
      if (action === "revise" || action === "reply" || action === "rerun" || (action === "reopen" && out)) setWatchUntil(Date.now() + 3 * 60_000);
      else if (action === "approve" || action === "done") setWatchUntil(0); // closed: nobody is expected to reply
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); setPending(null); }
  }

  const jumpTo = (mid: string) => {
    setTab("chat");
    requestAnimationFrame(() => document.getElementById(`m-${mid}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const head = (
    <div className="tp-head">
      <span className="avatar">{d?.assignee.emoji ? <Emo e={d.assignee.emoji} /> : <Px name={d?.assignee.kind === "member" ? "person" : "file"} />}</span>
      <div className="meta">
        {renaming ? (
          <form onSubmit={e => { e.preventDefault(); act("rename", { text: newName }).then(() => setRenaming(false)); }} style={{ display: "flex", gap: 6 }}>
            <input id="rename" className="input" value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
            <button className="btn sm primary" disabled={!newName.trim() || !!busy}>Save</button>
            <button type="button" className="btn sm" onClick={() => setRenaming(false)}>Cancel</button>
          </form>
        ) : <h2>{d ? <PxText text={d.title} /> : "Loading…"}</h2>}
        <div className="role">{d ? [d.assignee.name ?? "Unassigned", d.project ?? "No project"].join(" · ") : ""}
          {d?.dueText && <span className={`due ${d.dueFlag ?? "ok"}`}>{d.dueFlag === "late" ? <><Px name="dot-late" /> </> : d.dueFlag === "risk" ? <><Px name="dot-risk" /> </> : d.dueFlag === "done" ? <><Px name="check" /> </> : <><Px name="calendar" /> </>}{d.dueText}</span>}
        </div>
      </div>
      <button className="x" onClick={onClose} aria-label="Close"><Px name="close" size="1em" /></button>
    </div>
  );

  if (!d) return (
    <div className="taskmodal" role="dialog" aria-modal="true">{head}
      <div className="tp-loading">{err ? <div className="note bad">{err}</div> : <div className="loading"><span className="spinner" /> Opening task…</div>}</div>
    </div>
  );

  const busyLabel: Record<string, string> = { approve: "Approving…", revise: "Sending changes…", reply: "Sending…", done: "Saving…", rename: "Saving…", rerun: "Asking the agent to retry…" };
  const fresh = seen ? d.artifacts.filter(a => !seen.has(a.id)).length : 0;
  const canSend = !!text.trim() || files.length > 0 || answered > 0;
  const dg = d.digest;
  const lastFilesMsg = [...d.messages].reverse().find(m => m.files.length > 0)?.id ?? null;

  return (
    <WaTask.Provider value={{ id, ws, title: d.title }}>
    <div className="taskmodal" role="dialog" aria-modal="true" aria-label={d.title}>
      {head}
      <div className="tp-grid">
        {/* ---- Left: what the agent produced ---- */}
        <section className="tp-out" aria-label="Agent output">
          <div className="tp-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "chat"} onClick={() => setTab("chat")}><Px name="chat" /> Conversation <small>{d.messages.length}</small></button>
            {d.artifacts.length > 0 && <button role="tab" aria-selected={tab === "files"} onClick={() => setTab("files")}><Px name="folder" /> Files <small>{d.artifacts.length}</small>{fresh > 0 && <span className="newbadge">{fresh} new</span>}</button>}
            {d.brief && <button role="tab" aria-selected={tab === "brief"} onClick={() => setTab("brief")}><Px name="todo" /> Brief</button>}
          </div>
          <div className="tp-scroll" ref={body}>
            {tab === "chat" && (
              <div className="thread">
                {/* Cards an agent put in the brief (Taiga activities, WhatsApp drafts) are shown here too, so they aren't hidden in the Brief tab. */}
                {actionBlocks(d.brief) && (
                  <div className="msg bot">
                    <div className="from"><span><Px name="todo" /> From the brief</span><span /></div>
                    <div className="md">{md(actionBlocks(d.brief))}</div>
                  </div>
                )}
                {d.messages.length === 0 && !pending && !actionBlocks(d.brief) && <p className="desc">No messages yet. The agent will post results here.</p>}
                {d.messages.map(m => (
                  <div key={m.id} id={`m-${m.id}`} className={`msg ${m.whoKind === "member" ? "me" : "bot"} ${dg?.messageId === m.id ? "hl" : ""}`}>
                    <div className="from"><span>{m.emoji ? <><Emo e={m.emoji} /> </> : null}{m.who}</span><span>{m.when}</span></div>
                    {m.text && <div className="md">{md(m.text)}</div>}
                    {/* The newest files are previewed right here in the conversation, so revisions can be checked without leaving. */}
                    {m.id === lastFilesMsg && m.files.map(f => <FilePreview key={f.id} f={f} />)}
                    {(m.images.length > 0 || (m.files.length > 0 && m.id !== lastFilesMsg)) && (
                      <div className="minifiles">
                        {m.images.map(f => <button key={f.id} className="mini-img" onClick={() => { setPick(f.id); setTab("files"); }} title={`View ${f.name}`}><img src={f.url} alt={f.name} /></button>)}
                        {m.id !== lastFilesMsg && m.files.map(f => <button key={f.id} className="chip" onClick={() => { setPick(f.id); setTab("files"); }}><Px name="clip" /> {f.name}</button>)}
                      </div>
                    )}
                  </div>
                ))}
                {pending && (
                  <div className="msg me sending">
                    <div className="from"><span>You</span><span><span className="spinner sm" /> sending…</span></div>
                    {pending.text && <div className="md">{md(pending.text)}</div>}
                    {pending.files.length > 0 && <div className="chips">{pending.files.map(f => <span key={f} className="chip"><Px name="clip" /> {f}</span>)}</div>}
                  </div>
                )}
                {d.live.state !== "idle" && (
                  <div className={`live live-${d.live.state}`} role="status">
                    {d.live.state === "running" || d.live.state === "queued" ? <span className="dots"><i /><i /><i /></span> : null}<PxText text={d.live.label} />
                  </div>
                )}
                {d.live.state === "idle" && d.mode === "closed" && (
                  <div className="live live-closed" role="status"><Px name="done" /> {/^(done|completed)$/.test(d.status) ? "Done and closed. Nothing more is needed from you or the agent." : "This task is closed."}</div>
                )}
                {d.live.state === "idle" && d.mode !== "closed" && Date.now() < watchUntil && (
                  <div className="live live-queued" role="status"><span className="dots"><i /><i /><i /></span>Sent. Waiting for {d.assignee.name ?? "the agent"} to respond…</div>
                )}
              </div>
            )}
            {tab === "files" && (
              <div className="pinpanel flat">
                <div className="tiles">
                  {d.artifacts.map((a, i) => (
                    <button key={a.id} className="tile" aria-pressed={(pick ?? d.artifacts[0].id) === a.id} onClick={() => setPick(a.id)} title={a.name}>
                      {a.image ? <img src={a.url} alt="" /> : <span className="tile-icon"><Px name={ICON[kindOf(a.name)]} /></span>}
                      {freshIds.has(a.id) && <span className="newbadge tile-new">New</span>}
                      <span className="tile-name">{a.name}</span>
                      <small>{i === 0 ? "Latest · " : ""}{a.from} · {a.when}</small>
                    </button>
                  ))}
                </div>
                {(() => { const a = d.artifacts.find(x => x.id === (pick ?? d.artifacts[0].id)) ?? d.artifacts[0]; return <FilePreview key={a.id} f={a} />; })()}
              </div>
            )}
            {tab === "brief" && <div className="md tp-brief">{md(d.brief)}</div>}
            <details className="extra">
              <summary>More info</summary>
              <p className="desc">Code: {d.key} · Original title: {d.originalTitle}</p>
              <div className="chiprow">
                <button className="btn sm" onClick={() => { setNewName(d.title); setRenaming(true); }}>Rename</button>
                <a className="btn sm" href={d.url} target="_blank" rel="noreferrer">Open in Multica</a>
              </div>
            </details>
          </div>
        </section>

        {/* ---- Right: your part ---- */}
        <section className="tp-you" aria-label="Your part">
          <div className="tp-scroll">
            <div className={`situation m-${d.mode}`}><b><PxText text={d.situation} /></b></div>

            {dg && dg.summary.length > 0 && (
              <div className="digest">
                <div className="dg-head"><b><Px name="sparkle" /> Summary</b><small>from {dg.from} · {dg.when}</small></div>
                <ul>{dg.summary.map((s, i) => <li key={i}>{s}</li>)}</ul>
                <button className="more" onClick={() => jumpTo(dg.messageId)}>Read the full output <Px name="next" size="0.8em" /></button>
              </div>
            )}

            {dg?.open && dg.questions.length > 0 && d.mode !== "closed" && (
              <div className="qcards">
                <div className="dg-head"><b><Px name="person" /> {dg.from} needs your answer</b><small>{answered}/{dg.questions.length} answered</small></div>
                {dg.questions.map(q => (
                  <QCard key={q.n} q={q} a={answers[q.n] ?? EMPTY} onChange={a => setAnswers(cur => ({ ...cur, [q.n]: a }))} />
                ))}
              </div>
            )}

            {d.mode !== "closed" && (
              <div className="tp-compose">
                {err && <div className="note bad">{err}</div>}
                {busy ? <div className="loading"><span className="spinner" /> {busyLabel[busy] ?? "Working…"}</div>
                  : confirm ? (
                    <div className="confirm">
                      <span>{confirm === "approve" ? (answered ? "Send your OK and close this task?" : "Approve and close this task?") : "Mark as done? The next agent can continue."}</span>
                      <div className="row">
                        <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
                        <button className="btn primary" onClick={() => act(confirm, confirm === "done" ? { link } : {})}>Yes, continue</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {d.mode === "human" && (
                        <>
                          <label htmlFor="proof" className="sect">Link to the result (optional)</label>
                          <input id="proof" className="input" type="url" placeholder="https://…" value={link} onChange={e => setLink(e.target.value)} />
                        </>
                      )}
                      <label htmlFor="msg" className="sect">{dg?.open && dg.questions.length ? "Anything else? (optional)" : d.mode === "review" ? "Feedback for the agent" : d.mode === "human" ? "Note (optional)" : "Instructions"}</label>
                      <MentionBox id="msg" value={text} onChange={setText} people={d.people} picked={picked} onPick={setPicked}
                        onPaste={e => { const p = [...e.clipboardData.files]; if (p.length) { e.preventDefault(); setFiles([...files, ...p]); } }}
                        placeholder={d.mode === "review" ? "Ask for changes, or leave empty to approve. Type @ to bring someone in." : "Type a message… Type @ to bring someone in."} />
                      {picked.some(p => text.includes("@" + p.name)) && (
                        <p className="hint"><Px name="mention" /> Mentioning: {picked.filter(p => text.includes("@" + p.name)).map(p => `${p.name} (${p.kind === "agent" ? "will reply right away" : "gets a notification"})`).join(", ")}</p>
                      )}
                      <FilePicker files={files} onChange={setFiles} />
                      {drafts > 0 && <p className="hint"><Px name="edit" /> {drafts} answer{drafts > 1 ? "s are" : " is"} not saved yet. They will be sent as typed.</p>}
                      <div className="row">
                        {!d.assignee.online && d.assignee.kind === "agent" && <span className="hint"><Px name="moon" /> Laptop off: the agent picks this up when it&apos;s back on.</span>}
                        {d.mode === "review" && (canApprove && !hasInput ? <>
                          <button className="btn" disabled title="Answer a question or type feedback first"><Px name="edit" /> Request changes</button>
                          <button className="btn primary" onClick={() => setConfirm("approve")}><Px name="done" /> Approve</button>
                        </> : canApprove ? <>
                          <button className="btn" onClick={() => act("revise")}><Px name="edit" /> Send without closing</button>
                          <button className="btn primary" onClick={() => setConfirm("approve")}><Px name="done" /> Approve &amp; close</button>
                        </> : <>
                          <span className="hint">{followUp ? `${d.assignee.name ?? "The agent"} still has work to do after your answer, so the task stays open.` : "Your answers include corrections, so the task stays open for the agent."}</span>
                          <button className="btn primary" onClick={() => act("revise")}><Px name={followUp ? "play" : "edit"} /> {followUp ? "Send & let the agent continue" : answered ? `Submit ${answered} answer${answered > 1 ? "s" : ""}` : "Send changes"}</button>
                        </>)}
                        {d.mode === "human" && <>
                          <button className="btn" onClick={onClose}><Px name="pause" /> Not yet</button>
                          <button className="btn primary" onClick={() => setConfirm("done")}><Px name="done" /> Done</button>
                        </>}
                        {(d.mode === "working" || d.mode === "waiting") && (
                          <button className="btn primary" disabled={!canSend} onClick={() => act("reply")}>{answered ? `Submit ${answered} answer${answered > 1 ? "s" : ""}` : "Send"}</button>
                        )}
                      </div>
                    </>
                  )}
              </div>
            )}
            {d.mode === "closed" && (
              <div className="reopen">
                <h3 className="sect">Need more on this?</h3>
                <GrowText className="input" rows={2} maxPx={240} value={text} onChange={e => setText(e.target.value)} aria-label="What else is needed"
                  placeholder={d.assignee.kind === "agent" ? `Tell ${d.assignee.name ?? "the agent"} what else is needed (optional)` : "What else is needed? (optional)"} />
                <p className="hint">{text.trim()
                  ? `Reopens the task and ${d.assignee.kind === "agent" ? `${d.assignee.name ?? "the agent"} starts on it` : `${d.assignee.name ?? "they"} get it back as a to-do`}.`
                  : "Reopens the task for review without waking anyone."}</p>
                <div className="row"><button className="btn primary" disabled={!!busy} onClick={() => act("reopen")}>{busy === "reopen" ? <><span className="spinner sm" /> Reopening…</> : <><Px name="refresh" /> Reopen</>}</button></div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
    </WaTask.Provider>
  );
}

// ---- One question from the agent: pick an option and/or write a note, then Save (Edit to change it) ----
type Ans = { opt: string; note: string; saved: boolean };
const EMPTY: Ans = { opt: "", note: "", saved: false };
/** Questions where a yes means the agent will go and do more work. */
const ACT = /\b(boleh(kah)? saya|apakah saya (boleh|perlu|harus)|perlu(kah)? saya|mau(kah)? saya|saya (lanjut|lanjutkan|jalankan|kerjakan|buat|kirim|alihkan|ulang)|lanjut(kan)?\b.*\?|jalankan ulang|run ulang|may i|shall i|should i|can i|do you want me|want me to|ok to (proceed|continue|run)|go ahead)/i;
const NO = /^(no|tidak|nggak|ga|gak|jangan|tunda|nanti|pertahankan|keep)\b/i;
const OK = /^(ok|oke|okay|okey|yes|ya|iya|setuju|sesuai|approve[d]?|lgtm|sudah sesuai|good)\b/i;
const ansText = (a?: Ans) => !a ? "" : a.opt && a.note.trim() ? `${a.opt} — ${a.note.trim()}` : a.opt || a.note.trim();

function QCard({ q, a, onChange }: { q: { n: number; text: string; options: string[] }; a: Ans; onChange: (a: Ans) => void }) {
  const box = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(box, a.note, 220);
  const has = !!ansText(a);
  return (
    <div className={`qcard ${a.saved && has ? "done" : has ? "draft" : ""}`}>
      <div className="qc-q"><span className="qc-n">{q.n}</span><span>{q.text}</span></div>
      {a.saved && has ? (
        <div className="qc-saved">
          <span className="qc-ans">{ansText(a)}</span>
          <button type="button" className="btn sm" onClick={() => { onChange({ ...a, saved: false }); requestAnimationFrame(() => box.current?.focus()); }}><Px name="edit" /> Edit</button>
        </div>
      ) : (
        <>
          {q.options.length > 0 && (
            <div className="qc-opts">{q.options.map(o => (
              <button key={o} type="button" aria-pressed={a.opt === o} onClick={() => onChange({ ...a, opt: a.opt === o ? "" : o })}>{o}</button>
            ))}</div>
          )}
          <textarea ref={box} className="input qc-note" rows={1} value={a.note}
            placeholder={q.options.length ? (a.opt ? `Add details to "${a.opt}" (optional)…` : "Or type your own answer…") : "Your answer…"}
            onChange={e => onChange({ ...a, note: e.target.value })}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && has) { e.preventDefault(); onChange({ ...a, saved: true }); } }} />
          <div className="qc-actions">
            {has && <button type="button" className="btn sm" onClick={() => onChange(EMPTY)}>Clear</button>}
            <button type="button" className="btn sm primary" disabled={!has} onClick={() => onChange({ ...a, saved: true })}><Px name="check" /> Save</button>
          </div>
        </>
      )}
    </div>
  );
}

