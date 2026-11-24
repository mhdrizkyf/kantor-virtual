// Penjaga kantor: berjalan berkala (di laptop saat app terbuka, dan di GitHub tiap 30 menit).
// 1. Jadwal buka/tutup kantor otomatis (opsional, mengikuti kalender kerja workspace).
// 2. Task yang gagal karena kuota AI habis dipindahkan ke mesin cadangan atau dijalankan ulang otomatis setelah reset.
// 3. Deteksi stuck run (>= 60 menit) & bounded auto-retry untuk kegagalan transient (offline/timeout/5xx).
// 4. Mengirim notifikasi Telegram: kuota habis, lanjut lagi, stuck run, perlu review,
//    tugas untuk manusia, login AI kedaluwarsa, dan ringkasan pagi (telat & berisiko).
// Catatan "sudah dikirim / sudah diulang" disimpan di pengaturan workspace supaya tidak dobel.
import "server-only";
import { workspaces, loadWorkspace, rerunIssue, cancelRun, updateAgent, updateIssue, saveKantorSettings, call_ as call, type Run, type Moved } from "./multica";
import { isQuotaError, isLoginError, quotaResetAt, fmtTime, quotaStates } from "./quota";
import { friendlyTitle } from "./titles";
import { telegram, telegramReady, botFor } from "./telegram";
import { remindAt, remindNotes, reminderText, fmtWhen, REMIND_META } from "./reminders";
import { ProcessBusyError, withProcessLock } from "./process-lock";
import { closeOffice, openOffice } from "./office-control";
import { evaluateOfficeSchedule, normalizeSchedule } from "./office-schedule";
import { readWorkCalendar } from "./work-calendar";
import { appendActivity } from "./activity-log";
import { emitWorkflowHook } from "./workflow-hooks";

type Memory = {
  sent?: Record<string, string>;
  retried?: Record<string, string>;
  transientRetries?: Record<string, { count: number; lastAt: string }>;
  started?: string;
  moved?: Moved;
};

const ACTIVE = new Set(["queued", "dispatched", "running", "in_progress", "preparing", "started"]);
const RUNNING_ONLY = new Set(["dispatched", "running", "in_progress", "preparing", "started"]);
const MAX_TRANSIENT_RETRIES = 2;
const tz = () => process.env.KANTOR_TIMEZONE || "Asia/Jakarta";
const provName = (p: string) => (p === "claude" ? "Claude" : p === "codex" ? "ChatGPT (Codex)" : p);
const stuckThresholdMin = () => {
  const n = Number(process.env.KANTOR_STUCK_MINUTES);
  return Number.isFinite(n) && n >= 10 ? n : 60;
};

/** Transient errors (network blip, laptop sleep, 5xx, heartbeat loss) eligible for bounded auto-retry. */
export function isTransientError(error?: string | null): boolean {
  if (!error || isQuotaError(error) || isLoginError(error)) return false;
  return /offline|heartbeat|timeout|timed?\s*out|econnreset|etimedout|socket hang up|network|502|503|504|temporarily unavailable/i.test(error);
}

/** Find active runs that have been executing longer than thresholdMinutes without completing. */
export function findStuckRuns(runs: Run[], nowMs = Date.now(), thresholdMinutes = stuckThresholdMin()): { run: Run; minutes: number }[] {
  const out: { run: Run; minutes: number }[] = [];
  for (const r of runs) {
    if (!r.issue_id || !RUNNING_ONLY.has(r.status)) continue;
    const since = Date.parse(r.started_at ?? r.created_at);
    if (!Number.isFinite(since)) continue;
    const minutes = Math.round((nowMs - since) / 60000);
    if (minutes >= thresholdMinutes) out.push({ run: r, minutes });
  }
  return out;
}

