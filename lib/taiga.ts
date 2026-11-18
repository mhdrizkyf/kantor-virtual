// Taiga daily activities: agents draft the member's activities in a ```taiga block, and the member
// approves them in the app. Each approved activity becomes a Done task under the member's user story
// (e.g. DRH #2467), with the custom fields Activity Date, Start Time, Total Time Spent and Training Activity.
// The member's Taiga login (bearer key, and the refresh key when given) stays on this computer in
// data/taiga.json (git-ignored). Agents never see it.
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";

const BASE = (process.env.TAIGA_URL || "https://projects.digitaltelkom.id").replace(/\/+$/, "");
const PROJECT = process.env.TAIGA_PROJECT || "DRH";
const STORY = Number(process.env.TAIGA_STORY || 2467);
const FILE = join(process.cwd(), "data", "taiga.json");

export type Activity = { title: string; date: string; start: string; minutes: number; training: boolean };
type Logged = { key: string; ref: number; url: string; at: string };
type Store = {
  access?: string; refresh?: string; exp?: number;
  user?: { id: number; name: string };
  project?: { id: number; slug: string; name: string };
  story?: { id: number; ref: number; subject: string };
  done?: number; attrs?: { id: number; name: string; type: string }[];
  logged?: Logged[];
};

const read = (): Store => { try { return JSON.parse(readFileSync(FILE, "utf8")); } catch { return {}; } };
function write(s: Store) {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(s, null, 2));
  try { chmodSync(FILE, 0o600); } catch { /* ignore */ }
}

/** The JWT payload (no signature check; Taiga checks it). */
function claims(t: string): { exp?: number; token_type?: string } | null {
  const p = t.split(".");
  if (p.length !== 3) return null;
  try { return JSON.parse(Buffer.from(p[1], "base64url").toString("utf8")); } catch { return null; }
}

/** One stable key per activity, so the card knows it was already logged. */
export const activityKey = (a: Activity) =>
  createHash("sha1").update([a.title.trim().toLowerCase(), a.date, a.start].join("|")).digest("hex").slice(0, 16);

class TaigaError extends Error { constructor(m: string, public login = false) { super(m); } }

