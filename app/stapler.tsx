"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { uploadAll } from "./file-picker";
import { MANAGER } from "@/lib/manager";
import CharacterFace from "./character-face";
import { readActiveChatId, writeActiveChatId } from "@/lib/chat-continuity";

type Agent = { id: string; name: string; face?: string | null; role?: string | null };
type Mode = "screenshot" | "meeting" | "voice" | "note";
type Mood = "idle" | "nudge" | "open" | "recording" | "happy";

const MAX_BYTES = 25 * 1024 * 1024;
const NUDGE_MUTE_KEY = "kantor:stapler-nudges-muted";
const FIRST_NUDGE_MS = 7_500;
const REPEAT_NUDGE_MS = 48_000;
const NUDGE_VISIBLE_MS = 6_500;

const HINT: Record<Mode, string> = {
  screenshot: "Please review this screenshot and help me with:",
  meeting: "Please transcribe this meeting recording, summarize decisions, and list next actions.",
  voice: "Please transcribe this voice note and help me act on it.",
  note: "",
};

const MODE_HELPER: Record<Mode, string> = {
  screenshot: "Capture your screen, paste with ⌘V, or drop an image below.",
  meeting: "Record live audio — Stapler packages it for summary & action items.",
  voice: "Record a quick spoken brief and hand it straight to an agent.",
  note: "Jot a quick brief, drop any doc, and press ⌘↵ to dispatch.",
};

const STARTER_CHIPS: Record<Mode, { label: string; text: string }[]> = {
  screenshot: [
    { label: "Review UI", text: "Please review this screenshot for visual polish, layout spacing, and UX improvements." },
    { label: "Find bugs", text: "Please inspect this screenshot, identify the issue, and suggest a fix." },
    { label: "Turn into task", text: "Turn what is shown in this screenshot into an actionable task with clear acceptance criteria." },
  ],
  meeting: [
    { label: "Decisions & actions", text: "Please transcribe this meeting, summarize key decisions, and list next action items with owners." },
    { label: "Executive summary", text: "Give me a concise 5-bullet executive summary from this meeting recording." },
    { label: "Follow-up draft", text: "Summarize this meeting and draft a crisp follow-up message for the team." },
  ],
  voice: [
    { label: "Transcribe & act", text: "Please transcribe this voice note and turn it into concrete next steps." },
    { label: "Create task", text: "Convert this voice note into a clear task brief ready to execute." },
    { label: "Draft reply", text: "Turn this voice note into a polished, ready-to-send reply." },
  ],
  note: [
    { label: "Create task", text: "Turn this note into a clear, actionable task with next steps:" },
    { label: "Research this", text: "Please research this topic and share concise recommendations:" },
    { label: "Quick update", text: "Share this status update and tell me what needs attention next:" },
  ],
};

