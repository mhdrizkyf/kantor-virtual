"use client";
// Lightweight Stapler FAB shell: dynamically loads the full 840-line capture/audio/upload panel
// only when the user clicks Stapler, presses Option+Shift+S, or drops a file onto the FAB.
import { useEffect, useState, type DragEvent } from "react";
import dynamic from "next/dynamic";
import type { StaplerMode } from "./stapler-full";

const StaplerFull = dynamic(() => import("./stapler-full"), { ssr: false });

export default function Stapler({ ws }: { ws: string }) {
  const [mounted, setMounted] = useState(false);
  const [initialFile, setInitialFile] = useState<File | null>(null);
  const [initialMode, setInitialMode] = useState<StaplerMode>("note");
  const [fabDragOver, setFabDragOver] = useState(false);

  useEffect(() => {
    if (mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && e.key.toLowerCase() === "s") {
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
        aria-label="Open Stapler quick capture"
        aria-expanded={false}
        onClick={() => setMounted(true)}
        onDragOver={handleFabDragOver}
        onDragLeave={() => setFabDragOver(false)}
        onDrop={handleFabDrop}
      >
        <span className="stapler-face is-idle sz-md" aria-hidden="true">
          <span className="stapler-eyes"><i /><i /></span>
          <span className="stapler-cheeks"><i /><i /></span>
          <span className="stapler-smile" />
        </span>
        <span className="stapler-fab-text">
          {fabDragOver ? (
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
    </div>
  );
}
