"use client";
import { useEffect, useRef, useState } from "react";
import { uploadAll } from "./file-picker";
import { MANAGER } from "./chat-panel";
import { readActiveChatId, writeActiveChatId } from "@/lib/chat-continuity";

type Agent = { id: string; name: string };
type Mode = "note" | "screenshot" | "meeting" | "voice";
const HINT: Record<Mode, string> = {
  note: "Share this note and tell me what to do next:",
  screenshot: "Please review this screenshot and help me with:",
  meeting: "Please transcribe this meeting recording, summarize decisions, and list next actions.",
  voice: "Please transcribe this voice note and help me act on it.",
};

export default function Stapler({ ws }: { ws: string }) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [mode, setMode] = useState<Mode>("note");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [startNewTopic, setStartNewTopic] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.altKey && e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); if (recorder.current?.state === "recording") recorder.current.stop(); setHidden(false); setOpen(v => !v); } else if (e.key === "Escape") { if (recorder.current?.state === "recording") recorder.current.stop(); setOpen(false); } };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, []);
  useEffect(() => { if (!recording) return; const t = setInterval(() => setSeconds(s => s + 1), 1000); return () => clearInterval(t); }, [recording]);
  useEffect(() => { if (!file) { setPreview(null); return; } const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url); }, [file]);
  useEffect(() => { if (!open) return; let live = true; fetch(`/api/chat?ws=${encodeURIComponent(ws)}`).then(r => r.json()).then(j => { if (j.error) throw new Error(j.error); if (!live) return; const list = (j.agents ?? []) as Agent[]; setAgents(list); setAgentId(old => list.some(a => a.id === old) ? old : list.find(a => a.name.toLowerCase() === MANAGER.toLowerCase())?.id ?? list[0]?.id ?? ""); }).catch(e => { if (live) setError(String(e.message ?? e)); }); return () => { live = false; }; }, [open, ws]);
  useEffect(() => () => { recorder.current?.state === "recording" && recorder.current.stop(); stream.current?.getTracks().forEach(t => t.stop()); }, []);

  const choose = (next: Mode) => { if (recording) return; setMode(next); setFile(null); setNote(next === "note" ? "" : HINT[next]); setSent(null); setError(null); };
  const close = () => { if (recording) stopAudio(); setOpen(false); };
  async function screenshot() {
    choose("screenshot"); setError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) { setError("Screen capture is unavailable in this browser."); return; }
    root.current?.setAttribute("data-capture", "true");
    let display: MediaStream | null = null;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement("video"); video.muted = true;
      const loaded = new Promise<void>((resolve, reject) => { video.onloadedmetadata = () => resolve(); video.onerror = () => reject(new Error("Could not load screen frame.")); });
      video.srcObject = display; await loaded;
      await video.play();
      const canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext("2d")?.drawImage(video, 0, 0);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Could not create screenshot.");
      setFile(new File([blob], `screenshot-${Date.now()}.png`, { type: "image/png" }));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { display?.getTracks().forEach(t => t.stop()); root.current?.removeAttribute("data-capture"); }
  }
  async function startAudio(next: "meeting" | "voice") {
    choose(next); setSeconds(0);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setError("Microphone recording is unavailable in this browser."); return; }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.current = mic;
      const mime = ["audio/webm", "audio/mp4"].find(t => MediaRecorder.isTypeSupported(t));
      const chunks: Blob[] = []; const rec = new MediaRecorder(mic, mime ? { mimeType: mime } : undefined); recorder.current = rec;
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => { const type = rec.mimeType || mime || "audio/webm"; const ext = type.includes("mp4") ? "m4a" : "webm"; if (chunks.length) setFile(new File(chunks, `${next}-${Date.now()}.${ext}`, { type })); else setError("Recording is empty. Please try again."); mic.getTracks().forEach(t => t.stop()); stream.current = null; setRecording(false); };
      rec.onerror = () => { setError("Recording failed. Please try again."); setRecording(false); mic.getTracks().forEach(t => t.stop()); };
      rec.start(1000); setRecording(true);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  function stopAudio() { if (recorder.current?.state === "recording") recorder.current.stop(); }
  async function send() {
    if (busy || recording || !agentId || (!note.trim() && !file)) return;
    if (file && file.size > 25 * 1024 * 1024) { setError("Files must be 25 MB or smaller. Record a shorter clip."); return; }
    setBusy(true); setError(null);
    try {
      const title = note.trim().split("\n")[0].slice(0, 60) || (file?.name ?? "Stapler capture");
      const ids = file ? await uploadAll([file], ws) : [];
      let sid = !startNewTopic ? readActiveChatId(ws, agentId) : null;
      const ensureSession = async (reuseLatest: boolean) => {
        const created = await (await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ws, agentId, title, reuseLatest }),
        })).json();
        if (created.error || !created.id) throw new Error(created.error || "Could not start chat.");
        return created.id as string;
      };
      if (!sid) sid = await ensureSession(!startNewTopic);
      writeActiveChatId(ws, agentId, sid);
      let res = await fetch(`/api/chat/${encodeURIComponent(sid)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ws, text: note, files: ids }),
      });
      if (!res.ok && res.status >= 400 && res.status < 500 && !startNewTopic) {
        writeActiveChatId(ws, agentId, null);
        sid = await ensureSession(true);
        writeActiveChatId(ws, agentId, sid);
        res = await fetch(`/api/chat/${encodeURIComponent(sid)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ws, text: note, files: ids }),
        });
      }
      const result = await res.json();
      if (!res.ok || result.error) throw new Error(result.error || "Could not send message.");
      setSent(agents.find(a => a.id === agentId)?.name ?? "agent"); setFile(null); setNote(""); setStartNewTopic(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  if (hidden) return null;
  return <div className="stapler-root" ref={root}>
    <button className="stapler-fab" aria-label="Open Stapler" aria-expanded={open} onClick={() => { if (open) close(); else setOpen(true); }}><span className="stapler-face">••</span><span>Stapler</span></button>
    {open && <section className="stapler-panel" role="dialog" aria-label="Stapler quick capture">
      <header><span className="stapler-face">••</span><div><b>Stapler</b><small>Capture, review, send to your team</small></div><button onClick={close} aria-label="Close Stapler">×</button></header>
      <div className="stapler-actions"><button onClick={screenshot} disabled={recording}>▣<span>Screenshot</span></button><button onClick={() => startAudio("meeting")} disabled={recording}>◉<span>Meeting</span></button><button onClick={() => startAudio("voice")} disabled={recording}>♬<span>Voice note</span></button><button onClick={() => choose("note")} disabled={recording}>✎<span>Quick note</span></button></div>
      {recording && <div className="stapler-record"><i /> Recording {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} <button onClick={stopAudio}>Stop & review</button></div>}
      {file && preview && <div className="stapler-preview"><div><b>{file.name}</b><button onClick={() => setFile(null)} aria-label="Remove capture">Remove</button></div>{file.type.startsWith("image/") ? <img src={preview} alt="Screenshot preview" /> : <audio controls src={preview} />}</div>}
      <button className="stapler-attach" disabled={recording} onClick={() => input.current?.click()}>＋ Attach existing file</button><input ref={input} type="file" hidden accept="image/*,audio/*,video/*,.pdf,.txt,.docx" onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); setError(null); } e.target.value = ""; }} />
      <label>Send to<select value={agentId} onChange={e => setAgentId(e.target.value)}><option value="">Choose agent</option>{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label className="stapler-check"><input type="checkbox" checked={startNewTopic} onChange={e => setStartNewTopic(e.target.checked)} /> Start a new topic (otherwise continues active chat)</label>
      <textarea value={note} onChange={e => setNote(e.target.value)} aria-label={`Instructions for ${mode}`} placeholder="Add context or instructions…" rows={3} />
      {error && <p className="stapler-error" role="alert">{error}</p>}{sent && <p className="stapler-sent" role="status">Sent to {sent}. Open the agent&apos;s chat to see the reply.</p>}
      <footer><button disabled={recording} onClick={() => { setOpen(false); setHidden(true); }}>Hide widget</button><button className="send" disabled={busy || recording || !agentId || (!note.trim() && !file)} onClick={send}>{busy ? "Sending…" : "Send →"}</button></footer>
      <small className="stapler-hint">Shortcut: ⌥⇧S · You review everything before it is sent.</small>
    </section>}
  </div>;
}
