// Mengubah data Multica menjadi "kantor": ruangan, meja, status worker, dan daftar yang perlu perhatian.
import type { Snapshot, Issue, Run, Agent } from "./multica";
import { friendlyTitle } from "./titles";
import { quotaStates, fmtTime } from "./quota";
import { readCodexQuota, type CodexQuota } from "./codex-quota";
import { readCharacters, memberCharacterKey } from "./characters";
import { assignUniqueFaces, defaultFace } from "./character-presets";
import { readSquads } from "./squads";
import { readWorkCalendar } from "./work-calendar";
import type { WorkCalendar } from "./office-time";
import type { OfficeSchedule } from "./office-schedule";
import { normalizeSchedule } from "./office-schedule";
import { suggestedSquad } from "./squad-plan";

export type Due = "late" | "risk" | "done" | null; // done = lewat tenggat, tapi worker sudah menyelesaikan bagiannya
export type TaskView = {
  id: string; key: string; title: string; status: string; statusLabel: string; due: string | null; dueFlag: Due;
  dueText: string | null; url: string; ws: string; wsName: string; assignee: string | null; assigneeId: string | null; assigneeType: "agent" | "member" | null; project: string | null; projectId: string | null;
  summary?: string[]; questionCount?: number;
};
export type DeskState = "working" | "failed" | "review" | "ready" | "home" | "off" | "closed" | "break";
export type Desk = {
  agentId: string; name: string; emoji: string | null; avatar: string | null; face: string | null; description: string;
  runtime: string; runtimeId: string | null; squad: string; state: DeskState; bubble: string; reviewCount: number; lateCount: number; riskCount: number; tasks: TaskView[];
};
export type Room = { id: string; name: string; icon: string | null; progress: string | null; desks: Desk[] };
export type RunView = { id: string; issueId: string | null; ws: string; agent: string; status: string; when: string; error: string | null; issueTitle: string | null; url: string | null; kind?: "task" | "chat"; runCount?: number };
export type Office = {
  workspace: string; workspaceId: string; workspaceSlug: string; today: string; updatedAt: string; timeZone: string; open: boolean;
  workCalendar?: WorkCalendar;
  schedule?: OfficeSchedule;
  autoHealStuck?: boolean;
  switchOpen: boolean; parked: number; changedBy: string | null;
  alerts: string[];
  seen: Record<string, string>;
  runtimes: { id: string; name: string; owner: string | null; provider: string; online: boolean; lastSeen: string; quotaReset: string | null; quotaOut: boolean }[];
  codexQuota?: CodexQuota;
  rooms: Room[]; idleDesks: Desk[];
  attention: { overdue: TaskView[]; human: TaskView[]; review: TaskView[]; failed: RunView[] };
  openTasks: TaskView[];
  people: string[];
  agentsDetail: Record<string, { runs: RunView[]; tasks: TaskView[] }>;
  projects: { id: string; name: string; icon: string | null }[];
  members: { id: string; name: string; face: string | null }[];
};

const CLOSED = new Set(["done", "cancelled", "canceled", "completed", "duplicate"]);
const isClosed = (i: Issue) => CLOSED.has(i.status) || CLOSED.has(String(i.status_category || ""));
const ACTIVE_RUN = new Set(["queued", "dispatched", "running", "in_progress", "preparing", "started"]);
const STATUS_LABEL: Record<string, string> = {
  backlog: "Backlog", todo: "Ready", in_progress: "In progress", in_review: "Needs review", done: "Done", cancelled: "Cancelled",
};

