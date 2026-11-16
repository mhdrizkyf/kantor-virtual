// The assistant's own WhatsApp number, linked like WhatsApp Web (unofficial: whatsapp-web.js).
// Messages only go out when a person presses "Approve & send" in Virtual Office.
// The login is kept in data/wa-session/ on this computer (git-ignored). Optional: needs `npm install whatsapp-web.js`.
import "server-only";
import { existsSync, rmSync } from "node:fs";
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

async function lib(): Promise<{ Client: new (o: object) => WaClient; LocalAuth: new (o: object) => unknown } | null> {
  try {
    const m = await import(/* webpackIgnore: true */ "whatsapp-web.js" as string);
    return (m.default ?? m) as never;
  } catch { return null; }
}

export async function botState(): Promise<BotState> {
  if (box.state.status === "off" && !(await lib())) return { status: "missing" };
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
