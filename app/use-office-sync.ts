"use client";
// Real-time local Server-Sent Events (SSE) synchronization with automatic visibility sleep
// and seamless fallback to lightweight /api/office/sync delta polling.
import { useCallback, useEffect, useRef, useState } from "react";
import { useVisiblePoll } from "./visible-poll";

const FALLBACK_POLL_MS = 15_000;
const REFRESH_COALESCE_MS = 150;

export function useOfficeSync(workspaceId: string, onChange: () => void) {
  const [liveConnected, setLiveConnected] = useState(false);
  const syncFpRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const coalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRefresh = useCallback(() => {
    if (coalesceTimerRef.current) clearTimeout(coalesceTimerRef.current);
    coalesceTimerRef.current = setTimeout(() => {
      coalesceTimerRef.current = null;
      onChangeRef.current();
    }, REFRESH_COALESCE_MS);
  }, []);

  useEffect(() => {
    syncFpRef.current = null;
  }, [workspaceId]);

  // Connect local EventSource ONLY while tab is visible; close immediately when hidden so zero resources are used.
  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const disconnect = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (es) {
        es.close();
        es = null;
      }
      setLiveConnected(false);
    };

    const connect = () => {
      if (disposed || document.visibilityState !== "visible" || es) return;
      const qs = new URLSearchParams({ ws: workspaceId });
      if (syncFpRef.current) qs.set("fp", syncFpRef.current);
      const source = new EventSource(`/api/office/stream?${qs.toString()}`);
      es = source;

      source.addEventListener("connected", () => {
        if (!disposed) setLiveConnected(true);
      });

      source.addEventListener("ready", event => {
        try {
          const data = JSON.parse((event as MessageEvent<string>).data) as { fp?: string };
          if (data.fp) {
            const hadPrev = syncFpRef.current !== null;
            const changed = syncFpRef.current !== data.fp;
            syncFpRef.current = data.fp;
            if (hadPrev && changed) triggerRefresh();
          }
        } catch { /* ignore malformed payload */ }
      });

      source.addEventListener("office", event => {
        try {
          const data = JSON.parse((event as MessageEvent<string>).data) as { fp?: string };
          if (data.fp) syncFpRef.current = data.fp;
        } catch { /* ignore malformed payload */ }
        triggerRefresh();
      });

      source.onerror = () => {
        if (disposed) return;
        source.close();
        if (es === source) es = null;
        setLiveConnected(false);
        if (document.visibilityState === "visible" && !reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
          }, 5000);
        }
      };
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") connect();
      else disconnect();
    };

    if (document.visibilityState === "visible") connect();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      disconnect();
      if (coalesceTimerRef.current) {
        clearTimeout(coalesceTimerRef.current);
        coalesceTimerRef.current = null;
      }
    };
  }, [workspaceId, triggerRefresh]);

  // Automatic fallback delta polling when SSE is unavailable or temporarily disconnected
  const pollFallback = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ ws: workspaceId });
      if (syncFpRef.current) qs.set("fp", syncFpRef.current);
      const r = await fetch(`/api/office/sync?${qs.toString()}`);
      if (r.status === 304) return;
      if (!r.ok) {
        onChangeRef.current();
        return;
      }
      const j = (await r.json()) as { fp?: string };
      if (!j.fp) return;
      const hadPrev = syncFpRef.current !== null;
      if (syncFpRef.current !== j.fp) {
        syncFpRef.current = j.fp;
        if (hadPrev) onChangeRef.current();
      }
    } catch {
      onChangeRef.current();
    }
  }, [workspaceId]);

  useVisiblePoll(pollFallback, FALLBACK_POLL_MS, !liveConnected);

  return { liveConnected };
}
