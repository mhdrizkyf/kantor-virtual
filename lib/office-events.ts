// Local in-process pub/sub event bus for instant (<50ms) SSE push updates without external hosting or Redis.
import "server-only";
import { invalidateWorkspaceCache } from "./multica";

export type OfficeLiveEvent = {
  type: "changed";
  wsId: string;
  reason: string;
  at: number;
  fp?: string;
};

type Listener = (ev: OfficeLiveEvent) => void;

type BusState = {
  byWs: Map<string, Set<Listener>>;
};

const g = globalThis as unknown as { __kantorOfficeBus?: BusState };
const bus: BusState = (g.__kantorOfficeBus ??= { byWs: new Map() });

export function subscribeOfficeEvents(wsId: string, listener: Listener): () => void {
  const key = wsId || "*";
  let set = bus.byWs.get(key);
  if (!set) {
    set = new Set();
    bus.byWs.set(key, set);
  }
  set.add(listener);
  return () => {
    const cur = bus.byWs.get(key);
    if (!cur) return;
    cur.delete(listener);
    if (cur.size === 0) bus.byWs.delete(key);
  };
}

export function activeOfficeSubscriberCount(wsId?: string): number {
  if (wsId) return bus.byWs.get(wsId)?.size ?? 0;
  let total = 0;
  for (const set of bus.byWs.values()) total += set.size;
  return total;
}

/**
 * Invalidate the server cache for a workspace and notify all connected local SSE tabs immediately.
 */
export function emitOfficeChange(wsId: string | null | undefined, reason: string, opts?: { fp?: string; skipInvalidate?: boolean }) {
  const target = wsId ?? "*";
  if (!opts?.skipInvalidate) {
    invalidateWorkspaceCache(wsId ?? null);
  }
  const ev: OfficeLiveEvent = {
    type: "changed",
    wsId: target,
    reason,
    at: Date.now(),
    ...(opts?.fp ? { fp: opts.fp } : {}),
  };
  const deliver = (set?: Set<Listener>) => {
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(ev); } catch { /* isolate bad subscriber */ }
    }
  };
  if (target === "*") {
    for (const set of bus.byWs.values()) deliver(set);
  } else {
    deliver(bus.byWs.get(target));
    deliver(bus.byWs.get("*"));
  }
}
