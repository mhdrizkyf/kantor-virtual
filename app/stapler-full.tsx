"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { uploadAll } from "./file-picker";
import { MANAGER } from "@/lib/manager";
import CharacterFace from "./character-face";
import { readActiveChatId, writeActiveChatId } from "@/lib/chat-continuity";
import {
  computeMicLevel,
  formatStaplerClock,
  formatStaplerDockCopy,
  resolveStaplerCloseAction,
  resolveStaplerMood,
  type PanelPhase,
  type RecordingState,
  type StaplerMode,
  type StaplerMood,
} from "@/lib/stapler-state";

export type { StaplerMode };

type Agent = { id: string; name: string; face?: string | null; role?: string | null };
type MascotFx = "none" | "gulp" | "pop";

const MAX_BYTES = 25 * 1024 * 1024;
const NUDGE_MUTE_KEY = "kantor:stapler-nudges-muted";
const FIRST_NUDGE_MS = 7_500;
const REPEAT_NUDGE_MS = 48_000;
const NUDGE_VISIBLE_MS = 6_500;

const HINT: Record<StaplerMode, string> = {
  screenshot: "Please review this screenshot and help me with:",
  meeting: "Please transcribe this meeting recording, summarize decisions, and list next actions.",
  voice: "Please transcribe this voice note and help me act on it.",
  note: "",
};

const MODE_HELPER: Record<StaplerMode, string> = {
  screenshot: "Capture your screen, paste with ⌘V, or drop an image below.",
  meeting: "Rekam audio meeting live — aman di-minimize sambil tetap merekam di background.",
  voice: "Rekam voice note cepat — bisa di-minimize sambil lanjut kerja di kantor.",
  note: "Jot a quick brief, drop any doc, and press ⌘↵ to dispatch.",
};

