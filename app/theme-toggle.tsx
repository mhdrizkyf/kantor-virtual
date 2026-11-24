"use client";
import { useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";

const STORAGE_KEY = "color-scheme";
const SYNC_EVENT = "kantor:theme-change";

function readStored(): ThemeChoice {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    /* storage unavailable */
  }
  return "system";
}

function applyMeta(choice: ThemeChoice) {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (meta) meta.content = choice === "system" ? "light dark" : choice;
}

function writeChoice(choice: ThemeChoice) {
  applyMeta(choice);
  try {
    if (choice === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* storage unavailable; theme still applied in memory via meta */
  }
  window.dispatchEvent(new CustomEvent<ThemeChoice>(SYNC_EVENT, { detail: choice }));
}

export default function ThemeToggle({ variant = "segmented" }: { variant?: "segmented" | "compact" }) {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const initial = readStored();
    setChoice(initial);
    applyMeta(initial);

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const syncMedia = () => setSystemDark(mq.matches);
    syncMedia();
    mq.addEventListener("change", syncMedia);

    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== STORAGE_KEY) return;
      const next = readStored();
      setChoice(next);
      applyMeta(next);
    };
    const onLocal = (e: Event) => {
      const next = (e as CustomEvent<ThemeChoice>).detail;
      if (next === "system" || next === "light" || next === "dark") setChoice(next);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(SYNC_EVENT, onLocal);
    return () => {
      mq.removeEventListener("change", syncMedia);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SYNC_EVENT, onLocal);
    };
  }, []);

  const resolvedDark = choice === "dark" || (choice === "system" && systemDark);

  function select(next: ThemeChoice) {
    setChoice(next);
    writeChoice(next);
  }

  function toggleTwoState() {
    const target: "light" | "dark" = resolvedDark ? "light" : "dark";
    const systemPref: "light" | "dark" = systemDark ? "dark" : "light";
    // When target matches current system preference, return to system so future OS switches still work.
    select(target === systemPref ? "system" : target);
  }

  if (variant === "compact") {
    return (
      <button
        type="button"
        className="theme-compact"
        onClick={toggleTwoState}
        aria-label={resolvedDark ? "Switch to light theme" : "Switch to dark theme"}
        title={choice === "system" ? `Theme: System (${systemDark ? "Dark" : "Light"})` : `Theme: ${choice === "dark" ? "Dark" : "Light"}`}
      >
        <span className="theme-ic" aria-hidden="true">
          {resolvedDark ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
            </svg>
          )}
        </span>
      </button>
    );
  }

  const options: { id: ThemeChoice; label: string; title: string }[] = [
    { id: "system", label: "Auto", title: `Follow system (${systemDark ? "currently dark" : "currently light"})` },
    { id: "light", label: "Light", title: "Always use light theme" },
    { id: "dark", label: "Dark", title: "Always use dark theme" },
  ];

  return (
    <div className="theme-seg" role="group" aria-label="Color theme">
      {options.map(opt => (
        <button
          key={opt.id}
          type="button"
          className="theme-seg-btn"
          aria-pressed={choice === opt.id}
          title={opt.title}
          onClick={() => select(opt.id)}
        >
          <span className="theme-ic" aria-hidden="true">
            {opt.id === "system" && (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            )}
            {opt.id === "light" && (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
            )}
            {opt.id === "dark" && (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
              </svg>
            )}
          </span>
          <span>{opt.label}</span>
        </button>
      ))}
    </div>
  );
}
