"use client";
// Unsent text is kept in this browser as a draft, so closing a pop-up by accident loses nothing.
// Drafts are removed as soon as the box is empty again (for example right after sending).
import { useEffect, useRef } from "react";

const PREFIX = "kantor-draft:";

export function readDraft<T>(key: string): T | null {
  try { const raw = localStorage.getItem(PREFIX + key); return raw ? JSON.parse(raw) as T : null; } catch { return null; }
}

export function writeDraft(key: string, value: object | null) {
  try { if (value) localStorage.setItem(PREFIX + key, JSON.stringify({ ...value, savedAt: Date.now() })); else localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
}

/** `value` must keep the same identity until it changes (useMemo). Restore `value` from the draft stored under `key`, and keep the draft up to date while typing. */
export function useDraft<T>(key: string | null, value: T, set: (v: T) => void, blank: T, isEmpty: (v: T) => boolean) {
  const loaded = useRef<string | null>(null);
  const stale = useRef<T | null>(null);
  useEffect(() => {
    loaded.current = null;
    if (!key) return;
    const saved = readDraft<T>(key);
    stale.current = value; // this render still holds the previous box's text: don't save it under the new key
    set(saved ?? blank);
    loaded.current = key;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!key || loaded.current !== key) return;
    if (value === stale.current) return;
    stale.current = null;
    try {
      if (isEmpty(value)) localStorage.removeItem(PREFIX + key);
      else localStorage.setItem(PREFIX + key, JSON.stringify({ ...value as object, savedAt: Date.now() }));
    } catch { /* storage unavailable: drafts just aren't kept */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value]);
}
