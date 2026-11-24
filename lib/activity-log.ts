// Persistent rolling activity log stored locally in data/activity.json (git-ignored).
// Combines user UI actions, task approvals/revisions, chain progression, office open/close, and watchdog events.
import "server-only";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { readJsonFile, updateJsonLocked } from "./json-store";
import type { ActivityEvent, ActivityKind } from "./munder-workflows";

export type StoredActivityEvent = ActivityEvent & {
  isoAt: string;
  source?: "ui" | "api" | "chain" | "watchdog" | "schedule";
  meta?: Record<string, string | number | boolean | null>;
};

const MAX_PER_WORKSPACE = 200;
const file = () => join(process.cwd(), "data", "activity.json");
const tz = () => process.env.KANTOR_TIMEZONE || "Asia/Jakarta";

function fmtClock(date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: tz(), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  } catch {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
}

type Store = Record<string, StoredActivityEvent[]>;

export function readActivity(wsId: string, limit = 50): StoredActivityEvent[] {
  const store = readJsonFile<Store>(file(), () => ({}), { tolerateInvalid: true });
  const list = Array.isArray(store[wsId]) ? store[wsId] : [];
  return list.slice(0, Math.max(1, Math.min(200, limit)));
}

export function readAllActivity(): Store {
  return readJsonFile<Store>(file(), () => ({}), { tolerateInvalid: true });
}

export async function appendActivity(
  wsId: string,
  input: {
    kind: ActivityKind;
    title: string;
    detail?: string;
    agentId?: string;
    issueId?: string;
    source?: StoredActivityEvent["source"];
    meta?: StoredActivityEvent["meta"];
  }
): Promise<StoredActivityEvent> {
  const now = new Date();
  const entry: StoredActivityEvent = {
    id: `${Date.now()}-${randomUUID().slice(0, 6)}`,
    kind: input.kind,
    title: input.title.trim().slice(0, 140),
    detail: input.detail ? input.detail.trim().slice(0, 260) : undefined,
    at: fmtClock(now),
    isoAt: now.toISOString(),
    agentId: input.agentId,
    issueId: input.issueId,
    ws: wsId,
    source: input.source ?? "api",
    meta: input.meta,
  };
  await updateJsonLocked<Store, StoredActivityEvent>(
    "activity-log",
    file(),
    () => ({}),
    current => {
      const prev = Array.isArray(current[wsId]) ? current[wsId] : [];
      const nextList = [entry, ...prev].slice(0, MAX_PER_WORKSPACE);
      return { next: { ...current, [wsId]: nextList }, result: entry };
    },
    { tolerateInvalid: true }
  );
  return entry;
}