async function readMemory(wsId: string): Promise<{ settings: Record<string, unknown>; mem: Memory }> {
  const full = await call<{ settings?: Record<string, unknown> | null }>("GET", `/api/workspaces/${wsId}`, wsId);
  const settings = { ...(full.settings ?? {}) };
  return { settings, mem: (settings.kantor_watch as Memory) ?? {} };
}
async function writeMemory(wsId: string, mem: Memory) {
  // Simpan hanya 7 hari terakhir supaya catatannya tidak membengkak.
  const cutoff = Date.now() - 7 * 86400000;
  const prune = (o: Record<string, string> = {}) => Object.fromEntries(Object.entries(o).filter(([, v]) => Date.parse(v) > cutoff));
  const pruneTransient = (o: Record<string, { count: number; lastAt: string }> = {}) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => Date.parse(v.lastAt) > cutoff));
  // Re-read latest workspace settings immediately before PATCH to avoid clobbering concurrent kantor edits.
  const { settings, mem: latestMem } = await readMemory(wsId);
  settings.kantor_watch = {
    sent: prune({ ...(latestMem.sent ?? {}), ...(mem.sent ?? {}) }),
    retried: prune({ ...(latestMem.retried ?? {}), ...(mem.retried ?? {}) }),
    transientRetries: pruneTransient({ ...(latestMem.transientRetries ?? {}), ...(mem.transientRetries ?? {}) }),
    started: mem.started ?? latestMem.started,
    moved: mem.moved ?? {},
  };
  await call("PATCH", `/api/workspaces/${wsId}`, wsId, { settings });
}

