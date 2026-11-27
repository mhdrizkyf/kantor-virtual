// The assistant's own WhatsApp number, linked like WhatsApp Web (unofficial: whatsapp-web.js).
// Messages only go out when a person presses "Approve & send" in Virtual Office.
// The login is kept in data/wa-session/ on this computer (git-ignored). Optional: needs `npm install whatsapp-web.js`.
import "server-only";
import { existsSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { normalizePhone, normalizeTarget, isGroup } from "./whatsapp";
import { call_, workspace } from "./multica";
import { readJsonFile, updateJsonLocked } from "./json-store";

export type BotState = {
  status: "missing" | "off" | "starting" | "code" | "ready" | "error";
  code?: string; phone?: string; name?: string; error?: string;
};
type WaClient = {
  initialize(): Promise<void>; destroy(): Promise<void>; logout(): Promise<void>;
  on(ev: string, f: (...a: unknown[]) => void): void;
  getNumberId(n: string): Promise<{ _serialized: string } | null>;
  getChats(): Promise<{ id: { _serialized: string }; name?: string; isGroup?: boolean; participants?: unknown[]; groupMetadata?: { participants?: unknown[] } }[]>;
  sendMessage(to: string, text: string): Promise<unknown>;
  getState(): Promise<unknown>;
  info?: { wid?: { user?: string }; pushname?: string };
};
type Box = { state: BotState; client: WaClient | null; lastSent: number; queue: Promise<unknown> };

const g = globalThis as unknown as { __kantorWa?: Box };
const box: Box = g.__kantorWa ??= { state: { status: "off" }, client: null, lastSent: 0, queue: Promise.resolve() };
const SESSION = join(process.cwd(), "data", "wa-session");
const CHROME = process.env.KANTOR_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const GAP_MS = 20_000; // space messages out a little, like a person would

let libError = "";
async function lib(): Promise<{ Client: new (o: object) => WaClient; LocalAuth: new (o: object) => unknown } | null> {
  try {
    const m = await import(/* webpackIgnore: true */ "whatsapp-web.js" as string);
    return (m.default ?? m) as never;
  } catch (e) { libError = String(e instanceof Error ? e.message : e).slice(0, 300); return null; }
}

export async function botState(): Promise<BotState> {
  if (box.state.status === "missing") box.state = { status: "off" };
  if (box.state.status === "off" && !(await lib())) return { status: "missing", error: libError };
  return box.state;
}
export const hasSession = () => existsSync(SESSION);

/** Start the bot. With `phone` (the bot's own number) and no saved login, WhatsApp gives an 8-character pairing code. */
export async function startBot(phone?: string) {
  if (box.client && box.state.status !== "error") return box.state;
  const W = await lib();
  if (!W) { box.state = { status: "missing" }; return box.state; }
  const pair = phone ? normalizePhone(phone) : null;
  if (!pair && !hasSession()) throw new Error("Write the assistant's WhatsApp number first.");
  box.state = { status: "starting" };
  const client = new W.Client({
    authStrategy: new W.LocalAuth({ dataPath: SESSION }),
    puppeteer: { headless: true, executablePath: existsSync(CHROME) ? CHROME : undefined, args: ["--no-sandbox"] },
    ...(pair && !hasSession() ? { pairWithPhoneNumber: { phoneNumber: pair, showNotification: true, intervalMs: 180_000 } } : {}),
  });
  box.client = client;
  client.on("code", c => { box.state = { status: "code", code: String(c), phone: pair ?? undefined }; });
  client.on("ready", () => {
    box.state = { status: "ready", phone: client.info?.wid?.user, name: client.info?.pushname };
    console.log("[whatsapp] connected as", client.info?.wid?.user);
  });
  client.on("auth_failure", m => { box.state = { status: "error", error: `WhatsApp refused the login: ${String(m)}` }; });
  client.on("disconnected", r => {
    box.state = { status: "off", error: `Disconnected (${String(r)}).` };
    box.client = null; client.destroy().catch(() => {});
  });
  client.initialize().catch(e => {
    box.state = { status: "error", error: String(e instanceof Error ? e.message : e).slice(0, 300) };
    box.client = null;
  });
  return box.state;
}

/** Unlink the assistant's number from this computer. */
export async function stopBot() {
  const c = box.client; box.client = null;
  if (c) { await c.logout().catch(() => {}); await c.destroy().catch(() => {}); }
  rmSync(SESSION, { recursive: true, force: true });
  box.state = { status: "off" };
}

/** The hidden WhatsApp Web page reloaded or closed under us (after sleep or a WhatsApp update): the login is fine, the page isn't. */
const pageGone = (e: unknown) => /detached Frame|Target closed|Session closed|Execution context was destroyed|Protocol error|page has been closed/i.test(String(e instanceof Error ? e.message : e));

/** Throw away the dead page and reconnect with the saved login; resolves once WhatsApp is ready again. */
async function reconnect() {
  const old = box.client; box.client = null;
  box.state = { status: "off" };
  if (old) await old.destroy().catch(() => {});
  // The bot's own hidden Chrome can outlive a broken connection and keep the login folder locked: close just that one.
  await new Promise<void>(r => execFile("pkill", ["-f", `user-data-dir=${join(SESSION, "session")}`], () => r()));
  await new Promise(r => setTimeout(r, 2000));
  console.log("[whatsapp] page was gone, reconnecting");
  await startBot();
  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    if (box.state.status === "ready") return;
    if (box.state.status === "error" || box.state.status === "code") break;
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error("The assistant's WhatsApp lost its connection and couldn't reconnect. Open WhatsApp contacts to check it.");
}

/** The WhatsApp groups the assistant's number is in. */
export async function botGroups() {
  const c = box.client;
  if (!c || box.state.status !== "ready") throw new Error("The assistant's WhatsApp isn't connected.");
  return (await c.getChats()).filter(x => x.isGroup)
    .map(x => ({ id: x.id._serialized, name: x.name ?? "Group", size: (x.groupMetadata?.participants ?? x.participants ?? []).length }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Send one message from the assistant's number. Messages go out one at a time, at least 20 seconds apart. */
export function botSend(phone: string, text: string) {
  const once = async () => {
    const c = box.client;
    if (!c || box.state.status !== "ready") throw new Error("The assistant's WhatsApp isn't connected.");
    const to = normalizeTarget(phone);
    if (!to) throw new Error("That phone number doesn't look right.");
    let chat: string;
    if (isGroup(to)) {
      const g = (await c.getChats()).find(x => x.isGroup && x.id._serialized === to);
      if (!g) throw new Error("The assistant's number isn't in that WhatsApp group (anymore). Add it to the group first.");
      chat = to;
    } else {
      const id = await c.getNumberId(to);
      if (!id) throw new Error(`+${to} isn't on WhatsApp.`);
      chat = id._serialized;
    }
    const wait = box.lastSent + GAP_MS - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    await c.sendMessage(chat, text);
    box.lastSent = Date.now();
    return { at: new Date().toISOString() };
  };
  const run = async () => {
    try { return await once(); } catch (e) {
      if (!pageGone(e) && box.state.status === "ready") throw e;
      // The page died (or the bot dropped): reconnect once and try again.
      if (!hasSession()) throw e;
      await reconnect();
      return once();
    }
  };
  const p = box.queue.then(run, run);
  box.queue = p.catch(() => {});
  return p;
}

/** On app start: reconnect if the assistant's number was linked before. */
export async function autoStartBot() {
  if (hasSession() && (await lib())) await startBot().catch(e => console.warn("[whatsapp]", String(e).slice(0, 200)));
}

// ---- Scheduled messages: approved now, sent at a set time (data/wa-queue.json) ----
/** `trigger`: approved in advance, sent as soon as that task is done (instead of at a time). */
export type Trigger = { issueId: string; ws: string; title: string };
export type Queued = { id: string; phone: string; name: string; text: string; at: string; status: "waiting" | "sent" | "failed" | "cancelled"; error?: string; sentAt?: string; trigger?: Trigger };
const queueFile = () => join(process.cwd(), "data", "wa-queue.json");
const readQueue = (): Queued[] => readJsonFile<Queued[]>(queueFile(), () => [], { tolerateInvalid: true });
const pruneQueue = (q: Queued[]) => {
  const weekAgo = Date.now() - 7 * 864e5; // keep sent/failed ones for a week
  return q.filter(x => x.status === "waiting" || Date.parse(x.sentAt ?? x.at) > weekAgo);
};
export const listQueue = () => readQueue().filter(x => x.status !== "cancelled").sort((a, b) => a.at.localeCompare(b.at));

export async function scheduleSend(phone: string, name: string, text: string, at: Date, trigger?: Trigger) {
  const to = normalizeTarget(phone);
  if (!to) throw new Error("That phone number doesn't look right.");
  if (!trigger && at.getTime() < Date.now() - 60_000) throw new Error("That time has already passed.");
  return updateJsonLocked<Queued[], Queued>(
    "wa-queue",
    queueFile(),
    () => [],
    q => {
      // Approving the same message for the same task twice keeps one.
      const dup = trigger && q.find(x => x.status === "waiting" && x.trigger?.issueId === trigger.issueId && x.phone === to && x.text === text);
      if (dup) return { next: pruneQueue(q), result: dup };
      const item: Queued = { id: randomUUID(), phone: to, name, text, at: at.toISOString(), status: "waiting", ...(trigger ? { trigger } : {}) };
      return { next: pruneQueue([...q, item]), result: item };
    },
    { tolerateInvalid: true },
  );
}
export async function cancelQueued(id: string) {
  await updateJsonLocked<Queued[], void>(
    "wa-queue",
    queueFile(),
    () => [],
    q => {
      const it = q.find(x => x.id === id);
      if (!it || it.status !== "waiting") throw new Error("That message isn't waiting any more.");
      it.status = "cancelled";
      return { next: pruneQueue(q), result: undefined };
    },
    { tolerateInvalid: true },
  );
}

let running = false;
/** Send the scheduled messages whose time has come (runs every minute while the app is open). */
export async function runDueSends() {
  if (running || box.state.status !== "ready") return;
  running = true;
  try {
    // Messages approved for "when this task is done": look up each task once.
    const status = new Map<string, string>();
    for (const it of readQueue().filter(x => x.status === "waiting" && x.trigger)) {
      const t = it.trigger!;
      if (status.has(t.issueId)) continue;
      try {
        const ws = await workspace(t.ws);
        const i = await call_<{ status: string }>("GET", `/api/issues/${t.issueId}`, ws.id);
        status.set(t.issueId, i.status);
      } catch (e) { if (/→ 404/.test(String(e))) status.set(t.issueId, "deleted"); }
    }
    const gone = readQueue().filter(x => x.status === "waiting" && x.trigger && ["cancelled", "deleted"].includes(status.get(x.trigger.issueId) ?? ""));
    if (gone.length) {
      const goneIds = new Set(gone.map(g2 => g2.id));
      await updateJsonLocked<Queued[], void>(
        "wa-queue",
        queueFile(),
        () => [],
        q => {
          for (const cur of q) if (goneIds.has(cur.id)) Object.assign(cur, { status: "cancelled", error: "The task was cancelled, so the message wasn't sent.", sentAt: new Date().toISOString() });
          return { next: pruneQueue(q), result: undefined };
        },
        { tolerateInvalid: true },
      );
    }
    const due = (x: Queued) => x.status === "waiting" && (x.trigger ? status.get(x.trigger.issueId) === "done" : Date.parse(x.at) <= Date.now());
    for (const it of readQueue().filter(due)) {
      let r: Partial<Queued>;
      try { await botSend(it.phone, it.text); r = { status: "sent", sentAt: new Date().toISOString() }; }
      catch (e) { r = { status: "failed", error: String(e instanceof Error ? e.message : e).slice(0, 200), sentAt: new Date().toISOString() }; }
      await updateJsonLocked<Queued[], void>(
        "wa-queue",
        queueFile(),
        () => [],
        q => {
          const cur = q.find(x => x.id === it.id);
          if (cur && cur.status === "waiting") Object.assign(cur, r);
          return { next: pruneQueue(q), result: undefined };
        },
        { tolerateInvalid: true },
      );
      console.log("[whatsapp]", r.status, "to", it.name || it.phone);
    }
  } finally { running = false; }
}

// Check for scheduled messages every minute, once per server (started when this module first loads).
// It also checks the hidden WhatsApp page is still alive, and reconnects before anyone presses Approve & send.
async function keepAlive() {
  const c = box.client;
  if (!c || box.state.status !== "ready") return;
  try { await Promise.race([c.getState(), new Promise((_, no) => setTimeout(() => no(new Error("Session closed (no answer)")), 20_000))]); }
  catch (e) {
    if (!pageGone(e)) return;
    const p = box.queue.then(reconnect);
    box.queue = p.catch(err => console.warn("[whatsapp]", String(err).slice(0, 200)));
    await box.queue;
  }
}
const timers = globalThis as unknown as { __kantorWaTimer?: ReturnType<typeof setInterval> };
if (timers.__kantorWaTimer) clearInterval(timers.__kantorWaTimer);
timers.__kantorWaTimer = setInterval(() => { keepAlive().then(runDueSends).catch(e => console.warn("[whatsapp]", String(e).slice(0, 200))); }, 60_000);
timers.__kantorWaTimer.unref?.();
