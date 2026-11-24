"use client";
import { useEffect, useRef, useState } from "react";
import type { WorkCalendar } from "@/lib/office-time";

export type SoundMode = "off" | "lofi" | "working" | "mix";

const MODE_KEY = "kantor-sound-mode";
const VOL_KEY = "kantor-sound-volume";

function parseSoundMode(raw: string | null): SoundMode {
  if (raw === "lofi" || raw === "working" || raw === "mix") return raw;
  return "off";
}

function parseVolume(raw: string | null): number {
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0 && n <= 100) return Math.round(n);
  return 45;
}

// Cozy Stardew / Study Lo-Fi chord progression at 72 BPM (Cmaj9 -> Am9 -> Fmaj9 -> G13)
const LOFI_CHORDS: number[][] = [
  [261.63, 329.63, 392.0, 493.88, 587.33],
  [220.0, 261.63, 329.63, 392.0, 493.88],
  [174.61, 220.0, 261.63, 329.63, 392.0],
  [196.0, 246.94, 293.66, 329.63, 440.0],
];

/**
 * Interactive Web Audio Studio Sound Mixer:
 * - Off
 * - Lo-Fi Beat (warm 72 BPM low-beat kick, dusty brush snare, Rhodes chords & vinyl warmth)
 * - Working (natural human bursts of soft keyboard typing & subtle mouse clicks)
 * - Mix (Lo-Fi Beat + gentle typing ambience)
 * Plus smooth real-time Volume slider (0-100%).
 */