const NUDGES: { mode: Mode; tag: string; text: string }[] = [
  { mode: "screenshot", tag: "Quick snap", text: "Spot something? Capture a screen for the team" },
  { mode: "voice", tag: "Voice → task", text: "Record a quick voice brief in one click" },
  { mode: "meeting", tag: "Meeting AI", text: "Record a meeting for instant action items" },
  { mode: "note", tag: "Shortcut ⌥⇧S", text: "Drop a file or paste ⌘V straight to any agent" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatClock(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function ModeIcon({ mode }: { mode: Mode }) {
  if (mode === "screenshot") {
    return (
      <svg className="stapler-ic" width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M3.5 7V5.2A1.7 1.7 0 0 1 5.2 3.5H7M13 3.5h1.8a1.7 1.7 0 0 1 1.7 1.7V7M16.5 13v1.8a1.7 1.7 0 0 1-1.7 1.7H13M7 16.5H5.2a1.7 1.7 0 0 1-1.7-1.7V13" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        <rect x="6.75" y="6.75" width="6.5" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  }
  if (mode === "meeting") {
    return (
      <svg className="stapler-ic" width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.65" />
        <circle cx="10" cy="10" r="2.8" fill="currentColor" />
      </svg>
    );
  }
  if (mode === "voice") {
    return (
      <svg className="stapler-ic" width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="7.5" y="3.2" width="5" height="8.6" rx="2.5" stroke="currentColor" strokeWidth="1.65" />
        <path d="M5 9.8a5 5 0 0 0 10 0M10 14.8V17M7.5 17h5" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className="stapler-ic" width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M13.6 3.7a1.8 1.8 0 0 1 2.55 2.55L7.9 14.5 4.2 15.6l1.1-3.7 8.3-8.2Z" stroke="currentColor" strokeWidth="1.65" strokeLinejoin="round" />
      <path d="M11.8 5.5 14.3 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function StaplerFace({ mood = "idle", size = "md" }: { mood?: Mood; size?: "md" | "lg" }) {
  return (
    <span className={`stapler-face is-${mood} sz-${size}`} aria-hidden="true">
      <span className="stapler-eyes">
        <i />
        <i />
      </span>
      <span className="stapler-cheeks">
        <i />
        <i />
      </span>
      <span className="stapler-smile" />
    </span>
  );
}

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
  const [sent, setSent] = useState<{ agentId: string; name: string; sessionId: string } | null>(null);
  const [startNewTopic, setStartNewTopic] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fabDragOver, setFabDragOver] = useState(false);

  // Periodic contextual nudge state (respectful, dismissible, paused on hover/focus)
  const [nudgesMuted, setNudgesMuted] = useState(false);
  const [nudgeIdx, setNudgeIdx] = useState<number | null>(null);
  const nudgeCursor = useRef(0);
  const nudgePaused = useRef(false);
  const nudgeHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragDepth = useRef(0);

  // Restore session nudge mute preference on client only
  useEffect(() => {
    try {
      if (sessionStorage.getItem(NUDGE_MUTE_KEY) === "1") setNudgesMuted(true);
    } catch { /* ignore storage errors */ }
  }, []);

  // Global keyboard shortcuts: Option+Shift+S toggles Stapler; Escape closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (recorder.current?.state === "recording") recorder.current.stop();
        setHidden(false);
        setNudgeIdx(null);
        setOpen(v => !v);
      } else if (e.key === "Escape" && open) {
        if (recorder.current?.state === "recording") recorder.current.stop();
        setOpen(false);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open]);

  // Recording clock
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  // Local object URL for image/audio previews
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Fetch workspace agents (with illustrated faces & roles) whenever panel opens
  useEffect(() => {
    if (!open) return;
    let live = true;
    fetch(`/api/chat?ws=${encodeURIComponent(ws)}`)
      .then(r => r.json())
      .then(j => {
        if (j.error) throw new Error(j.error);
        if (!live) return;
        const list = (j.agents ?? []) as Agent[];
        setAgents(list);
        setAgentId(old =>
          list.some(a => a.id === old)
            ? old
            : list.find(a => a.name.toLowerCase() === MANAGER.toLowerCase())?.id ?? list[0]?.id ?? "",
        );
      })
      .catch(e => {
        if (live) setError(String(e.message ?? e));
      });
    return () => { live = false; };
  }, [open, ws]);

  // Cleanup recorder & streams on unmount
  useEffect(() => () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach(t => t.stop());
    if (nudgeHideTimer.current) clearTimeout(nudgeHideTimer.current);
  }, []);

  // Periodic contextual nudge bubble scheduler
  const scheduleNudgeHide = useCallback(() => {
    if (nudgeHideTimer.current) clearTimeout(nudgeHideTimer.current);
    nudgeHideTimer.current = setTimeout(() => {
      if (!nudgePaused.current) setNudgeIdx(null);
    }, NUDGE_VISIBLE_MS);
  }, []);

  useEffect(() => {
    if (open || hidden || nudgesMuted || recording) {
      setNudgeIdx(null);
      if (nudgeHideTimer.current) clearTimeout(nudgeHideTimer.current);
      return;
    }
    const trigger = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const idx = nudgeCursor.current % NUDGES.length;
      nudgeCursor.current += 1;
      setNudgeIdx(idx);
      scheduleNudgeHide();
    };
    const first = setTimeout(trigger, FIRST_NUDGE_MS);
    const repeat = setInterval(trigger, REPEAT_NUDGE_MS);
    return () => {
      clearTimeout(first);
      clearInterval(repeat);
      if (nudgeHideTimer.current) clearTimeout(nudgeHideTimer.current);
    };
  }, [open, hidden, nudgesMuted, recording, scheduleNudgeHide]);

  const muteNudges = () => {
    setNudgeIdx(null);
    setNudgesMuted(true);
    try { sessionStorage.setItem(NUDGE_MUTE_KEY, "1"); } catch { /* ignore */ }
  };

  const selectedAgent = useMemo(
    () => agents.find(a => a.id === agentId) ?? null,
    [agents, agentId],
  );

  // Quick-switch chips: prioritize manager + meeting/secretary + next agents (max 6)
  const quickAgents = useMemo(() => {
    if (agents.length <= 1) return [];
    const score = (a: Agent) => {
      const hay = `${a.name} ${a.role ?? ""}`.toLowerCase();
      if (a.name.toLowerCase() === MANAGER.toLowerCase()) return 0;
      if (mode === "meeting" && /meeting|secretary|ops|chief/.test(hay)) return 1;
      if (mode === "screenshot" && /design|ui|qa|front|eng|product/.test(hay)) return 1;
      return 2;
    };
    return [...agents].sort((a, b) => score(a) - score(b)).slice(0, 6);
  }, [agents, mode]);

  const attachFile = useCallback((f: File, forcedMode?: Mode) => {
    if (f.size > MAX_BYTES) {
      setError(`"${f.name}" is ${formatBytes(f.size)}. Files must be 25 MB or smaller.`);
      return;
    }
    setFile(f);
    setError(null);
    setSent(null);
    if (forcedMode) {
      setMode(forcedMode);
    } else if (f.type.startsWith("image/")) {
      setMode("screenshot");
    } else if (f.type.startsWith("audio/")) {
      setMode(m => (m === "meeting" ? "meeting" : "voice"));
    }
  }, []);

  const choose = (next: Mode, keepFile = false) => {
    if (recording) return;
    setMode(next);
    if (!keepFile) setFile(null);
    setNote(prev => {
      const trimmed = prev.trim();
      const isDefaultHint = Object.values(HINT).some(h => h && h === trimmed);
      if (!trimmed || isDefaultHint) return HINT[next];
      return prev;
    });
    setSent(null);
    setError(null);
  };

  const close = () => {
    if (recording) stopAudio();
    setOpen(false);
  };

  async function screenshot() {
    choose("screenshot");
    setError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("Screen capture is unavailable in this browser. You can paste (⌘V) or drop an image instead.");
      return;
    }
    root.current?.setAttribute("data-capture", "true");
    let display: MediaStream | null = null;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement("video");
      video.muted = true;
      const loaded = new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("Could not load screen frame."));
      });
      video.srcObject = display;
      await loaded;
      await video.play();
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")?.drawImage(video, 0, 0);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Could not create screenshot.");
      setFile(new File([blob], `screenshot-${Date.now()}.png`, { type: "image/png" }));
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (e) {
      if (e instanceof Error && e.name === "NotAllowedError") {
        setError("Screen capture was canceled. You can also paste (⌘V) or drop an image.");
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      display?.getTracks().forEach(t => t.stop());
      root.current?.removeAttribute("data-capture");
    }
  }

  async function startAudio(next: "meeting" | "voice") {
    choose(next);
    setSeconds(0);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Microphone recording is unavailable in this browser. Attach an audio file instead.");
      return;
    }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = mic;
      const mime = ["audio/webm", "audio/mp4"].find(t => MediaRecorder.isTypeSupported(t));
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(mic, mime ? { mimeType: mime } : undefined);
      recorder.current = rec;
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        const type = rec.mimeType || mime || "audio/webm";
        const ext = type.includes("mp4") ? "m4a" : "webm";
        if (chunks.length) {
          setFile(new File(chunks, `${next}-${Date.now()}.${ext}`, { type }));
        } else {
          setError("Recording is empty. Please try again.");
        }
        mic.getTracks().forEach(t => t.stop());
        stream.current = null;
        setRecording(false);
      };
      rec.onerror = () => {
        setError("Recording failed. Please try again.");
        setRecording(false);
        mic.getTracks().forEach(t => t.stop());
      };
      rec.start(1000);
      setRecording(true);
    } catch (e) {
      if (e instanceof Error && e.name === "NotAllowedError") {
        setError("Microphone access was denied. Allow mic access or attach an audio file.");
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }

  function stopAudio() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  const handlePaste = (e: ClipboardEvent<HTMLElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.kind === "file") {
        const pasted = item.getAsFile();
        if (pasted) {
          e.preventDefault();
          const ext = pasted.type.split("/")[1]?.split(";")[0] || "png";
          const named = pasted.name && pasted.name !== "image.png"
            ? pasted
            : new File([pasted], `clipboard-${Date.now()}.${ext}`, { type: pasted.type || "image/png" });
          attachFile(named, pasted.type.startsWith("image/") ? "screenshot" : undefined);
          return;
        }
      }
    }
  };

  const handlePanelDragEnter = (e: DragEvent<HTMLElement>) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  };

  const handlePanelDragOver = (e: DragEvent<HTMLElement>) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handlePanelDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };

  const handlePanelDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    const dropped = e.dataTransfer?.files?.[0];
    if (dropped && !recording) attachFile(dropped);
  };

  const handleFabDragOver = (e: DragEvent<HTMLButtonElement>) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setFabDragOver(true);
  };

  const handleFabDrop = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setFabDragOver(false);
    const dropped = e.dataTransfer?.files?.[0];
    if (dropped) {
      setNudgeIdx(null);
      setOpen(true);
      attachFile(dropped);
    }
  };

  const handleTextareaKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void send();
    }
  };

  async function send() {
    if (busy || recording || !agentId || (!note.trim() && !file)) return;
    if (file && file.size > MAX_BYTES) {
      setError("Files must be 25 MB or smaller. Record a shorter clip.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const bodyText = note.trim() || HINT[mode] || `Attached ${file?.name ?? "capture"}`;
      const title = bodyText.split("\n")[0].slice(0, 60) || (file?.name ?? "Stapler capture");
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
        body: JSON.stringify({ ws, text: bodyText, files: ids }),
      });
      if (!res.ok && res.status >= 400 && res.status < 500 && !startNewTopic) {
        writeActiveChatId(ws, agentId, null);
        sid = await ensureSession(true);
        writeActiveChatId(ws, agentId, sid);
        res = await fetch(`/api/chat/${encodeURIComponent(sid)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ws, text: bodyText, files: ids }),
        });
      }
      const result = await res.json();
      if (!res.ok || result.error) throw new Error(result.error || "Could not send message.");

      const targetName = agents.find(a => a.id === agentId)?.name ?? "agent";
      setSent({ agentId, name: targetName, sessionId: sid });
      setFile(null);
      setNote("");
      setStartNewTopic(false);
      setCelebrating(true);
      setTimeout(() => setCelebrating(false), 2800);

      // Animate live letter delivery to the agent's desk on the office floor
      window.dispatchEvent(new CustomEvent("kantor:letter", { detail: { agentId } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const openAgentChat = (targetAgentId: string, sessionId?: string | null) => {
    window.dispatchEvent(new CustomEvent("kantor:chat", { detail: { agentId: targetAgentId, sessionId: sessionId ?? null } }));
    setOpen(false);
  };

  const openFromNudge = (suggested: Mode) => {
    setNudgeIdx(null);
    setOpen(true);
    choose(suggested, true);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  if (hidden) return null;

  const activeNudge = nudgeIdx !== null && !open && !recording ? NUDGES[nudgeIdx] : null;
  const mood: Mood = recording ? "recording" : celebrating ? "happy" : activeNudge ? "nudge" : open ? "open" : "idle";
  const canSend = !busy && !recording && !!agentId && (!!note.trim() || !!file);

  return (
    <div className="stapler-root" ref={root}>
      {activeNudge && (
        <div
          className="stapler-nudge"
          role="status"
          aria-live="polite"
          onMouseEnter={() => { nudgePaused.current = true; }}
          onMouseLeave={() => { nudgePaused.current = false; scheduleNudgeHide(); }}
          onFocus={() => { nudgePaused.current = true; }}
          onBlur={() => { nudgePaused.current = false; scheduleNudgeHide(); }}
        >
          <button
            type="button"
            className="stapler-nudge-body"
            onClick={() => openFromNudge(activeNudge.mode)}
          >
            <span className="stapler-nudge-ic"><ModeIcon mode={activeNudge.mode} /></span>
            <span className="stapler-nudge-copy">
              <b>{activeNudge.tag}</b>
              <small>{activeNudge.text}</small>
            </span>
          </button>
          <button
            type="button"
            className="stapler-nudge-dismiss"
            onClick={muteNudges}
            aria-label="Dismiss Stapler tips for this session"
            title="Dismiss tips for this session"
          >
            ×
          </button>
        </div>
      )}

      <button
        type="button"
        className={`stapler-fab${open ? " is-open" : ""}${recording ? " is-recording" : ""}${activeNudge ? " is-nudging" : ""}${fabDragOver ? " is-dragover" : ""}`}
        aria-label={open ? "Close Stapler" : "Open Stapler quick capture"}
        aria-expanded={open}
        onClick={() => {
          setNudgeIdx(null);
          if (open) close();
          else setOpen(true);
        }}
        onDragOver={handleFabDragOver}
        onDragLeave={() => setFabDragOver(false)}
        onDrop={handleFabDrop}
      >
        <StaplerFace mood={mood} size="md" />
        <span className="stapler-fab-text">
          {recording ? (
            <>
              <b className="stapler-fab-rec"><i /> REC {formatClock(seconds)}</b>
              <small>Click to review</small>
            </>
          ) : fabDragOver ? (
            <>
              <b>Drop file</b>
              <small>Attach to Stapler</small>
            </>
          ) : (
            <>
              <b>Stapler</b>
              <small>Capture · ⌥⇧S</small>
            </>
          )}
        </span>
      </button>

      {open && (
        <section
          className={`stapler-panel${dragOver ? " is-dragover" : ""}`}
          role="dialog"
          aria-label="Stapler quick capture"
          onPaste={handlePaste}
          onDragEnter={handlePanelDragEnter}
          onDragOver={handlePanelDragOver}
          onDragLeave={handlePanelDragLeave}
          onDrop={handlePanelDrop}
        >
          <header className="stapler-head">
            <StaplerFace mood={mood} size="lg" />
            <div className="stapler-head-txt">
              <b>Stapler</b>
              <small>Capture, review, send straight to your team</small>
            </div>
            <button type="button" className="stapler-close" onClick={close} aria-label="Close Stapler">×</button>
          </header>

          <div className="stapler-actions" role="group" aria-label="Capture mode">
            <button
              type="button"
              aria-pressed={mode === "screenshot"}
              onClick={screenshot}
              disabled={recording}
            >
              <ModeIcon mode="screenshot" />
              <span>Screenshot</span>
            </button>
            <button
              type="button"
              aria-pressed={mode === "meeting"}
              onClick={() => startAudio("meeting")}
              disabled={recording}
            >
              <ModeIcon mode="meeting" />
              <span>Meeting</span>
            </button>
            <button
              type="button"
              aria-pressed={mode === "voice"}
              onClick={() => startAudio("voice")}
              disabled={recording}
            >
              <ModeIcon mode="voice" />
              <span>Voice note</span>
            </button>
            <button
              type="button"
              aria-pressed={mode === "note"}
              onClick={() => { choose("note"); requestAnimationFrame(() => textareaRef.current?.focus()); }}
              disabled={recording}
            >
              <ModeIcon mode="note" />
              <span>Quick note</span>
            </button>
          </div>

          <p className="stapler-mode-tip">{MODE_HELPER[mode]}</p>

          {recording && (
            <div className="stapler-record" role="status" aria-live="polite">
              <span className="stapler-rec-dot" aria-hidden="true" />
              <span className="stapler-wave" aria-hidden="true">
                <i /><i /><i /><i /><i />
              </span>
              <span className="stapler-rec-time">Recording {formatClock(seconds)}</span>
              <button type="button" onClick={stopAudio}>Stop &amp; review</button>
            </div>
          )}

          {file && preview ? (
            <div className="stapler-preview">
              <div className="stapler-preview-bar">
                <span className="stapler-file-badge">
                  {file.type.startsWith("image/") ? "IMG" : file.type.startsWith("audio/") ? "AUDIO" : "FILE"}
                </span>
                <b title={file.name}>{file.name}</b>
                <span className="stapler-file-size">{formatBytes(file.size)}</span>
                <button type="button" onClick={() => setFile(null)} aria-label="Remove attachment">Remove</button>
              </div>
              {file.type.startsWith("image/") ? (
                <img src={preview} alt="Attached capture preview" />
              ) : file.type.startsWith("audio/") ? (
                <audio controls src={preview} />
              ) : null}
            </div>
          ) : !recording && (
            <button
              type="button"
              className={`stapler-dropzone${dragOver ? " is-active" : ""}`}
              onClick={() => input.current?.click()}
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M10 13.5V4.5m0 0-3.2 3.2M10 4.5l3.2 3.2M4 13.5v1.3A1.7 1.7 0 0 0 5.7 16.5h8.6a1.7 1.7 0 0 0 1.7-1.7v-1.3" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{dragOver ? "Release to attach file" : "Drop file, paste ⌘V, or browse"}</span>
              <small>Up to 25 MB</small>
            </button>
          )}

          <input
            ref={input}
            type="file"
            hidden
            accept="image/*,audio/*,video/*,.pdf,.txt,.md,.csv,.docx"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) attachFile(f);
              e.target.value = "";
            }}
          />

          <div className="stapler-recipient">
            <div className="stapler-field-head">
              <label htmlFor="stapler-agent-select">Send to</label>
              {selectedAgent?.role && <small className="stapler-role-pill">{selectedAgent.role}</small>}
            </div>

            <div className="stapler-select-wrap">
              {selectedAgent && (
                <span className="stapler-select-av" aria-hidden="true">
                  <CharacterFace face={selectedAgent.face} size={28} shape="circle" />
                </span>
              )}
              <select
                id="stapler-agent-select"
                value={agentId}
                onChange={e => { setAgentId(e.target.value); setSent(null); }}
              >
                <option value="">Choose agent…</option>
                {agents.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>

            {quickAgents.length > 1 && (
              <div className="stapler-quick-agents" role="group" aria-label="Quick switch recipient">
                {quickAgents.map(a => (
                  <button
                    key={a.id}
                    type="button"
                    className={`stapler-agent-chip${a.id === agentId ? " is-selected" : ""}`}
                    aria-pressed={a.id === agentId}
                    onClick={() => { setAgentId(a.id); setSent(null); }}
                    title={a.role ? `${a.name} — ${a.role}` : a.name}
                  >
                    <CharacterFace face={a.face} size={18} shape="circle" />
                    <span>{a.name.split(" ")[0]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="stapler-compose">
            <div className="stapler-chips" role="group" aria-label="Quick prompt starters">
              {STARTER_CHIPS[mode].map(chip => (
                <button
                  key={chip.label}
                  type="button"
                  className="stapler-chip"
                  onClick={() => {
                    setNote(chip.text);
                    setSent(null);
                    requestAnimationFrame(() => textareaRef.current?.focus());
                  }}
                >
                  {chip.label}
                </button>
              ))}
            </div>
            <textarea
              ref={textareaRef}
              value={note}
              onChange={e => setNote(e.target.value)}
              onKeyDown={handleTextareaKeyDown}
              aria-label={`Instructions for ${mode}`}
              placeholder="Add context or instructions… (⌘↵ to send)"
              rows={3}
            />
            <label className="stapler-check">
              <input type="checkbox" checked={startNewTopic} onChange={e => setStartNewTopic(e.target.checked)} />
              Start a new topic (otherwise continues active chat)
            </label>
          </div>

          {error && <p className="stapler-error" role="alert">{error}</p>}

          {sent && (
            <div className="stapler-sent" role="status">
              <span>Sent to <b>{sent.name}</b></span>
              <button type="button" onClick={() => openAgentChat(sent.agentId, sent.sessionId)}>Open chat →</button>
            </div>
          )}

          <footer className="stapler-foot">
            <button
              type="button"
              className="stapler-hide-btn"
              disabled={recording}
              onClick={() => { setOpen(false); setHidden(true); }}
              title="Restore anytime with ⌥⇧S"
            >
              Hide · ⌥⇧S
            </button>
            <button
              type="button"
              className="send"
              disabled={!canSend}
              onClick={send}
            >
              {busy ? "Sending…" : <>Send <kbd aria-hidden="true">⌘↵</kbd> →</>}
            </button>
          </footer>

          <small className="stapler-hint">You always review captures before anything is sent.</small>
        </section>
      )}
    </div>
  );
}
