"use client";
// Lightweight Klipi FAB shell: dynamically loads the full capture/audio/upload panel
// only when the user clicks Klipi, presses Option+Shift+K (or Option+Shift+S), or drops a file onto the FAB.
import { useEffect, useState, type DragEvent } from "react";
import dynamic from "next/dynamic";
import type { StaplerMode } from "./stapler-full";
import KlipiMascot from "./klipi-mascot";

const StaplerFull = dynamic(() => import("./stapler-full"), { ssr: false });

export default function Stapler({ ws }: { ws: string }) {
  const [mounted, setMounted] = useState(false);
  const [initialFile, setInitialFile] = useState<File | null>(null);
  const [initialMode, setInitialMode] = useState<StaplerMode>("note");
  const [fabDragOver, setFabDragOver] = useState(false);

  useEffect(() => {
    if (mounted) return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (e.altKey && e.shiftKey && (k === "k" || k === "s")) {
        e.preventDefault();
        setMounted(true);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [mounted]);

  if (mounted) {
    return <StaplerFull ws={ws} initialOpen initialMode={initialMode} initialFile={initialFile} />;
  }

  const handleFabDragOver = (e: DragEvent<HTMLButtonElement>) => {
    if (!e.dataTransfer?.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setFabDragOver(true);
  };

  const handleFabDrop = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setFabDragOver(false);
    const dropped = e.dataTransfer?.files?.[0] ?? null;
    if (dropped) {
      setInitialFile(dropped);
      setInitialMode(dropped.type.startsWith("image/") ? "screenshot" : dropped.type.startsWith("audio/") ? "voice" : "note");
    }
    setMounted(true);
  };

  return (
    <div className="stapler-root">
      <button
        type="button"
        className={`stapler-fab${fabDragOver ? " is-dragover" : ""}`}
        aria-label="Buka Klipi quick capture"
        aria-expanded={false}
        onClick={() => setMounted(true)}
        onDragOver={handleFabDragOver}
        onDragLeave={() => setFabDragOver(false)}
        onDrop={handleFabDrop}
      >
        <KlipiMascot mood="idle" size="md" />
        <span className="stapler-fab-text">
          {fabDragOver ? (
            <>
              <b>Drop file</b>
              <small>Jepit ke Klipi</small>
            </>
          ) : (
            <>
              <b>Klipi</b>
              <small>Capture · ⌥⇧K</small>
            </>
          )}
        </span>
      </button>
    </div>
  );
}