export async function runWatchdog(opts: { notify?: boolean; dryRun?: boolean; now?: Date } = {}) {
  try { return await withProcessLock("watchdog", async () => {
  const dry = !!opts.dryRun;
  const notify = (opts.notify ?? true) && !dry;
  const report: string[] = [];
  const clock = opts.now ?? new Date();
  const now = clock.getTime();

  for (const w of await workspaces()) {
    const s = await loadWorkspace(w.id);
    if (s.kantor.transition && !dry) {
      if (s.kantor.transition.action === "close") await closeOffice(w.id, !!s.kantor.transition.stopRunning, "watchdog");
      else await openOffice(w.id, "watchdog");
      report.push(`kantor ${w.name}: melanjutkan proses ${s.kantor.transition.action}`);
      continue;
    }

    const { mem } = await readMemory(w.id);
    mem.sent ??= {}; mem.retried ??= {}; mem.transientRetries ??= {};
    const tg = { id: w.id, slug: w.slug, name: w.name, members: s.members.map(m => m.name) };
    const canSend = notify && telegramReady(tg);
    const firstRun = canSend && !mem.started;
    if (canSend && !mem.started) mem.started = clock.toISOString();
    const once = async (key: string, text: string, onlyName?: string | null) => {
      if (!canSend || mem.sent![key]) return;
      if (!firstRun || key.startsWith("digest:") || key.startsWith("stuck:") || key.startsWith("schedule:")) {
        const sent = await telegram(text, onlyName, tg);
        if (!sent) return;
      }
      mem.sent![key] = clock.toISOString();
    };

    const open = s.kantor.open !== false;

    // 0) Jadwal buka/tutup kantor otomatis (opsional, dikonfigurasi di Office Controls).
    const schedDecision = evaluateOfficeSchedule(s.kantor.schedule, {
      open,
      timeZone: tz(),
      now: clock,
      calendar: readWorkCalendar(w.id),
    });
    if (schedDecision) {
      if (dry) {
        report.push(`[uji] jadwal kantor ${w.name}: ${schedDecision.action} (${schedDecision.reason})`);
      } else {
        const nextSched = normalizeSchedule(s.kantor.schedule);
        if (schedDecision.action === "open") {
          await openOffice(w.id, "schedule");
          nextSched.lastAutoOpenDate = schedDecision.date;
          await saveKantorSettings(w.id, { ...s.kantor, open: true, schedule: nextSched });
          await once(`schedule:open:${schedDecision.date}`, `🌅 **${w.name}** dibuka otomatis sesuai jadwal (${schedDecision.reason}).`);
          report.push(`jadwal buka: ${w.name}`);
        } else {
          await closeOffice(w.id, schedDecision.stopRunning, "schedule");
          nextSched.lastAutoCloseDate = schedDecision.date;
          await saveKantorSettings(w.id, { ...s.kantor, open: false, schedule: nextSched });
          await once(`schedule:close:${schedDecision.date}`, `🌙 **${w.name}** ditutup otomatis sesuai jadwal (${schedDecision.reason}).`);
          report.push(`jadwal tutup: ${w.name}`);
        }
        await writeMemory(w.id, mem);
        continue;
      }
    }

    const issueById = new Map(s.issues.map(i => [i.id, i]));
    const rtById = new Map(s.runtimes.map(r => [r.id, r]));
    const agentById = new Map(s.agents.map(a => [a.id, a]));
    const latest = new Map<string, Run>();
    for (const r of s.runs) if (r.issue_id && (!latest.has(r.issue_id) || Date.parse(r.created_at) > Date.parse(latest.get(r.issue_id)!.created_at))) latest.set(r.issue_id, r);

    // 1) Kuota habis → pindahkan worker ke mesin AI lain yang masih punya kuota (mis. Claude → GPT),
    //    lalu kembalikan setelah kuota mesin aslinya pulih. Kalau tidak ada mesin cadangan: tunggu reset.
    mem.moved ??= {};
    const quotas = quotaStates(s);
    const outNow = new Set(quotas.filter(q => !q.resetAt || Date.parse(q.resetAt) > now).map(q => q.runtimeId));
    const busy = (agentId: string) => s.runs.some(x => x.agent_id === agentId && ACTIVE.has(x.status));
    const switched: string[] = [];
    for (const q of quotas) {
      if (!outNow.has(q.runtimeId)) continue;
      const src = rtById.get(q.runtimeId);
      const machine = (n?: string) => n?.match(/\(([^)]+)\)\s*$/)?.[1] ?? null;
      const spare = s.runtimes.find(r => r.id !== q.runtimeId && r.provider !== q.provider && r.status === "online" && !outNow.has(r.id)
        && r.owner_id === src?.owner_id && machine(r.name) === machine(src?.name));
      const movers = s.agents.filter(a => a.runtime_id === q.runtimeId && !a.archived_at && !mem.moved![a.id]);
      if (spare && movers.length) {
        for (const a of movers) {
          if (dry) { report.push(`[uji] pindahkan ${a.name}: ${provName(q.provider)} → ${provName(spare.provider)}`); continue; }
          await updateAgent(w.id, a.id, { runtime_id: spare.id, model: "", thinking_level: "" });
          mem.moved![a.id] = { from: q.runtimeId, to: spare.id, at: clock.toISOString(), resetAt: q.resetAt, model: a.model ?? "", thinking: a.thinking_level ?? "" };
          a.runtime_id = spare.id; switched.push(a.name);
        }
        if (switched.length) {
          const when = q.resetAt ? fmtTime(new Date(q.resetAt)) : null;
          await once(`switch:${q.runtimeId}:${q.since.slice(0, 13)}`,
            `🔁 **Kuota ${provName(q.provider)} habis** (${w.name}). ${switched.length} worker sementara pindah ke **${provName(spare.provider)}** dan task yang terhenti dilanjutkan sekarang.${when ? ` Mereka kembali ke ${provName(q.provider)} setelah kuota reset sekitar pukul **${when}**.` : ""}`);
          report.push(`pindah ke ${spare.provider}: ${switched.join(", ")}`);
          void appendActivity(w.id, { kind: "watchdog", title: `Quota failover → ${provName(spare.provider)}`, detail: switched.join(", "), source: "watchdog" }).catch(() => {});
        }
      } else if (!spare) {
        const when = q.resetAt ? fmtTime(new Date(q.resetAt)) : null;
        await once(`quota:${q.runtimeId}:${q.since.slice(0, 13)}`,
          `☕ **Kuota ${provName(q.provider)} habis** (${w.name}).${when ? ` Reset sekitar pukul **${when}**.` : ""} Task yang terhenti akan dilanjutkan otomatis setelah kuota pulih.`);
      }
    }

    // Pulang ke mesin asli: kuotanya sudah pulih dan worker sedang tidak di tengah pekerjaan.
    const back: string[] = [];
    for (const [agentId, m] of Object.entries(mem.moved)) {
      const a = agentById.get(agentId);
      if (!a || a.archived_at || a.runtime_id !== m.to) { if (!dry) delete mem.moved[agentId]; continue; }
      const resetPassed = m.resetAt ? now > Date.parse(m.resetAt) + 2 * 60000 : now > Date.parse(m.at) + 3 * 3600000;
      if (!resetPassed || outNow.has(m.from) || busy(agentId)) continue;
      if (dry) { report.push(`[uji] kembalikan ${a.name} ke mesin asli`); continue; }
      await updateAgent(w.id, agentId, { runtime_id: m.from, model: m.model, thinking_level: m.thinking });
      a.runtime_id = m.from; delete mem.moved[agentId]; back.push(a.name);
    }
    if (back.length) {
      await once(`back:${now - (now % 3600000)}`, `✅ Kuota pulih (${w.name}). ${back.join(", ")} kembali memakai mesin AI aslinya.`);
      report.push(`kembali: ${back.join(", ")}`);
    }

    // 1b) Retry task yang gagal karena kuota habis ATAU error transient (bounded max 2x).
    for (const [issueId, r] of latest) {
      const issue = issueById.get(issueId);
      if (!issue || r.status !== "failed" || mem.retried![r.id]) continue;
      if (["done", "cancelled", "canceled", "in_review", "backlog"].includes(issue.status)) continue;

      if (isQuotaError(r.error)) {
        const reset = quotaResetAt(r.error!, new Date(r.completed_at ?? r.created_at), tz());
        const readyAt = reset ? reset.getTime() + 2 * 60000 : Date.parse(r.created_at) + 60 * 60000;
        const owner = issue.assignee_type === "agent" ? agentById.get(issue.assignee_id ?? "") : undefined;
        const movedAway = !!owner && owner.runtime_id !== r.runtime_id && !outNow.has(owner.runtime_id);
        const rt = rtById.get(movedAway ? owner!.runtime_id : r.runtime_id);
        if ((!movedAway && now < readyAt) || !open || rt?.status !== "online") continue;
        if (s.runs.some(x => x.issue_id === issueId && ACTIVE.has(x.status))) continue;
        if (dry) { report.push(`[uji] akan mengulang: ${friendlyTitle(issue)}`); continue; }
        await rerunIssue(w.id, issueId);
        mem.retried![r.id] = clock.toISOString();
        report.push(`ulang: ${friendlyTitle(issue)}`);
        if (!movedAway) await once(`resume:${r.id}`, `▶️ Kuota ${provName(rt?.provider ?? "")} sudah pulih. Melanjutkan: **${friendlyTitle(issue)}**.`);
        await emitWorkflowHook("task.failed", { wsId: w.id, issueId, title: friendlyTitle(issue), agentId: r.agent_id, reason: "Quota reset auto-retry", retried: true });
      } else if (isTransientError(r.error)) {
        const prev = mem.transientRetries![issueId] ?? { count: 0, lastAt: "" };
        const owner = issue.assignee_type === "agent" ? agentById.get(issue.assignee_id ?? "") : undefined;
        const rt = rtById.get(owner?.runtime_id ?? r.runtime_id);
        if (!open || rt?.status !== "online") continue;
        if (s.runs.some(x => x.issue_id === issueId && ACTIVE.has(x.status))) continue;
        // Backoff: wait at least 5 minutes after failure before transient retry
        if (now - Date.parse(r.completed_at ?? r.created_at) < 5 * 60000) continue;
        if (prev.count < MAX_TRANSIENT_RETRIES) {
          if (dry) { report.push(`[uji] transient retry (${prev.count + 1}/${MAX_TRANSIENT_RETRIES}): ${friendlyTitle(issue)}`); continue; }
          await rerunIssue(w.id, issueId);
          mem.retried![r.id] = clock.toISOString();
          mem.transientRetries![issueId] = { count: prev.count + 1, lastAt: clock.toISOString() };
          report.push(`retry transient (${prev.count + 1}/${MAX_TRANSIENT_RETRIES}): ${friendlyTitle(issue)}`);
          await emitWorkflowHook("task.failed", { wsId: w.id, issueId, title: friendlyTitle(issue), agentId: r.agent_id, reason: r.error ?? "Transient error", retried: true });
        } else {
          await once(`fail-exhausted:${r.id}`, `🚨 **${friendlyTitle(issue)}** gagal berulang (${MAX_TRANSIENT_RETRIES}x auto-retry habis). Perlu dicek manual.`);
          if (!dry) await emitWorkflowHook("task.failed", { wsId: w.id, issueId, title: friendlyTitle(issue), agentId: r.agent_id, reason: r.error ?? "Retries exhausted", retried: false });
        }
      }
    }

    // 1c) Stuck-run detection (>= threshold minutes without finishing) & optional auto-heal.
    const autoHeal = !!s.kantor.autoHealStuck || process.env.KANTOR_AUTO_HEAL_STUCK === "1";
    for (const { run: sr, minutes } of findStuckRuns(s.runs, now)) {
      const issue = sr.issue_id ? issueById.get(sr.issue_id) : undefined;
      if (!issue || ["done", "cancelled", "canceled"].includes(issue.status)) continue;
      const agent = agentById.get(sr.agent_id);
      const title = friendlyTitle(issue);
      const key = `stuck:${sr.id}`;
      if (dry) {
        report.push(`[uji] stuck run (${minutes}m): ${agent?.name ?? "Agent"} · ${title}${autoHeal ? " (akan di-heal)" : ""}`);
        continue;
      }
      if (autoHeal && open && !mem.retried![key]) {
        await cancelRun(w.id, issue.id, sr.id).catch(() => {});
        await rerunIssue(w.id, issue.id);
        mem.retried![key] = clock.toISOString();
        report.push(`auto-heal stuck (${minutes}m): ${title}`);
        await once(key, `🛟 **${agent?.name ?? "Agent"}** terdeteksi macet (${minutes} menit) di **${title}**. Watchdog otomatis menghentikan & memulai ulang run.`);
        void appendActivity(w.id, { kind: "watchdog", title: `Auto-healed stuck run: ${title}`, detail: `${agent?.name ?? "Agent"} stuck for ${minutes}m`, agentId: sr.agent_id, issueId: issue.id, source: "watchdog" }).catch(() => {});
      } else if (!mem.sent![key]) {
        await once(key, `⏳ **${agent?.name ?? "Agent"}** sudah bekerja ${minutes} menit di **${title}** tanpa selesai. Cek di Kantor Virtual jika macet.`);
        report.push(`stuck alert (${minutes}m): ${title}`);
        void appendActivity(w.id, { kind: "watchdog", title: `Stuck run alert: ${title}`, detail: `${agent?.name ?? "Agent"} running ${minutes}m`, agentId: sr.agent_id, issueId: issue.id, source: "watchdog" }).catch(() => {});
      }
    }

    // 2) Login AI kedaluwarsa di laptop.
    for (const rt of s.runtimes) {
      const last = s.runs.filter(r => r.runtime_id === rt.id).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
      if (last?.status === "failed" && isLoginError(last.error))
        await once(`login:${rt.id}:${last.created_at.slice(0, 10)}`, `⚠️ **Login ${provName(rt.provider)} di laptop kedaluwarsa** (${w.name}). Worker ${provName(rt.provider)} berhenti sampai login diperbaiki. Buka Kantor untuk petunjuknya.`);
    }

    // 3) Hasil baru yang perlu direview, dan tugas baru untuk manusia.
    const memberName = (id: string | null) => s.members.find(m => m.id === id || m.user_id === id)?.name ?? null;
    for (const i of s.issues) {
      const agent = s.agents.find(a => a.id === i.assignee_id);
      if (i.status === "in_review")
        await once(`review:${i.id}:${i.updated_at.slice(0, 16)}`, `📄 **${agent?.name ?? "Worker"}** selesai mengerjakan **${friendlyTitle(i)}** dan menunggu review.`);
      if (i.assignee_type === "member" && !["done", "cancelled"].includes(i.status))
        await once(`human:${i.id}`, `📋 Tugas untukmu: **${friendlyTitle(i)}**${i.due_date ? ` (tenggat ${i.due_date})` : ""}.`, memberName(i.assignee_id));
    }

    // 4) Ringkasan pagi: yang telat & berisiko (sekali sehari, mulai jam 07.00).
    const hour = +new Intl.DateTimeFormat("en-US", { timeZone: tz(), hour: "2-digit", hourCycle: "h23" }).format(clock);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz() }).format(clock);
    if (hour >= 7) {
      const finished = (i: typeof s.issues[number]) => i.status === "in_review" || (i.assignee_type === "agent" &&
        latest.get(i.id)?.status === "completed" && !s.runs.some(x => x.issue_id === i.id && ACTIVE.has(x.status)));
      const openIssues = s.issues.filter(i => !["done", "cancelled"].includes(i.status) && i.due_date && !finished(i));
      const late = openIssues.filter(i => i.due_date! < today);
      const soon = openIssues.filter(i => i.due_date! >= today && Date.parse(i.due_date!) - Date.parse(today) <= 2 * 86400000);
      if (late.length || soon.length) {
        const line = (i: typeof openIssues[number]) => `• ${friendlyTitle(i)} (${i.due_date})`;
        await once(`digest:${today}`, [`☀️ **Ringkasan pagi · ${w.name}**`,
          late.length ? `\n🔴 Telat (${late.length}):\n${late.slice(0, 8).map(line).join("\n")}` : "",
          soon.length ? `\n🟠 Tenggat ≤ 2 hari (${soon.length}):\n${soon.slice(0, 8).map(line).join("\n")}` : ""].join("\n"));
      }
    }

    // 5) Reminders whose time has come: send to the person's Telegram, then close the reminder.
    for (const r of s.reminders.filter(i => !["done", "cancelled", "canceled"].includes(i.status))) {
      const desc = (r.metadata ?? {})[REMIND_META] ? null
        : (await call<{ description?: string | null }>("GET", `/api/issues/${r.id}`, w.id).catch(() => null))?.description ?? null;
      const at = remindAt(r, desc);
      if (!at || at.getTime() > now) continue;
      if (mem.sent![`remind:${r.id}`]) {
        if (!dry) await updateIssue(w.id, r.id, { status: "done" });
        continue;
      }
      if (dry) { report.push(`[uji] reminder: ${reminderText(r)} (${fmtWhen(at)})`); continue; }
      if (!canSend) continue;
      const who = r.assignee_type === "member" ? memberName(r.assignee_id) : null;
      const late = now - at.getTime() > 15 * 60000 ? `\n(set for ${fmtWhen(at)})` : "";
      const notes = remindNotes(desc);
      const sent = await telegram(`⏰ **Reminder:** ${reminderText(r)}${notes ? `\n\n${notes.slice(0, 600)}` : ""}${late}`, who, tg);
      if (!sent) continue;
      mem.sent![`remind:${r.id}`] = clock.toISOString();
      await updateIssue(w.id, r.id, { status: "done" });
      report.push(`reminder: ${reminderText(r)}`);
    }

    if (dry) {
      for (const q of quotaStates(s)) report.push(`[uji] kuota ${q.provider} habis, reset ${q.resetAt ? fmtTime(new Date(q.resetAt)) : "?"}`);
      report.push(`[uji] telegram ${w.name}: ${!telegramReady(tg) ? "belum disambungkan" : botFor(tg)?.own ? "bot khusus kantor ini" : "bot utama (bersama)"}`);
      continue;
    }
    await writeMemory(w.id, mem);
  }
  return report;
  }); } catch (e) { if (e instanceof ProcessBusyError) return []; throw e; }
}