function todayIn(tz: string, offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const fmtDate = (s: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(s + "T00:00:00"));

function relTime(iso: string, tz: string) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

const emojiOf = (a: Agent) => (a.avatar_url?.startsWith("emoji:") ? a.avatar_url.slice(6) : null);
const imgOf = (a: Agent) => (a.avatar_url && /^https?:/.test(a.avatar_url) ? a.avatar_url : null);

function shortError(e: string | null) {
  if (!e) return "unknown reason";
  if (/oauth|authenticat|login/i.test(e)) return "Claude/GPT login on the laptop expired";
  if (/rate|limit|quota|usage/i.test(e)) { const m = e.match(/resets?\s+([^()]+?)\s*(\(|$)/i); return `AI quota used up${m ? ` · resets ${m[1].trim()}` : ""} · resumes automatically`; }
  if (/offline|heartbeat/i.test(e)) return "laptop went off mid-task";
  return e.length > 60 ? e.slice(0, 57) + "…" : e;
}

/** Peringatan kalau login Claude/GPT di laptop kedaluwarsa (run terakhir di runtime aktif itu gagal karena login). */
function loginAlerts(s: Snapshot): string[] {
  const out: string[] = [];
  for (const rt of s.runtimes) {
    if (rt.status !== "online" || !s.agents.some(a => a.runtime_id === rt.id)) continue;
    const last = s.runs.filter(r => r.runtime_id === rt.id).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
    if (last?.status === "failed" && /oauth|authenticat|login/i.test(last.error ?? "")) {
      const who = rt.provider === "claude" ? "Claude" : rt.provider === "codex" ? "ChatGPT (Codex)" : rt.provider;
      const cmd = rt.provider === "claude" ? "claude auth login" : rt.provider === "codex" ? "codex login" : "";
      out.push(`The ${who} login on this laptop expired, so ${who} agents can't work.${cmd ? ` To fix it: open Terminal, type  ${cmd}  and follow the steps.` : ""} Then press "Retry" in the Failed list.`);
    }
  }
  return out;
}

export function buildOffice(s: Snapshot): Office {
  const characters = readCharacters(s.workspace.id);
  const assignedFaces = assignUniqueFaces(
    [...s.agents.map(a => a.id), ...s.members.map(m => memberCharacterKey(m.user_id))],
    characters
  );
  const squads = readSquads(s.workspace.id);
  const tz = process.env.KANTOR_TIMEZONE || "Asia/Jakarta";
  const today = todayIn(tz);
  const memberName = (id: string | null) => s.members.find(m => m.id === id || m.user_id === id)?.name ?? "Member";
  const agentById = new Map(s.agents.map(a => [a.id, a]));
  const issueById = new Map(s.issues.map(i => [i.id, i]));
  const projectById = new Map(s.projects.map(p => [p.id, p]));
  const runtimeById = new Map(s.runtimes.map(r => [r.id, r]));
  const url = (i: Issue) => `${process.env.MULTICA_APP_URL || "https://multica.ai"}/${s.workspace.slug}/issues/${i.identifier}`;

  const open = s.issues.filter(i => !isClosed(i));
  // Agent asked a question and is waiting for the member's answer (task left "in progress").
  const asking: Set<string> = s.asking ?? new Set();
  const switchOpen = s.kantor.open !== false;
  const quota = new Map(quotaStates(s).map(q => [q.runtimeId, q]));

  // Run terakhir per task, dan task yang sedang dikerjakan/antre.
  const latestByIssue = new Map<string, Run>();
  const activeIssues = new Set<string>();
  for (const r of s.runs) {
    if (!r.issue_id) continue;
    if (ACTIVE_RUN.has(r.status)) activeIssues.add(r.issue_id);
    const cur = latestByIssue.get(r.issue_id);
    if (!cur || Date.parse(r.created_at) > Date.parse(cur.created_at)) latestByIssue.set(r.issue_id, r);
  }
  // Worker sudah menyelesaikan bagiannya: hasil dikirim untuk review, atau run terakhirnya selesai
  // dan tidak ada yang sedang berjalan. Task seperti ini tidak lagi ditandai merah/oranye.
  const workerFinished = (i: Issue) => i.assignee_type === "agent" && (i.status === "in_review" ||
    (["todo", "in_progress"].includes(i.status) && !activeIssues.has(i.id) && latestByIssue.get(i.id)?.status === "completed"));

  const view = (i: Issue): TaskView => {
    let dueFlag: Due = null, dueText: string | null = null;
    if (i.due_date) {
      const d = daysBetween(today, i.due_date);
      const notStarted = i.status === "backlog" || i.status === "todo";
      const finished = workerFinished(i);
      if (finished && d < 0) { dueFlag = "done"; dueText = `Done, ${-d}d late` + (i.status === "in_review" ? " · awaiting review" : ""); }
      else if (finished && d <= 2) dueText = `${fmtDate(i.due_date)} · done` + (i.status === "in_review" ? ", awaiting review" : "");
      else if (d < 0) { dueFlag = "late"; dueText = `${-d}d late`; }
      else if (d <= 2) {
        dueFlag = "risk";
        dueText = (d === 0 ? "Due today" : d === 1 ? "Due tomorrow" : `Due ${fmtDate(i.due_date)}`) +
          (i.status === "in_review" ? " · awaiting review" : i.assignee_type === "member" ? " · waiting on a person" : notStarted ? " · not started" : "");
      } else dueText = fmtDate(i.due_date);
    }
    const assignee = i.assignee_type === "agent" ? agentById.get(i.assignee_id || "")?.name ?? "Agent"
      : i.assignee_type === "member" ? memberName(i.assignee_id) : null;
    const hint = (s as Partial<Snapshot>).digests?.[i.id];
    return {
      id: i.id, key: i.identifier, title: friendlyTitle(i), status: i.status,
      statusLabel: i.status === "backlog" && (i.metadata ?? {}).kantor_parked ? "Waiting for office to open" : asking.has(i.id) ? "Waiting for your answer" : i.status_name || STATUS_LABEL[i.status] || i.status,
      due: i.due_date, dueFlag, dueText, url: url(i), ws: s.workspace.id, wsName: s.workspace.name, assignee, assigneeId: i.assignee_id ?? null, assigneeType: i.assignee_type,
      project: i.project_id ? projectById.get(i.project_id)?.title ?? null : null,
      projectId: i.project_id ?? null,
      ...(hint?.summary?.length ? { summary: hint.summary } : {}),
      ...(hint?.questionCount ? { questionCount: hint.questionCount } : {}),
    };
  };

  const runView = (r: Run): RunView => {
    const iss = r.issue_id ? issueById.get(r.issue_id) : undefined;
    return {
      id: r.id,
      ws: s.workspace.id,
      agent: agentById.get(r.agent_id)?.name ?? "Agent",
      status: r.status,
      when: relTime(r.completed_at || r.started_at || r.created_at, tz),
      error: r.status === "failed" ? shortError(r.error) : null,
      issueTitle: iss ? friendlyTitle(iss) : null,
      issueId: iss?.id ?? r.issue_id ?? null,
      url: iss ? url(iss) : null,
      kind: r.issue_id ? "task" : "chat",
    };
  };

  const runsByAgent = new Map<string, Run[]>();
  for (const r of [...s.runs].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))) {
    const arr = runsByAgent.get(r.agent_id) ?? []; arr.push(r); runsByAgent.set(r.agent_id, arr);
  }

  // Status worker (global), dihitung dari runtime, run terakhir, dan antrean issue.
  // Multica memakai antrean Run yang sama untuk pekerjaan task (issue_id != null) dan balasan chat (issue_id == null);
  // keduanya dipisahkan di sini supaya obrolan tidak tampil sebagai "Task" atau membuat meja gagal.
  const deskBase = (a: Agent) => {
    const rt = runtimeById.get(a.runtime_id);
    const online = rt?.status === "online";
    const runs = runsByAgent.get(a.id) ?? [];
    const taskRuns = runs.filter(r => !!r.issue_id);
    const chatRuns = runs.filter(r => !r.issue_id);
    const activeTask = taskRuns.find(r => ACTIVE_RUN.has(r.status));
    const activeChat = chatRuns.find(r => ACTIVE_RUN.has(r.status));
    const active = activeTask ?? activeChat;
    const lastTask = taskRuns[0];
    const mine = open.filter(i => i.assignee_type === "agent" && i.assignee_id === a.id);
    const mineIds = new Set(mine.map(i => i.id));
    const review = mine.filter(i => i.status === "in_review");
    const ready = mine.filter(i => (i.status === "todo" || i.status === "in_progress") && !workerFinished(i));
    const agentBusy = ["working", "running", "busy"].includes(String(a.status || "").toLowerCase());
    // Ignore chat-only failures and stale failures from an old runtime or closed/unassigned issues.
    const recentFail = !!lastTask
      && lastTask.status === "failed"
      && lastTask.runtime_id === a.runtime_id
      && !!lastTask.issue_id
      && mineIds.has(lastTask.issue_id)
      && issueById.get(lastTask.issue_id)?.status !== "in_review"
      && Date.now() - Date.parse(lastTask.created_at) < 86400000 * 3;
    let state: DeskState, bubble: string;
    const parkedMine = mine.filter(i => (i.metadata ?? {}).kantor_parked).length;
    if (!switchOpen && !active && !agentBusy) { state = "closed"; bubble = parkedMine ? `Office closed · ${parkedMine} waiting` : "Office closed"; }
    else if (!online) { state = "off"; bubble = "Laptop off · resumes when on"; }
    else if (!active && !agentBusy && quota.has(a.runtime_id)) {
      const q = quota.get(a.runtime_id)!;
      const past = q.resetAt && Date.parse(q.resetAt) <= Date.now();
      state = "break";
      bubble = q.resetAt ? (past ? "Quota back · resuming soon" : `On a break · quota resets ${fmtTime(new Date(q.resetAt))}`) : "On a break · AI quota used up";
    }
    else if (activeTask) {
      state = "working";
      const ai = activeTask.issue_id ? issueById.get(activeTask.issue_id) : undefined;
      bubble = "Working on: " + (ai ? friendlyTitle(ai) : "a task");
    }
    else if (activeChat) {
      state = "working";
      bubble = "Chatting · membalas pesan…";
    }
    else if (agentBusy) {
      state = "working";
      const inProg = mine.find(i => i.status === "in_progress");
      bubble = inProg ? "Working on: " + friendlyTitle(inProg) : "Chatting · memproses pesan…";
    }
    else if (recentFail) { state = "failed"; bubble = "Failed: " + shortError(lastTask.error); }
    else if (review.length) { state = "review"; bubble = `Waiting for your review (${review.length})`; }
    else if (ready.length) { state = "ready"; bubble = `Ready for ${ready.length} task${ready.length > 1 ? "s" : ""}`; }
    else {
      state = "home";
      const backlog = mine.filter(i => i.status === "backlog").length;
      bubble = backlog ? `Standby · ${backlog} in backlog` : "Standby · ready for tasks";
    }
    return {
      agentId: a.id, name: a.name, emoji: emojiOf(a), avatar: imgOf(a), face: assignedFaces[a.id] ?? defaultFace(a.id), description: a.description || "",
      squad: squads[a.id] ?? suggestedSquad(a.name, a.description || ""),
      runtime: rt ? `${rt.provider === "claude" ? "Claude" : rt.provider === "codex" ? "GPT (Codex)" : rt.provider}${s.runtimes.filter(x => x.provider === rt.provider).length > 1 ? " · " + (s.members.find(m => m.user_id === rt.owner_id || m.id === rt.owner_id)?.name.split(/\s+/)[0] ?? "") : ""}${a.model ? " · " + a.model : ""}${s.moved?.[a.id]?.to === a.runtime_id ? " · temporary 🔁" : ""}` : "No engine",
      runtimeId: a.runtime_id || null,
      state, bubble,
    };
  };

  const order: Record<string, number> = { in_review: 0, in_progress: 1, todo: 2, backlog: 3 };
  const rank = (t: TaskView) => (t.dueFlag === "late" ? 0 : t.dueFlag === "risk" ? 1 : 2);
  const sortTasks = (t: TaskView[]) => t.sort((a, b) =>
    rank(a) - rank(b) ||
    (order[a.status] ?? 9) - (order[b.status] ?? 9) || String(a.due).localeCompare(String(b.due)));

  const makeDesk = (a: Agent, issues: Issue[]): Desk => {
    const tasks = sortTasks(issues.map(view));
    return { ...deskBase(a), tasks, reviewCount: tasks.filter(t => t.status === "in_review").length,
      lateCount: tasks.filter(t => t.dueFlag === "late").length, riskCount: tasks.filter(t => t.dueFlag === "risk").length };
  };

  const agentIssues = open.filter(i => i.assignee_type === "agent" && i.assignee_id);
  // Squad is a stable room assignment, independent of projects and active tasks.
  const roomMap = new Map<string, Room>();
  for (const agent of s.agents) {
    const desk = makeDesk(agent, agentIssues.filter(i => i.assignee_id === agent.id));
    let room = roomMap.get(desk.squad);
    if (!room) { room = { id: `squad:${desk.squad}`, name: desk.squad, icon: null, progress: null, desks: [] }; roomMap.set(desk.squad, room); }
    room.desks.push(desk);
  }
  const rooms = [...roomMap.values()].map(room => ({ ...room, desks: room.desks.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => b.desks.length - a.desks.length || a.name.localeCompare(b.name));
  const idleDesks: Desk[] = [];

  const allViews = open.map(view);
  // Gagal hanya ditampilkan kalau itu kejadian terakhir untuk task tersebut dan task-nya masih terbuka.
  const openIds = new Set(open.map(i => i.id));
  const failed = [...latestByIssue.values()]
    .filter(r => r.status === "failed" && openIds.has(r.issue_id!) && issueById.get(r.issue_id!)?.status !== "in_review"
      && Date.now() - Date.parse(r.created_at) < 86400000 * 7)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 8).map(runView);

  const agentsDetail: Office["agentsDetail"] = {};
  for (const a of s.agents) {
    // Only show real issue/task runs under "Recent task runs" (chat-reply runs stay in Chats),
    // and deduplicate revision rounds per issue_id so each task appears once with its latest status & run count.
    const grouped = new Map<string, { latest: Run; count: number }>();
    for (const r of runsByAgent.get(a.id) ?? []) {
      if (!r.issue_id) continue;
      const hit = grouped.get(r.issue_id);
      if (hit) hit.count++;
      else grouped.set(r.issue_id, { latest: r, count: 1 });
    }
    agentsDetail[a.id] = {
      runs: [...grouped.values()].slice(0, 6).map(({ latest, count }) => ({ ...runView(latest), runCount: count })),
      tasks: sortTasks(agentIssues.filter(i => i.assignee_id === a.id).map(view)),
    };
  }

  const runtimesList = s.runtimes.map(r => {
    const q = quota.get(r.id);
    // Beberapa laptop bisa punya mesin yang sama (mis. Claude milik Ara dan milik Dan): tampilkan nama pemiliknya.
    const ownerName = s.members.find(m => m.user_id === r.owner_id || m.id === r.owner_id)?.name.split(/\s+/)[0] ?? null;
    const shared = s.runtimes.filter(x => x.provider === r.provider).length > 1;
    return {
      id: r.id, owner: shared ? ownerName : null, name: r.provider === "claude" ? "Claude" : r.provider === "codex" ? "GPT (Codex)" : r.name, provider: r.provider, online: r.status === "online", lastSeen: relTime(r.last_seen_at, tz),
      quotaOut: !!q, quotaReset: q?.resetAt ? fmtTime(new Date(q.resetAt)) : null,
    };
  }).sort((a, b) => String(a.owner).localeCompare(String(b.owner)) || a.provider.localeCompare(b.provider));

  const codexQuota = readCodexQuota({ runtimes: runtimesList, timeZone: tz });

  return {
    workspace: s.workspace.name, workspaceId: s.workspace.id, workspaceSlug: s.workspace.slug, timeZone: tz,
    workCalendar: readWorkCalendar(s.workspace.id),
    schedule: normalizeSchedule(s.kantor.schedule),
    autoHealStuck: !!s.kantor.autoHealStuck,
    today: new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date()),
    updatedAt: new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date()),
    open: s.runtimes.some(r => r.status === "online"),
    switchOpen, parked: s.issues.filter(i => (i.metadata ?? {}).kantor_parked && i.status === "backlog").length,
    changedBy: s.kantor.changedBy ?? null,
    alerts: loginAlerts(s),
    seen: s.seen ?? {},
    runtimes: runtimesList,
    codexQuota,
    rooms, idleDesks,
    attention: {
      // Setiap task hanya muncul di satu bagian, supaya daftar tidak dobel.
      human: sortTasks(allViews.filter(t => t.assigneeType === "member")),
      review: sortTasks(allViews.filter(t => (t.status === "in_review" || asking.has(t.id)) && t.assigneeType !== "member")),
      overdue: sortTasks(allViews.filter(t => (t.dueFlag === "late" || t.dueFlag === "risk") && t.assigneeType !== "member" && t.status !== "in_review" && !asking.has(t.id))),
      failed,
    },
    openTasks: sortTasks([...allViews]),
    people: [...new Set(s.members.map(m => m.name))],
    projects: s.projects.map(p => ({ id: p.id, name: p.title, icon: p.icon ?? null })),
    members: s.members.map(m => ({ id: m.user_id, name: m.name, face: assignedFaces[memberCharacterKey(m.user_id)] ?? defaultFace(memberCharacterKey(m.user_id)) })),
    agentsDetail,
  };
}
