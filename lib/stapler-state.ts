export type StaplerMode = "screenshot" | "meeting" | "voice" | "note";
export type RecordingState = "idle" | "recording" | "paused";
export type PanelPhase = "closed" | "opening" | "open" | "minimizing";
export type StaplerMood = "idle" | "nudge" | "open" | "recording" | "paused" | "happy" | "draft";

export function formatStaplerClock(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/**
 * Closing, minimizing, pressing Escape, or toggling ⌥⇧S must NEVER discard
 * an active or paused meeting/voice recording — instead it minimizes Stapler
 * into the dock while keeping MediaRecorder alive in the background.
 */
export function resolveStaplerCloseAction(recordingState: RecordingState): {
  keepRecording: boolean;
  nextOpen: false;
  showBackgroundHint: boolean;
} {
  const active = recordingState !== "idle";
  return {
    keepRecording: active,
    nextOpen: false,
    showBackgroundHint: active,
  };
}

export function resolveStaplerMood(opts: {
  recordingState: RecordingState;
  celebrating: boolean;
  hasNudge: boolean;
  open: boolean;
  hasDraft: boolean;
}): StaplerMood {
  if (opts.recordingState === "recording") return "recording";
  if (opts.recordingState === "paused") return "paused";
  if (opts.celebrating) return "happy";
  if (opts.hasNudge) return "nudge";
  if (opts.open) return "open";
  if (opts.hasDraft) return "draft";
  return "idle";
}

export function formatStaplerDockCopy(opts: {
  recordingState: RecordingState;
  mode: StaplerMode;
  seconds: number;
  fabDragOver: boolean;
  hasDraft: boolean;
  open: boolean;
}): {
  kind: "recording" | "paused" | "dragover" | "draft" | "default";
  title: string;
  subtitle: string;
  modeLabel?: string;
} {
  if (opts.recordingState === "recording") {
    const modeLabel = opts.mode === "meeting" ? "Meeting" : "Voice";
    return {
      kind: "recording",
      title: `REC ${formatStaplerClock(opts.seconds)}`,
      subtitle: opts.open ? `${modeLabel} aktif · minimize` : `${modeLabel} · klik buka`,
      modeLabel,
    };
  }
  if (opts.recordingState === "paused") {
    const modeLabel = opts.mode === "meeting" ? "Meeting" : "Voice";
    return {
      kind: "paused",
      title: `JEDA ${formatStaplerClock(opts.seconds)}`,
      subtitle: `${modeLabel} dijeda · klik buka`,
      modeLabel,
    };
  }
  if (opts.fabDragOver) {
    return {
      kind: "dragover",
      title: "Drop file",
      subtitle: "Lampirkan ke Stapler",
    };
  }
  if (opts.hasDraft && !opts.open) {
    return {
      kind: "draft",
      title: "Draft siap",
      subtitle: "Klik untuk kirim",
    };
  }
  return {
    kind: "default",
    title: "Stapler",
    subtitle: "Capture · ⌥⇧S",
  };
}

/**
 * Compute normalized 0..1 microphone loudness from AnalyserNode time-domain bytes (0..255 centered at 128).
 */
export function computeMicLevel(samples: Uint8Array): number {
  if (!samples.length) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const centered = (samples[i] - 128) / 128;
    sumSq += centered * centered;
  }
  const rms = Math.sqrt(sumSq / samples.length);
  // Amplify natural speech range (~0.02..0.28 RMS) smoothly into 0..1
  return Math.max(0, Math.min(1, Number((rms * 4.2).toFixed(3))));
}
