// The assistant's own WhatsApp number, linked like WhatsApp Web (unofficial: whatsapp-web.js).
// Messages only go out when a person presses "Approve & send" in Virtual Office.
// The login is kept in data/wa-session/ on this computer (git-ignored). Optional: needs `npm install whatsapp-web.js`.
import "server-only";
import { existsSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { normalizePhone } from "./whatsapp";

export type BotState = {
  status: "missing" | "off" | "starting" | "code" | "ready" | "error";
  code?: string; phone?: string; name?: string; error?: string;
};
type WaClient = {
  initialize(): Promise<void>; destroy(): Promise<void>; logout(): Promise<void>;
  on(ev: string, f: (...a: unknown[]) => void): void;
  getNumberId(n: string): Promise<{ _serialized: string } | null>;
  sendMessage(to: string, text: string): Promise<unknown>;
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

/** Send one message from the assistant's number. Messages go out one at a time, at least 20 seconds apart. */
export function botSend(phone: string, text: string) {
  const run = async () => {
    const c = box.client;
    if (!c || box.state.status !== "ready") throw new Error("The assistant's WhatsApp isn't connected.");
    const to = normalizePhone(phone);
    if (!to) throw new Error("That phone number doesn't look right.");
    const id = await c.getNumberId(to);
    if (!id) throw new Error(`+${to} isn't on WhatsApp.`);
    const wait = box.lastSent + GAP_MS - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    await c.sendMessage(id._serialized, text);
    box.lastSent = Date.now();
    return { at: new Date().toISOString() };
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
export type Queued = { id: string; phone: string; name: string; text: string; at: string; status: "waiting" | "sent" | "failed" | "cancelled"; error?: string; sentAt?: string };
const QUEUE = join(process.cwd(), "data", "wa-queue.json");
const readQueue = (): Queued[] => { try { return JSON.parse(readFileSync(QUEUE, "utf8")); } catch { return []; } };
const writeQueue = (q: Queued[]) => {
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  const weekAgo = Date.now() - 7 * 864e5; // keep sent/failed ones for a week
  writeFileSync(QUEUE, JSON.stringify(q.filter(x => x.status === "waiting" || Date.parse(x.sentAt ?? x.at) > weekAgo), null, 2));
};
export const listQueue = () => readQueue().filter(x => x.status !== "cancelled").sort((a, b) => a.at.localeCompare(b.at));

export function scheduleSend(phone: string, name: string, text: string, at: Date) {
  const to = normalizePhone(phone);
  if (!to) throw new Error("That phone number doesn't look right.");
  if (at.getTime() < Date.now() - 60_000) throw new Error("That time has already passed.");
  const item: Queued = { id: randomUUID(), phone: to, name, text, at: at.toISOString(), status: "waiting" };
  writeQueue([...readQueue(), item]);
  return item;
}
export function cancelQueued(id: string) {
  const q = readQueue();
  const it = q.find(x => x.id === id);
  if (!it || it.status !== "waiting") throw new Error("That message isn't waiting any more.");
  it.status = "cancelled"; writeQueue(q);
}

let running = false;
/** Send the scheduled messages whose time has come (runs every minute while the app is open). */
export async function runDueSends() {
  if (running || box.state.status !== "ready") return;
  running = true;
  try {
    for (const it of readQueue().filter(x => x.status === "waiting" && Date.parse(x.at) <= Date.now())) {
      let r: Partial<Queued>;
      try { await botSend(it.phone, it.text); r = { status: "sent", sentAt: new Date().toISOString() }; }
      catch (e) { r = { status: "failed", error: String(e instanceof Error ? e.message : e).slice(0, 200), sentAt: new Date().toISOString() }; }
      const q = readQueue(); const cur = q.find(x => x.id === it.id);
      if (cur && cur.status === "waiting") { Object.assign(cur, r); writeQueue(q); }
      console.log("[whatsapp]", r.status, "to", it.name || it.phone);
    }
  } finally { running = false; }
}

// Check for scheduled messages every minute, once per server (started when this module first loads).
const timers = globalThis as unknown as { __kantorWaTimer?: ReturnType<typeof setInterval> };
timers.__kantorWaTimer ??= setInterval(() => { runDueSends().catch(e => console.warn("[whatsapp]", String(e).slice(0, 200))); }, 60_000);
