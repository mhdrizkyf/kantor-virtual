"use client";
import { useEffect, useRef } from "react";

// One request per URL at a time, even when two panels ask for the same detail.
const pending = new Map<string, Promise<unknown>>();
export function sharedJson<T>(url: string): Promise<T> {
  const existing = pending.get(url);
  if (existing) return existing as Promise<T>;
  const request = fetch(url).then(async r => {
    const value = await r.json();
    if (!r.ok || value.error) throw new Error(value.error ?? `Request failed (${r.status})`);
    return value as T;
  }).finally(() => pending.delete(url));
  pending.set(url, request);
  return request;
}

/** Poll only while the tab is visible; never overlap a slow previous tick. */
export function useVisiblePoll(run: () => void | Promise<unknown>, ms: number, enabled = true) {
  const callback = useRef(run);
  callback.current = run;
  useEffect(() => {
    if (!enabled) return;
    let active = true, busy = false;
    const tick = async () => {
      if (!active || busy || document.visibilityState !== "visible") return;
      busy = true;
      try { await callback.current(); } catch { /* keep polling after a transient failure */ } finally { busy = false; }
    };
    const visible = () => { if (document.visibilityState === "visible") void tick(); };
    const timer = setInterval(() => { void tick(); }, ms);
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [enabled, ms]);
}