export default function OfficeAmbience({
  open: _officeOpen,
  timeZone: _timeZone,
  calendar: _calendar,
  activeWork: _activeWork,
}: {
  open: boolean;
  timeZone: string;
  calendar?: WorkCalendar;
  activeWork: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<SoundMode>("off");
  const [volume, setVolume] = useState(45);
  const wrapRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);

  // Restore saved volume (always start muted on page load so browsers never block autoplay)
  useEffect(() => {
    try {
      setVolume(parseVolume(localStorage.getItem(VOL_KEY)));
    } catch {
      // ignore storage unavailable
    }
  }, []);

  // Close popover on outside click or Escape
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // Smooth live volume updates without restarting the synth engine
  useEffect(() => {
    try {
      localStorage.setItem(VOL_KEY, String(volume));
    } catch {
      // ignore
    }
    const ctx = ctxRef.current;
    const master = masterRef.current;
    if (ctx && master) {
      master.gain.setTargetAtTime((volume / 100) * 0.65, ctx.currentTime, 0.04);
    }
  }, [volume]);

  // Synthesize Lo-Fi Low-Beat and/or Working Sound cleanly via Web Audio API
  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // ignore
    }
    if (mode === "off") return;

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const master = ctx.createGain();
    master.gain.value = (volume / 100) * 0.65;
    master.connect(ctx.destination);
    ctxRef.current = ctx;
    masterRef.current = master;
    void ctx.resume().catch(() => setMode("off"));

    const timers: ReturnType<typeof setInterval>[] = [];
    const playLofi = mode === "lofi" || mode === "mix";
    const playWorking = mode === "working" || mode === "mix";

    // Reusable short noise buffer for dusty snare / vinyl / key clicks
    const noiseLen = Math.floor(ctx.sampleRate * 0.14);
    const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) nd[i] = Math.random() * 2 - 1;

    // 1. Cozy Lo-Fi Low-Beat Engine (72 BPM -> eighth-note step = ~416ms)
    if (playLofi) {
      const lofiBus = ctx.createBiquadFilter();
      lofiBus.type = "lowpass";
      lofiBus.frequency.value = 1150;
      lofiBus.Q.value = 0.7;
      const lofiGain = ctx.createGain();
      lofiGain.gain.value = mode === "mix" ? 0.72 : 1.0;
      lofiBus.connect(lofiGain);
      lofiGain.connect(master);

      let step = 0;
      const playKick = (t: number, accent = 1) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(118, t);
        osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        g.gain.setValueAtTime(0.32 * accent, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
        osc.connect(g);
        g.connect(lofiBus);
        osc.start(t);
        osc.stop(t + 0.26);
      };

      const playSnare = (t: number) => {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 980;
        bp.Q.value = 1.4;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.09, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
        src.connect(bp);
        bp.connect(g);
        g.connect(lofiBus);
        src.start(t);
        src.stop(t + 0.12);
      };

      const playHat = (t: number, soft = false) => {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 4200;
        const g = ctx.createGain();
        g.gain.setValueAtTime(soft ? 0.014 : 0.026, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
        src.connect(hp);
        hp.connect(g);
        g.connect(master);
        src.start(t);
        src.stop(t + 0.05);
      };

      const playChord = (t: number, chord: number[]) => {
        for (let i = 0; i < chord.length; i++) {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = i === 0 ? "triangle" : "sine";
          // Subtle lo-fi tape pitch warmth
          osc.frequency.setValueAtTime(chord[i] * (1 + (Math.random() - 0.5) * 0.003), t);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(0.036, t + 0.08 + i * 0.02);
          g.gain.exponentialRampToValueAtTime(0.001, t + 2.9);
          osc.connect(g);
          g.connect(lofiBus);
          osc.start(t);
          osc.stop(t + 3.0);
        }
      };

      const tickLofi = () => {
        if (document.hidden || ctx.state !== "running") return;
        const t = ctx.currentTime + 0.02;
        const beatInBar = step % 8;
        if (beatInBar === 0) {
          playKick(t, 1.0);
          const chordIdx = Math.floor(step / 8) % LOFI_CHORDS.length;
          playChord(t, LOFI_CHORDS[chordIdx]);
        } else if (beatInBar === 2 || beatInBar === 6) {
          playSnare(t);
        } else if (beatInBar === 4) {
          playKick(t, 0.85);
        } else if (beatInBar === 5) {
          playKick(t, 0.48); // gentle boom-bap syncopation!
        }
        playHat(t, beatInBar % 2 === 1);
        step++;
      };

      tickLofi();
      timers.push(setInterval(tickLofi, 416));
    }

    // 2. Cozy Human Working Ambience (natural typing bursts + soft clicks)
    if (playWorking) {
      let burstLeft = 5;
      let pauseTicks = 0;

      const tickTyping = () => {
        if (document.hidden || ctx.state !== "running") return;
        if (pauseTicks > 0) {
          pauseTicks--;
          return;
        }
        if (burstLeft <= 0) {
          burstLeft = 3 + Math.floor(Math.random() * 8);
          pauseTicks = 2 + Math.floor(Math.random() * 5);
          return;
        }
        burstLeft--;
        if (Math.random() < 0.25) return;

        const t = ctx.currentTime;
        const isSpacebar = Math.random() < 0.14;
        const src = ctx.createBufferSource();
        const len = Math.floor(ctx.sampleRate * (isSpacebar ? 0.042 : 0.028));
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const samples = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
          samples[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.17));
        }
        src.buffer = buf;

        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = isSpacebar ? 540 + Math.random() * 180 : 950 + Math.random() * 900;
        filter.Q.value = 1.6;

        const gain = ctx.createGain();
        gain.gain.value = (mode === "mix" ? 0.14 : 0.24) * (0.75 + Math.random() * 0.45);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(master);
        src.start(t);
        src.onended = () => {
          src.disconnect();
          filter.disconnect();
          gain.disconnect();
        };
      };

      timers.push(setInterval(tickTyping, 145));
    }

    return () => {
      timers.forEach(clearInterval);
      ctxRef.current = null;
      masterRef.current = null;
      void ctx.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const label =
    mode === "off"
      ? "Sound off"
      : mode === "lofi"
      ? "Lo-Fi beat"
      : mode === "working"
      ? "Working"
      : "Lo-Fi + Work";

  const icon = mode === "off" ? "♪" : mode === "working" ? "⌨" : "♫";

  return (
    <div className="sound-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`office-top-button${mode !== "off" ? " is-sound-on" : ""}`}
        aria-expanded={menuOpen}
        aria-haspopup="dialog"
        aria-label={`Studio sound: ${label}`}
        title="Studio soundscape (Lo-Fi low-beat, Working typing sound, & volume)"
        onClick={() => setMenuOpen(v => !v)}
      >
        <span aria-hidden="true">{icon}</span>
        <span className="btn-label">{label}</span>
      </button>

      {menuOpen && (
        <div className="sound-popover" role="dialog" aria-label="Studio sound mixer">
          <div className="sound-pop-head">
            <b>Studio sound</b>
            <small>{mode === "off" ? "Muted" : `${volume}%`}</small>
          </div>
          <div className="sound-seg" role="group" aria-label="Soundscape mode">
            {(
              [
                ["off", "Off"],
                ["lofi", "Lo-Fi"],
                ["working", "Working"],
                ["mix", "Mix"],
              ] as const
            ).map(([m, text]) => (
              <button
                key={m}
                type="button"
                className="theme-seg-btn"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
              >
                {text}
              </button>
            ))}
          </div>
          <label className="sound-vol-row">
            <span className="hlabel">Volume</span>
            <input
              type="range"
              className="sound-slider"
              min={0}
              max={100}
              step={1}
              value={volume}
              aria-label="Sound volume"
              onChange={e => {
                const next = Number(e.target.value);
                setVolume(next);
                if (next > 0 && mode === "off") {
                  try {
                    const prev = parseSoundMode(localStorage.getItem(MODE_KEY));
                    setMode(prev !== "off" ? prev : "lofi");
                  } catch {
                    setMode("lofi");
                  }
                }
              }}
            />
            <span className="sound-vol-val">{volume}%</span>
          </label>
          <p className="sound-hint">
            {mode === "lofi"
              ? "Warm 72 BPM lo-fi low-beat chords for deep focus."
              : mode === "working"
              ? "Cozy studio keyboard typing bursts."
              : mode === "mix"
              ? "Lo-Fi low-beat layered with gentle studio typing."
              : "Pick Lo-Fi beat or Working sound to start."}
          </p>
        </div>
      )}
    </div>
  );
}
