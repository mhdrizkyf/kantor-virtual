"use client";
// Kotak tulisan dengan @mention: ketik "@" lalu pilih teman (manusia atau agen).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Mentionable } from "@/lib/mentions";
import { useAutoGrow } from "./auto-grow";
import CharacterFace from "./character-face";

type Props = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string; onChange: (v: string) => void;
  people: Mentionable[]; picked: Mentionable[]; onPick: (p: Mentionable[]) => void;
};

type PopPos = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

export default function MentionBox({ value, onChange, people, picked, onPick, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const popRef = useRef<HTMLUListElement>(null);
  useAutoGrow(ref, value);
  const [q, setQ] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState<PopPos | null>(null);

  const matches = useMemo(() => q === null ? [] :
    people.filter(p => p.name.toLowerCase().includes(q.toLowerCase())), [q, people]);
  const open = q !== null && matches.length > 0;

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const update = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pad = 10;
      const gap = 6;
      const width = Math.min(Math.max(r.width, 280), vw - pad * 2);
      const left = Math.max(pad, Math.min(r.left, vw - width - pad));
      const spaceAbove = r.top - pad - gap;
      const spaceBelow = vh - r.bottom - pad - gap;
      const placeAbove = spaceAbove >= 190 || spaceAbove >= spaceBelow;
      const avail = placeAbove ? spaceAbove : spaceBelow;
      const maxHeight = Math.max(120, Math.min(320, Math.floor(avail)));
      setPos(placeAbove
        ? { left, width, bottom: Math.round(vh - r.top + gap), maxHeight }
        : { left, width, top: Math.round(r.bottom + gap), maxHeight });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, value, matches.length]);

  // Promote to the native browser top layer via popover="manual" when supported so no overflow/z-index clips it.
  const hasPos = pos !== null;
  useEffect(() => {
    const el = popRef.current;
    if (!el || !open || !hasPos || typeof HTMLElement === "undefined" || !Object.hasOwn(HTMLElement.prototype, "popover")) return;
    try {
      if (!el.matches(":popover-open")) el.showPopover();
    } catch {
      // Ignore if already open or detached.
    }
    return () => {
      try {
        if (el.matches(":popover-open")) el.hidePopover();
      } catch {
        // Ignore on unmount.
      }
    };
  }, [open, hasPos]);

  // Keep keyboard-selected item visible when scrolling long agent lists.
  useEffect(() => {
    if (!open) return;
    const item = popRef.current?.children[hi] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [open, hi]);

  function sync(text: string, caret: number) {
    if (!text.includes("@")) {
      if (q !== null) setQ(null);
      return;
    }
    const before = text.slice(0, caret);
    const m = before.match(/(^|\s)@([^\s@]{0,24})$/);
    if (m) { setQ(m[2]); setAt(caret - m[2].length - 1); setHi(0); } else if (q !== null) setQ(null);
  }

  function choose(p: Mentionable) {
    const el = ref.current; if (!el) return;
    const caret = el.selectionStart;
    const next = value.slice(0, at) + "@" + p.name + " " + value.slice(caret);
    onChange(next);
    if (!picked.some(x => x.id === p.id)) onPick([...picked, p]);
    setQ(null);
    const pos = at + p.name.length + 2;
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos); });
  }

  const popup = open && pos && typeof document !== "undefined" ? createPortal(
    <ul
      ref={popRef}
      className="mpop"
      role="listbox"
      aria-label="Pick who to mention"
      popover="manual"
      onMouseDown={e => e.preventDefault()}
      style={{
        left: `${pos.left}px`,
        width: `${pos.width}px`,
        maxHeight: `${pos.maxHeight}px`,
        ...(pos.top !== undefined ? { top: `${pos.top}px`, bottom: "auto" } : { bottom: `${pos.bottom}px`, top: "auto" }),
      }}
    >
      {matches.map((p, i) => (
        <li key={p.id} role="option" aria-selected={i === hi}>
          <button type="button" onMouseDown={e => { e.preventDefault(); choose(p); }} onMouseEnter={() => setHi(i)}>
            <span className="mp-av">{p.face ? <CharacterFace face={p.face} size={24} shape="circle" /> : p.name.slice(0, 1).toUpperCase()}</span>
            <span className="mp-name">{p.name}</span>
            <small>{p.kind === "agent" ? "agent · replies right away" : "person · gets notified"}</small>
          </button>
        </li>
      ))}
    </ul>,
    document.body
  ) : null;

  return (
    <div className="mbox">
      <textarea ref={ref} {...rest} value={value}
        onChange={e => { onChange(e.target.value); sync(e.target.value, e.target.selectionStart); }}
        onClick={e => sync(value, (e.target as HTMLTextAreaElement).selectionStart)}
        onBlur={() => setTimeout(() => setQ(null), 150)}
        onKeyDown={e => {
          if (q !== null && matches.length) {
            if (e.key === "ArrowDown") { e.preventDefault(); setHi((hi + 1) % matches.length); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setHi((hi - 1 + matches.length) % matches.length); return; }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(matches[hi]); return; }
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setQ(null); return; }
          }
          rest.onKeyDown?.(e);
        }} />
      {popup}
    </div>
  );
}

/** Tampilkan tautan mention sebagai label "@Nama" di dalam markdown. */
export const mentionLink = (p: React.AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) => {
  const { node: _n, ...a } = p;
  if (a.href?.startsWith("mention://")) return <span className={`mention m-${a.href.split("/")[2]}`}>{a.children}</span>;
  return <a {...a} target="_blank" rel="noreferrer" />;
};
export const keepMentionUrl = (url: string) => url.startsWith("mention://") ? url : /^(https?:|mailto:|\/|#)/i.test(url) ? url : "";
