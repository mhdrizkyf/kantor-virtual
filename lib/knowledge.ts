// Knowledge & files: one folder per agent inside the OneDrive folder that is synced to this laptop.
//   OneDrive/Kantor Virtual/<Workspace>/<Agent>/Knowledge   reference material the agent reads (also: Multica skills, copied once)
//   OneDrive/Kantor Virtual/<Workspace>/<Agent>/Outputs     files the agent attached to tasks, copied automatically
//   OneDrive/Kantor Virtual/<Workspace>/Shared/Knowledge    material for every agent in that workspace
// Existing OneDrive folders (e.g. Documents/RH) can be linked to an agent, or to Shared, so it reads them too.
// Agents run on this laptop (Multica Desktop), so they read these folders directly; people edit them in OneDrive as usual.
// All paths below are relative to the OneDrive root.
import "server-only";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, renameSync, utimesSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep, dirname } from "node:path";
import { workspaces, loadDirectory, allIssues, issueDetail, fileRaw, call_, updateAgent, isHiddenIssue, type Agent, type Workspace } from "./multica";
import { readJsonFile, writeJsonAtomic } from "./json-store";
import { withProcessLock } from "./process-lock";

export const FILES_MARKER = "## Kantor Virtual files";
/** Top folder inside OneDrive. A second install (e.g. a demo server) can use its own with KANTOR_FILES_FOLDER. */
const KV = process.env.KANTOR_FILES_FOLDER?.trim() || "Kantor Virtual";

/** The OneDrive folder synced to this Mac (KANTOR_ONEDRIVE overrides it). */
export function filesRoot(): string | null {
  if (process.env.KANTOR_ONEDRIVE) return process.env.KANTOR_ONEDRIVE;
  const cloud = join(homedir(), "Library", "CloudStorage");
  if (!existsSync(cloud)) return null;
  const od = readdirSync(cloud).filter(d => d.startsWith("OneDrive")).sort((a, b) => (b.includes("-") ? 1 : 0) - (a.includes("-") ? 1 : 0))[0];
  return od ? join(cloud, od) : null;
}

/** Folder name without emoji or characters OneDrive doesn't allow. */
export const clean = (s: string) =>
  s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/[\\/:*?"<>|#%]/g, "-").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "") || "Untitled";

export const sharedFolder = (wsName: string) => join(KV, clean(wsName), "Shared");
const sharedKey = (wsId: string) => `shared:${wsId}`;

const META = () => join(process.cwd(), "data", "files-sync.json");
type Meta = {
  agents: Record<string, string>; ws: Record<string, string>; copied: Record<string, string>; skills: Record<string, string>;
  links: Record<string, string[]>; lastSync?: string; lastResult?: string; v?: number;
};
function readMeta(): Meta {
  const raw = readJsonFile<Partial<Meta>>(META(), () => ({}), { tolerateInvalid: true });
  const m: Meta = { agents: {}, ws: {}, copied: {}, skills: {}, links: {}, ...raw };
  // v1 stored paths relative to "Kantor Virtual"; now they are relative to the OneDrive root.
  if (!m.v) {
    const fix = (r: Record<string, string>) => { for (const k in r) if (!r[k].startsWith(KV + sep)) r[k] = join(KV, r[k]); };
    fix(m.agents); fix(m.copied); fix(m.skills); m.v = 2;
  }
  return m;
}
function writeMeta(m: Meta) { writeJsonAtomic(META(), m); }

/** Agents that run on this laptop can read the folders; others (another person's laptop) can't. */
function localDaemon(): string | null {
  try { return readFileSync(join(homedir(), ".multica", "daemon.id"), "utf8").trim(); } catch { return null; }
}

/** The agent's folder. Kept stable when the agent is renamed. */
function agentFolder(m: Meta, ws: Workspace, a: Agent) {
  m.ws[a.id] = ws.id;
  return (m.agents[a.id] ??= join(KV, clean(ws.name), clean(a.name)));
}

export function freeName(dir: string, name: string) {
  if (!existsSync(join(dir, name))) return name;
  const dot = name.lastIndexOf("."); const base = dot > 0 ? name.slice(0, dot) : name; const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 2; ; i++) if (!existsSync(join(dir, `${base} (${i})${ext}`))) return `${base} (${i})${ext}`;
}