async function raw(method: string, path: string, token: string | undefined, body?: unknown) {
  const r = await fetch(BASE + "/api/v1" + path, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const text = await r.text();
  let j: unknown = null; try { j = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { ok: r.ok, status: r.status, j, text };
}

/** A valid bearer key: refreshes it with the refresh key when it ran out. */
async function access(s: Store): Promise<string> {
  const soon = (s.exp ?? Infinity) * 1000 - Date.now() < 60_000;
  if (s.access && !soon) return s.access;
  if (s.refresh) {
    const r = await raw("POST", "/auth/refresh", undefined, { refresh: s.refresh });
    const j = r.j as { auth_token?: string; refresh?: string } | null;
    if (r.ok && j?.auth_token) {
      s.access = j.auth_token; s.refresh = j.refresh ?? s.refresh; s.exp = claims(j.auth_token)?.exp;
      write(s);
      return s.access;
    }
  }
  throw new TaigaError(s.access ? "Your Taiga key has expired. Paste a new one to continue." : "Connect Taiga first.", true);
}

async function api<T>(s: Store, method: string, path: string, body?: unknown): Promise<T> {
  let r = await raw(method, path, await access(s), body);
  if (r.status === 401 && s.refresh) { s.exp = 0; r = await raw(method, path, await access(s), body); }
  if (r.status === 401) throw new TaigaError("Taiga didn't accept the key (it may have expired). Paste a new one.", true);
  if (!r.ok) {
    const m = (r.j as { _error_message?: string; detail?: string } | null);
    throw new TaigaError(`Taiga said: ${m?._error_message || m?.detail || r.text.slice(0, 200) || r.status}`);
  }
  return r.j as T;
}

/** Look up the user, project, user story, Done status and custom fields once, and keep them. */
async function setup(s: Store, force = false) {
  if (!force && s.user && s.project && s.story && s.done && s.attrs) return;
  const u = await api<{ id: number; full_name_display?: string; username: string }>(s, "GET", "/users/me");
  s.user = { id: u.id, name: u.full_name_display || u.username };
  let p: { id: number; slug: string; name: string } | null = null;
  for (const slug of [PROJECT, PROJECT.toLowerCase()]) {
    try { p = await api(s, "GET", `/projects/by_slug?slug=${encodeURIComponent(slug)}`); break; } catch (e) { if ((e as TaigaError).login) throw e; }
  }
  if (!p) throw new TaigaError(`Couldn't find the Taiga project "${PROJECT}". Check that your account can open it.`);
  s.project = { id: p.id, slug: p.slug, name: p.name };
  const us = await api<{ id: number; ref: number; subject: string }>(s, "GET", `/userstories/by_ref?ref=${STORY}&project=${p.id}`);
  s.story = { id: us.id, ref: us.ref, subject: us.subject };
  const st = await api<{ id: number; name: string; is_closed: boolean }[]>(s, "GET", `/task-statuses?project=${p.id}`);
  s.done = (st.find(x => /^done$/i.test(x.name.trim())) ?? st.find(x => x.is_closed) ?? st[st.length - 1])?.id;
  s.attrs = (await api<{ id: number; name: string; type: string }[]>(s, "GET", `/task-custom-attributes?project=${p.id}`))
    .map(a => ({ id: a.id, name: a.name, type: a.type }));
  write(s);
}

export type Status = {
  connected: boolean; expires?: string; autoRenew: boolean;
  user?: string; story?: string; storyUrl?: string;
  logged: Record<string, { ref: number; url: string }>;
};
export function status(): Status {
  const s = read();
  const alive = !!s.access && (!!s.refresh || (s.exp ?? Infinity) * 1000 > Date.now());
  return {
    connected: alive,
    expires: s.exp && !s.refresh ? new Date(s.exp * 1000).toISOString() : undefined,
    autoRenew: !!s.refresh,
    user: s.user?.name,
    story: s.story ? `#${s.story.ref} ${s.story.subject}` : undefined,
    storyUrl: s.project && s.story ? `${BASE}/project/${s.project.slug}/us/${s.story.ref}` : undefined,
    logged: Object.fromEntries((s.logged ?? []).map(l => [l.key, { ref: l.ref, url: l.url }])),
  };
}

/** Save the key(s) the member pasted. Accepts a bare key, or anything copied from Taiga's storage. */
export async function saveKeys(text: string) {
  const jwts = text.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g) ?? [];
  let acc = jwts.find(t => claims(t)?.token_type === "access") ?? jwts.find(t => claims(t)?.token_type !== "refresh");
  const ref = jwts.find(t => claims(t)?.token_type === "refresh");
  if (!acc && !ref) {
    const plain = text.trim().replace(/^bearer\s+/i, "").replace(/^["']|["']$/g, "");
    if (!plain || /\s/.test(plain)) throw new TaigaError("That doesn't look like a Taiga key. Copy it again with the steps on the card.");
    acc = plain;
  }
  const prev = read();
  const s: Store = { logged: prev.logged, access: acc, refresh: ref, exp: acc ? claims(acc)?.exp : 0 };
  await setup(s, true);
  return status();
}

export function forget() { const s = read(); write({ logged: s.logged }); return status(); }

const cut = (s: string, n: number) => s.trim().slice(0, n);

/** Create one Done task for each activity under the user story and fill its custom fields. */
export async function logActivities(list: Activity[]) {
  const s = read();
  await setup(s);
  const out: { key: string; ref?: number; url?: string; error?: string }[] = [];
  for (const a of list) {
    const key = activityKey(a);
    const had = s.logged?.find(l => l.key === key);
    if (had) { out.push({ key, ref: had.ref, url: had.url }); continue; }
    try {
      if (!a.title.trim()) throw new TaigaError("The activity needs a title.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date)) throw new TaigaError("The date should look like 2026-11-16.");
      const t = await api<{ id: number; ref: number; version: number }>(s, "POST", "/tasks", {
        project: s.project!.id, user_story: s.story!.id, subject: cut(a.title, 500), status: s.done, assigned_to: s.user!.id,
      });
      const values: Record<string, unknown> = {};
      for (const at of s.attrs ?? []) {
        const n = at.name.toLowerCase();
        const v = /training/.test(n) ? a.training
          : /date/.test(n) ? a.date
          : /start/.test(n) ? a.start
          : /time spent|duration|minutes|durasi/.test(n) ? a.minutes
          : undefined;
        if (v === undefined || v === "") continue;
        values[String(at.id)] = at.type === "checkbox" ? !!v : at.type === "number" ? Number(v) : typeof v === "boolean" ? v : String(v);
      }
      if (Object.keys(values).length) {
        const cur = await api<{ version: number }>(s, "GET", `/tasks/custom-attributes-values/${t.id}`);
        await api(s, "PATCH", `/tasks/custom-attributes-values/${t.id}`, { attributes_values: values, version: cur.version });
      }
      const url = `${BASE}/project/${s.project!.slug}/task/${t.ref}`;
      s.logged = [...(s.logged ?? []), { key, ref: t.ref, url, at: new Date().toISOString() }].slice(-500);
      write(s);
      out.push({ key, ref: t.ref, url });
    } catch (e) {
      if ((e as TaigaError).login) throw e;
      out.push({ key, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { results: out, status: status() };
}

export const isLoginError = (e: unknown) => e instanceof TaigaError && e.login;

/** Instructions added to every agent so they can draft the member's Taiga daily activities. */
export const TAIGA_MARKER = "## Kantor Virtual Taiga activities";
const F = "```";
export const AGENT_TAIGA = `
${TAIGA_MARKER}
The member logs their daily work activities in Taiga. When they ask you to log, record or submit their activities ("catat aktivitas ke Taiga", "isi daily activity"), write them in one block, one activity per line:

${F}taiga
YYYY-MM-DD | HH:MM | minutes | [CATEGORY] What was done
YYYY-MM-DD | HH:MM | minutes | training | [Learning] A training activity
${F}

- Date, start time (24-hour, ${process.env.KANTOR_TIMEZONE || "Asia/Jakarta"}), time spent in minutes, then the title. Add \`training\` only for training or learning activities.
- Titles follow the member's style: a short [CATEGORY] tag such as [OPS], [RH Playbook], [TalentOps], then what was done, in the member's language.
- Use what the member told you, their calendar and today's tasks. If a start time or duration is unknown, make a sensible guess and say so outside the block.
- Virtual Office shows the block as a card. The member checks it and presses "Log to Taiga"; the app then creates the tasks. You can't log to Taiga yourself and never ask for their Taiga key or password.`;