const STARTER_CHIPS: Record<StaplerMode, { label: string; text: string }[]> = {
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

const NUDGES: { mode: StaplerMode; tag: string; text: string }[] = [
  { mode: "screenshot", tag: "Quick snap", text: "Spot something? Capture a screen for the team" },
  { mode: "voice", tag: "Voice → task", text: "Record a quick voice brief in one click" },
  { mode: "meeting", tag: "Meeting AI", text: "Record a meeting for instant action items" },
  { mode: "note", tag: "Shortcut ⌥⇧S", text: "Drop a file or paste ⌘V straight to any agent" },
];

let cachedSupportsDisplayTransition: boolean | undefined;
function canTransitionDisplay(): boolean {
  if (cachedSupportsDisplayTransition !== undefined) return cachedSupportsDisplayTransition;
  if (typeof window === "undefined" || !window.CSS?.supports?.("transition-behavior", "allow-discrete") || !document.body) {
    return false;
  }
  const probe = document.createElement("div");
  probe.style.cssText = "transition: display 1s allow-discrete !important; display: block;";
  document.body.appendChild(probe);
  void getComputedStyle(probe).display;
  probe.style.display = "none";
  cachedSupportsDisplayTransition = getComputedStyle(probe).display === "block";
  probe.remove();
  return cachedSupportsDisplayTransition;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ModeIcon({ mode }: { mode: StaplerMode }) {
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

function StaplerFace({
  mood = "idle",
  size = "md",
  fx = "none",
}: {
  mood?: StaplerMood;
  size?: "md" | "lg";
  fx?: MascotFx;
}) {
  const showHeadset = mood === "recording" || mood === "paused";
  return (
    <span className={`stapler-face is-${mood} sz-${size}${fx !== "none" ? ` fx-${fx}` : ""}`} aria-hidden="true">
      {mood === "recording" && <span className="stapler-rec-ripple" />}
      {showHeadset && (
        <span className="stapler-headset">
          <i className="stapler-headset-band" />
          <i className="stapler-headset-ear l" />
          <i className="stapler-headset-ear r" />
        </span>
      )}
      <span className="stapler-eyes">
        <i />
        <i />
      </span>
      <span className="stapler-cheeks">
        <i />
        <i />
      </span>
      {mood === "recording" ? (
        <span className="stapler-voice-mouth" />
      ) : (
        <span className="stapler-smile" />
      )}
      {mood === "draft" && <span className="stapler-draft-dot" />}
    </span>
  );
}

export default function StaplerFull({
  ws,
  initialOpen = false,
  initialMode = "note",
  initialFile = null,
}: {
  ws: string;
  initialOpen?: boolean;
  initialMode?: StaplerMode;
  initialFile?: File | null;
}) {
  const [panelPhase, setPanelPhase] = useState<PanelPhase>(initialOpen ? "opening" : "closed");
  const [hidden, setHidden] = useState(false);
  const [mode, setMode] = useState<StaplerMode>(initialMode);
  const [recordingMode, setRecordingMode] = useState<"meeting" | "voice">("voice");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState("");
  const [note, setNote] = useState(initialFile ? HINT[initialMode] : "");
  const [file, setFile] = useState<File | null>(initialFile);
  const [preview, setPreview] = useState<string | null>(null);
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ agentId: string; name: string; sessionId: string } | null>(null);
  const [startNewTopic, setStartNewTopic] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fabDragOver, setFabDragOver] = useState(false);
  const [mascotFx, setMascotFx] = useState<MascotFx>(initialOpen ? "pop" : "none");
  const [bgHint, setBgHint] = useState<string | null>(null);

  // Periodic contextual nudge state (respectful, dismissible, paused on hover/focus)
  const [nudgesMuted, setNudgesMuted] = useState(false);
  const [nudgeIdx, setNudgeIdx] = useState<number | null>(null);

  const nudgeCursor = useRef(0);
  const nudgePaused = useRef(false);
  const nudgeHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mascotFxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bgHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelAnimToken = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const stopBehaviorRef = useRef<{ openAfterStop: boolean; discard: boolean }>({
    openAfterStop: false,
    discard: false,
  });
  const audioCtxRef = useRef<AudioContext | null>(null);
  const meterRafRef = useRef<number | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragDepth = useRef(0);

  const open = panelPhase === "open" || panelPhase === "opening";
  const isRecordingActive = recordingState !== "idle";
  const isRecording = recordingState === "recording";
  const isPaused = recordingState === "paused";
  const recordingStateRef = useRef<RecordingState>("idle");
  recordingStateRef.current = recordingState;

  const triggerMascotFx = useCallback((fx: MascotFx, durationMs: number) => {
    if (mascotFxTimer.current) clearTimeout(mascotFxTimer.current);
    setMascotFx(fx);
    mascotFxTimer.current = setTimeout(() => setMascotFx("none"), durationMs);
  }, []);

  // Clear initial launch pop animation cleanly
  useEffect(() => {
    if (!initialOpen) return;
    mascotFxTimer.current = setTimeout(() => setMascotFx("none"), 280);
  }, [initialOpen]);

  const flashBgHint = useCallback((message: string) => {
    if (bgHintTimer.current) clearTimeout(bgHintTimer.current);
    setBgHint(message);
    bgHintTimer.current = setTimeout(() => setBgHint(null), 2800);
  }, []);

  const stopMicMeter = useCallback(() => {
    if (meterRafRef.current !== null) {
      cancelAnimationFrame(meterRafRef.current);
      meterRafRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    root.current?.style.setProperty("--stapler-level", "0");
  }, []);

  const startMicMeter = useCallback((mic: MediaStream) => {
    stopMicMeter();
    const AudioCtx = typeof window !== "undefined"
      ? (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined;
    if (!AudioCtx) return;
    try {
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(mic);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      audioCtxRef.current = ctx;

      const samples = new Uint8Array(analyser.fftSize);
      let smoothed = 0;
      let lastTick = 0;
      const loop = (now: number) => {
        if (!audioCtxRef.current) return;
        if (now - lastTick >= 55) {
          lastTick = now;
          if (recordingStateRef.current === "recording") {
            analyser.getByteTimeDomainData(samples);
            const next = computeMicLevel(samples);
            smoothed = smoothed * 0.45 + next * 0.55;
          } else {
            smoothed = smoothed * 0.6;
          }
          root.current?.style.setProperty("--stapler-level", smoothed.toFixed(3));
        }
        meterRafRef.current = requestAnimationFrame(loop);
      };
      meterRafRef.current = requestAnimationFrame(loop);
    } catch {
      /* Fallback smoothly to pure CSS rhythm if Web Audio is unavailable */
    }
  }, [stopMicMeter]);

  const openPanel = useCallback(() => {
    panelAnimToken.current += 1;
    setHidden(false);
    setNudgeIdx(null);
    setBgHint(null);
    triggerMascotFx("pop", 280);
    setPanelPhase("opening");
  }, [triggerMascotFx]);

  const minimizePanel = useCallback((opts?: { showBgNotice?: boolean }) => {
    const token = ++panelAnimToken.current;
    setPanelPhase(prev => {
      if (prev === "closed" || prev === "minimizing") return prev;
      return "minimizing";
    });
    const decision = resolveStaplerCloseAction(recordingStateRef.current);
    if (opts?.showBgNotice ?? decision.showBackgroundHint) {
      const label = recordingMode === "meeting" ? "Rekaman meeting" : "Voice note";
      flashBgHint(`${label} lanjut di background`);
    }
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!reduced) {
      setTimeout(() => {
        if (panelAnimToken.current === token) triggerMascotFx("gulp", 300);
      }, 150);
    }
  }, [flashBgHint, recordingMode, triggerMascotFx]);

  // Settle opening / minimizing genie animations reliably via Web Animations API + reduced-motion fallback
  useEffect(() => {
    const el = panelRef.current;
    if (!el || (panelPhase !== "opening" && panelPhase !== "minimizing")) return;
    const token = panelAnimToken.current;
    let cancelled = false;

    const finish = () => {
      if (cancelled || panelAnimToken.current !== token) return;
      setPanelPhase(curr => {
        if (curr === "opening") return "open";
        if (curr === "minimizing") return "closed";
        return curr;
      });
    };

    const raf = requestAnimationFrame(() => {
      if (cancelled || panelAnimToken.current !== token) return;
      const animations = typeof el.getAnimations === "function" ? el.getAnimations() : [];
      if (animations.length === 0) {
        finish();
        return;
      }
      const failsafeMs = canTransitionDisplay() ? 560 : 520;
      void Promise.race([
        Promise.allSettled(animations.map(a => a.finished)),
        new Promise(r => setTimeout(r, failsafeMs)),
      ]).then(finish);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [panelPhase]);

  // Restore session nudge mute preference on client only
  useEffect(() => {
    try {
      if (sessionStorage.getItem(NUDGE_MUTE_KEY) === "1") setNudgesMuted(true);
    } catch { /* ignore storage errors */ }
  }, []);

  // Warn before accidentally closing browser tab while a recording is still active
  useEffect(() => {
    if (!isRecordingActive) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isRecordingActive]);

  // Global keyboard shortcuts: Option+Shift+S toggles Stapler; Escape minimizes (NEVER kills active recording)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (open) minimizePanel();
        else openPanel();
      } else if (e.key === "Escape" && open) {
        minimizePanel();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open, openPanel, minimizePanel]);

  // Recording clock (only advances while actively recording, pauses when paused)
  useEffect(() => {
    if (!isRecording) return;
    const t = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [isRecording]);

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

  // Cleanup recorder, mic meter & timers on unmount
  useEffect(() => () => {
    stopBehaviorRef.current = { openAfterStop: false, discard: true };
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    stream.current?.getTracks().forEach(t => t.stop());
    stopMicMeter();
    if (nudgeHideTimer.current) clearTimeout(nudgeHideTimer.current);
    if (mascotFxTimer.current) clearTimeout(mascotFxTimer.current);
    if (bgHintTimer.current) clearTimeout(bgHintTimer.current);
  }, [stopMicMeter]);

  // Periodic contextual nudge bubble scheduler
  const scheduleNudgeHide = useCallback(() => {
    if (nudgeHideTimer.current) clearTimeout(nudgeHideTimer.current);
    nudgeHideTimer.current = setTimeout(() => {
      if (!nudgePaused.current) setNudgeIdx(null);
    }, NUDGE_VISIBLE_MS);
  }, []);

  useEffect(() => {
    if (open || hidden || nudgesMuted || isRecordingActive || file) {
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
  }, [open, hidden, nudgesMuted, isRecordingActive, file, scheduleNudgeHide]);

  const muteNudges = () => {
    setNudgeIdx(null);
    setNudgesMuted(true);
    try { sessionStorage.setItem(NUDGE_MUTE_KEY, "1"); } catch { /* ignore */ }
  };

  const selectedAgent = useMemo(
    () => agents.find(a => a.id === agentId) ?? null,
    [agents, agentId],
  );

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

  const attachFile = useCallback((f: File, forcedMode?: StaplerMode) => {
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

  const choose = (next: StaplerMode, keepFile = false) => {
    if (isRecordingActive) return;
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

  const closeOrMinimize = () => {
    const decision = resolveStaplerCloseAction(recordingState);
    minimizePanel({ showBgNotice: decision.showBackgroundHint });
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
    setRecordingMode(next);
    setSeconds(0);
    setError(null);
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
      stopBehaviorRef.current = { openAfterStop: false, discard: false };

      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        const { openAfterStop, discard } = stopBehaviorRef.current;
        stopBehaviorRef.current = { openAfterStop: false, discard: false };
        const type = rec.mimeType || mime || "audio/webm";
        const ext = type.includes("mp4") ? "m4a" : "webm";
        if (!discard) {
          if (chunks.length) {
            setFile(new File(chunks, `${next}-${Date.now()}.${ext}`, { type }));
            setError(null);
          } else {
            setError("Recording is empty. Please try again.");
          }
        }
        mic.getTracks().forEach(t => t.stop());
        stream.current = null;
        recorder.current = null;
        stopMicMeter();
        setRecordingState("idle");
        if (openAfterStop && !discard) openPanel();
      };
      rec.onerror = () => {
        setError("Recording failed. Please try again.");
        setRecordingState("idle");
        mic.getTracks().forEach(t => t.stop());
        stream.current = null;
        recorder.current = null;
        stopMicMeter();
      };
      rec.start(1000);
      setRecordingState("recording");
      startMicMeter(mic);
    } catch (e) {
      if (e instanceof Error && e.name === "NotAllowedError") {
        setError("Microphone access was denied. Allow mic access or attach an audio file.");
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }

  function togglePauseAudio() {
    const rec = recorder.current;
    if (!rec) return;
    try {
      if (rec.state === "recording" && typeof rec.pause === "function") {
        rec.pause();
        setRecordingState("paused");
      } else if (rec.state === "paused" && typeof rec.resume === "function") {
        rec.resume();
        setRecordingState("recording");
      }
    } catch {
      /* Ignore browsers where pause/resume is unsupported */
    }
  }

  function stopAudio(opts?: { openAfterStop?: boolean; discard?: boolean }) {
    const rec = recorder.current;
    if (!rec || rec.state === "inactive") return;
    stopBehaviorRef.current = {
      openAfterStop: Boolean(opts?.openAfterStop),
      discard: Boolean(opts?.discard),
    };
    rec.stop();
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
    if (dropped && !isRecordingActive) attachFile(dropped);
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
    if (dropped && !isRecordingActive) {
      openPanel();
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
    if (busy || isRecordingActive || !agentId || (!note.trim() && !file)) return;
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

      window.dispatchEvent(new CustomEvent("kantor:letter", { detail: { agentId } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const openAgentChat = (targetAgentId: string, sessionId?: string | null) => {
    window.dispatchEvent(new CustomEvent("kantor:chat", { detail: { agentId: targetAgentId, sessionId: sessionId ?? null } }));
    minimizePanel();
  };

  const openFromNudge = (suggested: StaplerMode) => {
    openPanel();
    choose(suggested, true);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  if (hidden) return null;

  const activeNudge = nudgeIdx !== null && !open && !isRecordingActive && !file ? NUDGES[nudgeIdx] : null;
  const mood = resolveStaplerMood({
    recordingState,
    celebrating,
    hasNudge: Boolean(activeNudge),
    open,
    hasDraft: Boolean(file),
  });
  const dockCopy = formatStaplerDockCopy({
    recordingState,
    mode: recordingMode,
    seconds,
    fabDragOver,
    hasDraft: Boolean(file),
    open,
  });
  const canSend = !busy && !isRecordingActive && !!agentId && (!!note.trim() || !!file);
  const showMiniRecDock = panelPhase === "closed" && isRecordingActive;

  return (
    <div className="stapler-root" ref={root}>
      {bgHint && panelPhase === "closed" && (
        <div className="stapler-bg-toast" role="status" aria-live="polite">
          <span className="stapler-bg-toast-dot" aria-hidden="true" />
          <span>{bgHint}</span>
        </div>
      )}

      {showMiniRecDock && (
        <div
          className={`stapler-rec-dock${isPaused ? " is-paused" : ""}`}
          role="region"
          aria-label="Kontrol rekaman Stapler aktif"
        >
          <button
            type="button"
            className="stapler-rec-dock-btn"
            onClick={togglePauseAudio}
            aria-label={isPaused ? "Lanjutkan rekaman" : "Jeda rekaman"}
            title={isPaused ? "Lanjutkan rekaman" : "Jeda rekaman"}
          >
            {isPaused ? (
              <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                <path d="M3 2.2v7.6L9.8 6 3 2.2Z" />
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                <rect x="2.4" y="2.2" width="2.6" height="7.6" rx="0.8" />
                <rect x="7" y="2.2" width="2.6" height="7.6" rx="0.8" />
              </svg>
            )}
            <span>{isPaused ? "Lanjut" : "Jeda"}</span>
          </button>
          <button
            type="button"
            className="stapler-rec-dock-stop"
            onClick={() => stopAudio({ openAfterStop: true })}
            aria-label="Hentikan dan simpan rekaman"
            title="Stop, simpan & review rekaman"
          >
            <i aria-hidden="true" />
            <span>Stop</span>
          </button>
        </div>
      )}

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
        className={[
          "stapler-fab",
          open ? "is-open" : "",
          isRecording ? "is-recording" : "",
          isPaused ? "is-paused" : "",
          activeNudge ? "is-nudging" : "",
          fabDragOver ? "is-dragover" : "",
          file && !open && !isRecordingActive ? "has-draft" : "",
          mascotFx !== "none" ? `fx-${mascotFx}` : "",
        ].filter(Boolean).join(" ")}
        aria-label={
          open
            ? isRecordingActive
              ? "Minimize Stapler (rekaman tetap jalan)"
              : "Minimize Stapler"
            : isRecordingActive
              ? "Buka Stapler (sedang merekam)"
              : "Open Stapler quick capture"
        }
        aria-expanded={open}
        onClick={() => {
          setNudgeIdx(null);
          if (open) closeOrMinimize();
          else openPanel();
        }}
        onDragOver={handleFabDragOver}
        onDragLeave={() => setFabDragOver(false)}
        onDrop={handleFabDrop}
      >
        <StaplerFace mood={mood} size="md" fx={mascotFx} />
        <span className="stapler-fab-text">
          {dockCopy.kind === "recording" || dockCopy.kind === "paused" ? (
            <>
              <b className={dockCopy.kind === "paused" ? "stapler-fab-rec is-paused" : "stapler-fab-rec"}>
                <i />
                <span>{dockCopy.title}</span>
                {dockCopy.kind === "recording" && (
                  <span className="stapler-fab-eq" aria-hidden="true">
                    <em /><em /><em />
                  </span>
                )}
              </b>
              <small>{dockCopy.subtitle}</small>
            </>
          ) : (
            <>
              <b>{dockCopy.title}</b>
              <small>{dockCopy.subtitle}</small>
            </>
          )}
        </span>
      </button>

      <section
        ref={panelRef}
        hidden={panelPhase === "closed"}
        data-phase={panelPhase}
        data-closing={panelPhase === "minimizing" ? "" : undefined}
        className={`stapler-panel${dragOver ? " is-dragover" : ""}${isRecordingActive ? " is-live-rec" : ""}`}
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
            <small>
              {isRecording
                ? `${recordingMode === "meeting" ? "Meeting" : "Voice note"} sedang merekam — aman di-minimize`
                : isPaused
                  ? "Rekaman dijeda — lanjutkan atau klik Stop & simpan"
                  : "Capture, review, send straight to your team"}
            </small>
          </div>
          <div className="stapler-head-actions">
            <button
              type="button"
              className="stapler-min"
              onClick={() => minimizePanel({ showBgNotice: isRecordingActive })}
              aria-label={isRecordingActive ? "Minimize Stapler (rekaman tetap berjalan)" : "Minimize Stapler"}
              title={isRecordingActive ? "Minimize (rekaman tetap jalan di background)" : "Minimize panel"}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M3 8.5h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            <button
              type="button"
              className="stapler-close"
              onClick={closeOrMinimize}
              aria-label={isRecordingActive ? "Minimize Stapler agar rekaman tetap berjalan" : "Close Stapler"}
              title={isRecordingActive ? "Minimize agar rekaman tidak terputus" : "Close Stapler"}
            >
              ×
            </button>
          </div>
        </header>

        <div className="stapler-actions" role="group" aria-label="Capture mode">
          <button
            type="button"
            aria-pressed={mode === "screenshot"}
            onClick={screenshot}
            disabled={isRecordingActive}
          >
            <ModeIcon mode="screenshot" />
            <span>Screenshot</span>
          </button>
          <button
            type="button"
            aria-pressed={mode === "meeting"}
            onClick={() => startAudio("meeting")}
            disabled={isRecordingActive}
          >
            <ModeIcon mode="meeting" />
            <span>Meeting</span>
          </button>
          <button
            type="button"
            aria-pressed={mode === "voice"}
            onClick={() => startAudio("voice")}
            disabled={isRecordingActive}
          >
            <ModeIcon mode="voice" />
            <span>Voice note</span>
          </button>
          <button
            type="button"
            aria-pressed={mode === "note"}
            onClick={() => { choose("note"); requestAnimationFrame(() => textareaRef.current?.focus()); }}
            disabled={isRecordingActive}
          >
            <ModeIcon mode="note" />
            <span>Quick note</span>
          </button>
        </div>

        <p className="stapler-mode-tip">{MODE_HELPER[mode]}</p>

        {isRecordingActive && (
          <div className={`stapler-record${isPaused ? " is-paused" : ""}`} role="status" aria-live="polite">
            <span className="stapler-rec-dot" aria-hidden="true" />
            <span className={`stapler-wave is-reactive${isPaused ? " is-paused" : ""}`} aria-hidden="true">
              <i /><i /><i /><i /><i />
            </span>
            <span className="stapler-rec-time">
              {isPaused ? "Dijeda" : recordingMode === "meeting" ? "Meeting" : "Voice"} {formatStaplerClock(seconds)}
            </span>
            <div className="stapler-record-controls">
              <button
                type="button"
                className="stapler-rec-sec-btn"
                onClick={togglePauseAudio}
                aria-label={isPaused ? "Lanjutkan rekaman" : "Jeda rekaman"}
              >
                {isPaused ? "Lanjut" : "Jeda"}
              </button>
              <button
                type="button"
                className="stapler-rec-stop-btn"
                onClick={() => stopAudio({ openAfterStop: false })}
              >
                Stop &amp; simpan
              </button>
              <button
                type="button"
                className="stapler-rec-discard-btn"
                onClick={() => stopAudio({ discard: true })}
                aria-label="Batalkan rekaman"
                title="Batalkan rekaman ini"
              >
                ×
              </button>
            </div>
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
        ) : !isRecordingActive && (
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
          {isRecordingActive ? (
            <button
              type="button"
              className="stapler-hide-btn"
              onClick={() => minimizePanel({ showBgNotice: true })}
              title="Minimize sambil tetap merekam di background"
            >
              Minimize · ⌥⇧S
            </button>
          ) : (
            <button
              type="button"
              className="stapler-hide-btn"
              onClick={() => { setPanelPhase("closed"); setHidden(true); }}
              title="Restore anytime with ⌥⇧S"
            >
              Hide · ⌥⇧S
            </button>
          )}
          <button
            type="button"
            className="send"
            disabled={!canSend}
            onClick={send}
          >
            {busy ? "Sending…" : <>Send <kbd aria-hidden="true">⌘↵</kbd> →</>}
          </button>
        </footer>

        <small className="stapler-hint">
          {isRecordingActive
            ? "Minimize aman — rekaman tetap berjalan dan tersimpan saat Anda klik Stop."
            : "You always review captures before anything is sent."}
        </small>
      </section>
    </div>
  );
}