function filesBlock(root: string, rel: string, shared: string, linked: string[]) {
  const q = (p: string) => `\`${join(root, p)}\``;
  return `${FILES_MARKER}
Your files live in OneDrive folders on this laptop. People edit them there too, so these folders are the most up-to-date source.
- Your knowledge: ${q(join(rel, "Knowledge"))}
- Shared with the whole workspace: ${q(join(shared, "Knowledge"))}
${linked.map(l => `- Also yours to read (an existing OneDrive folder): ${q(l)}`).join("\n")}${linked.length ? "\n" : ""}- Your outputs: ${q(join(rel, "Outputs"))}

Before you start a task, look at the file names in these knowledge folders (and their subfolders) and read the files that are relevant (Word, Excel, PowerPoint, PDF and text files are all fine). If a file there disagrees with an older knowledge skill, the file wins.
Files you attach to a task or comment are copied into your Outputs folder automatically, so keep attaching your deliverables as usual. Don't change or delete files in the knowledge folders unless the person asks you to.`;
}

/** Put the agent's current folder list into its instructions (only if it changed). */
async function writeBlock(root: string, m: Meta, wsId: string, wsName: string, a: Agent & { instructions?: string | null }) {
  const rel = m.agents[a.id];
  const linked = [...(m.links[a.id] ?? []), ...(m.links[sharedKey(wsId)] ?? [])];
  const want = filesBlock(root, rel, sharedFolder(wsName), [...new Set(linked)]);
  const cur = a.instructions ?? "";
  const at = cur.indexOf(FILES_MARKER);
  let next = cur;
  if (at < 0) next = cur.trimEnd() + "\n\n" + want;
  else {
    const after = cur.indexOf("\n## Kantor Virtual", at + FILES_MARKER.length);
    if (cur.slice(at, after < 0 ? cur.length : after).trim() !== want) next = cur.slice(0, at) + want + (after < 0 ? "" : "\n" + cur.slice(after + 1));
  }
  if (next === cur) return false;
  await updateAgent(wsId, a.id, { instructions: next });
  return true;
}

type FullAgent = Agent & { instructions?: string | null; skills?: { id: string; name: string }[] };
type SkillFull = { id: string; name: string; content?: string; files?: { path: string; content: string }[] };

/** Make the folders, copy knowledge skills in once, and give each local agent its folder paths. */
export async function setupFolders(log: string[] = [], only?: string) {
  const root = filesRoot();
  if (!root) throw new Error("No OneDrive folder found on this Mac. Open OneDrive and sign in first.");
  const m = readMeta();
  const daemon = localDaemon();
  for (const ws of await workspaces()) {
    if (only && ws.id !== only) continue;
    const dir = await loadDirectory(ws.id);
    const localRt = new Set(dir.runtimes.filter(r => (r as { daemon_id?: string }).daemon_id === daemon).map(r => r.id));
    const shared = sharedFolder(ws.name);
    for (const sub of ["Knowledge", "Outputs"]) mkdirSync(join(root, shared, sub), { recursive: true });
    const agentsFull = await Promise.all(dir.agents.map(a => call_<FullAgent>("GET", `/api/agents/${a.id}`, ws.id)));
    const users = new Map<string, string[]>();
    for (const a of agentsFull) for (const s of a.skills ?? []) users.set(s.id, [...(users.get(s.id) ?? []), a.id]);
    for (const a of agentsFull) {
      const rel = agentFolder(m, ws, a);
      for (const sub of ["Knowledge", "Outputs"]) mkdirSync(join(root, rel, sub), { recursive: true });
      if (!localRt.has(a.runtime_id)) { log.push(`${ws.name} · ${a.name}: folder made (runs on another laptop, so it can't read it)`); continue; }
      if (await writeBlock(root, m, ws.id, ws.name, a)) log.push(`${ws.name} · ${a.name}: folder list updated`);
    }
    // Copy every knowledge skill into a .md file once (a skill used by several agents goes to Shared). It is never overwritten.
    for (const [sid, who] of users) {
      if (m.skills[sid]) continue;
      const s = await call_<SkillFull>("GET", `/api/skills/${sid}`, ws.id).catch(() => null);
      if (!s) continue;
      const base = who.length > 1 ? shared : m.agents[who[0]];
      const kdir = join(root, base, "Knowledge");
      const name = freeName(kdir, `${clean(s.name)}.md`);
      writeFileSync(join(kdir, name), (s.content ?? "").replace(/^---\n[\s\S]*?\n---\n/, "").trim() + "\n");
      for (const f of s.files ?? []) {
        const p = resolve(kdir, clean(s.name), f.path);
        if (!p.startsWith(kdir + sep)) continue;
        mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, f.content ?? "");
      }
      m.skills[sid] = join(base, "Knowledge", name);
      log.push(`${ws.name}: copied knowledge "${s.name}" to ${m.skills[sid]}`);
    }
  }
  writeMeta(m);
  return log;
}

