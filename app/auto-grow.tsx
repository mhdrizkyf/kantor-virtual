"use client";
// Text boxes that grow with what you type (up to a limit, then they scroll), like a chat composer.
// Optimized to avoid forced synchronous reflow on every keystroke.
import { useEffect, useRef, type RefObject } from "react";

export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string, maxPx = 320) {
  const prevLen = useRef(-1);
  const lastHeight = useRef<number | null>(null);
  const borderRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const apply = () => {
      rafRef.current = null;
      const node = ref.current;
      if (!node) return;
      if (borderRef.current === null) {
        const cs = getComputedStyle(node);
        borderRef.current = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
      }
      const border = borderRef.current;
      const grew = value.length >= prevLen.current;
      prevLen.current = value.length;

      // Fast path while typing forward: if content still fits inside current box, skip layout reset completely.
      if (grew && lastHeight.current !== null && node.scrollHeight <= node.clientHeight) {
        return;
      }

      // Only collapse to "auto" when shrinking or on initial measurement.
      if (!grew || lastHeight.current === null) {
        node.style.height = "auto";
      }
      const want = node.scrollHeight + border;
      const nextH = Math.min(want, maxPx);
      if (lastHeight.current !== nextH) {
        lastHeight.current = nextH;
        node.style.height = `${nextH}px`;
      }
      const nextOverflow = want > maxPx ? "auto" : "hidden";
      if (node.style.overflowY !== nextOverflow) {
        node.style.overflowY = nextOverflow;
      }
    };

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(apply);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [ref, value, maxPx]);
}

/** A textarea that grows with its text. */
export function GrowText({ maxPx, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string; maxPx?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(ref, props.value, maxPx);
  return <textarea ref={ref} rows={props.rows ?? 2} {...props} />;
}