/** Link or unlink an existing OneDrive folder to an agent (or "shared:<wsId>"), then update the agents' instructions. */
export async function setLink(key: string, path: string, on: boolean) {
  const { root, p } = safePath(path);
  if (on && (!existsSync(p) || !statSync(p).isDirectory())) throw new Error("That folder doesn't exist.");
  const rel = relative(root, p);
  if (!rel) throw new Error("Pick a folder inside OneDrive, not OneDrive itself.");
  const { wsId, links } = await withProcessLock("files-sync", async () => {
    const m = readMeta();
    const cur = new Set(m.links[key] ?? []);
    if (on) cur.add(rel); else cur.delete(rel);
    m.links[key] = [...cur];
    writeMeta(m);
    return { wsId: key.startsWith("shared:") ? key.slice(7) : m.ws[key], links: m.links[key] };
  });
  if (wsId) await setupFolders([], wsId);
  return links;
}

let running: Promise<string> | null = null;
/** Copy files agents attached to tasks into their Outputs folder (only tasks changed since the last run). */
export function syncOutputs(): Promise<string> {
  running ??= doSync().finally(() => { running = null; });
  return running;
}
async function doSync() {
  const root = filesRoot();
  if (!root) return "No OneDrive folder on this Mac.";
  if (!Object.keys(readMeta().agents).length) await setupFolders();
  const m = readMeta();
  const since = m.lastSync ? Date.parse(m.lastSync) - 10 * 60000 : 0;
  const started = new Date().toISOString();
  let n = 0;
  for (const ws of await workspaces()) {
    const issues = (await allIssues(ws.id)).filter(i => !isHiddenIssue(i) && Date.parse(i.updated_at) >= since);
    for (const i of issues) {
      const d = await issueDetail(i.id, ws.id).catch(() => null);
      if (!d) continue;
      const all = [...d.attachments, ...d.comments.filter(c => !c.deleted_at).flatMap(c => c.attachments ?? [])];
      for (const a of all) {
        if (m.copied[a.id] || a.uploader_type !== "agent" || !a.uploader_id || !m.agents[a.uploader_id]) continue;
        const day = (i.created_at ?? a.created_at ?? started).slice(0, 10);
        const dir = join(root, m.agents[a.uploader_id], "Outputs", clean(`${day} ${i.title}`.slice(0, 90)));
        const res = await fileRaw(ws.id, a.id).catch(() => null);
        if (!res?.ok) continue;
        mkdirSync(dir, { recursive: true });
        const name = freeName(dir, clean(a.filename));
        const tmp = join(dir, `.${name}.part`);
        writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
        renameSync(tmp, join(dir, name));
        const made = new Date(a.created_at ?? i.updated_at);
        if (Number.isFinite(made.getTime())) utimesSync(join(dir, name), made, made);
        m.copied[a.id] = relative(root, join(dir, name));
        n++;
      }
    }
  }
  // Links and new agents may have changed meanwhile: only update what this run owns.
  return withProcessLock("files-sync", async () => {
    const fresh = readMeta();
    fresh.copied = { ...fresh.copied, ...m.copied };
    fresh.lastSync = started;
    fresh.lastResult = n ? `Copied ${n} new file${n === 1 ? "" : "s"}.` : "Up to date.";
    writeMeta(fresh);
    return fresh.lastResult;
  });
}

// ---- Browsing (for the Knowledge page) ----
export type Entry = { name: string; path: string; dir: boolean; size: number; modified: string; count?: number };

/** Resolve a path inside OneDrive; anything outside it is refused. */
export function safePath(rel: string) {
  const root = filesRoot();
  if (!root) throw new Error("No OneDrive folder on this Mac.");
  const p = resolve(root, rel || ".");
  if (p !== root && !p.startsWith(root + sep)) throw new Error("Not allowed.");
  return { root, p };
}

const hidden = (n: string) => n.startsWith(".") || n.startsWith("~$") || n === "Icon\r";
export function list(rel: string): Entry[] {
  const { root, p } = safePath(rel);
  if (!existsSync(p)) return [];
  return readdirSync(p)
    .filter(n => !hidden(n))
    .map(n => {
      const full = join(p, n); const s = statSync(full);
      return { name: n, path: relative(root, full), dir: s.isDirectory(), size: s.size, modified: s.mtime.toISOString(), count: s.isDirectory() ? readdirSync(full).filter(x => !hidden(x)).length : undefined };
    })
    .sort((a, b) => (a.dir === b.dir ? (a.dir ? a.name.localeCompare(b.name) : b.modified.localeCompare(a.modified)) : a.dir ? -1 : 1));
}

export function syncInfo() {
  const m = readMeta();
  return { root: filesRoot(), top: KV, lastSync: m.lastSync ?? null, lastResult: m.lastResult ?? null, agents: m.agents, links: m.links };
}
export { sharedKey };
