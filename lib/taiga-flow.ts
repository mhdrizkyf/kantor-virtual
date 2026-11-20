// Daily Taiga flow: when the member approves the evening "🕒 Review Aktivitas <date>" task, Virtual Office right away
// creates "📝 Catat aktivitas ke Taiga — <date>" for them, with the approved activities as a Taiga card.
// Logging from that card closes it (see app/api/taiga/route.ts).
import "server-only";
import { call_, createIssue, updateIssue, addComment, type Comment } from "./multica";

const TZ = process.env.KANTOR_TIMEZONE || "Asia/Jakarta";
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
type Issue = { id: string; identifier: string; title: string; status: string; assignee_type?: string | null; description?: string | null };

/** The activities in a comment as ```taiga lines: from a ```taiga block, or from the mapping table (# | Judul | Tanggal | Start | Durasi). */
export function taigaLines(text: string): string[] {
  const block = text.match(/```taiga\s*\n([\s\S]*?)```/i);
  if (block) return block[1].split("\n").map(l => l.trim()).filter(l => /^\d{4}-\d{2}-\d{2}\s*\|/.test(l));
  const out: string[] = [];
  for (const row of text.split("\n")) {
    const c = row.split("|").map(s => s.trim());
    // | 1 | [OPS] Title | 18-11-2026 | 08:00 | 60 |
    if (c.length < 6 || !/^\d+$/.test(c[1])) continue;
    const d = c[3].match(/^(\d{2})-(\d{2})-(\d{4})$/), t = c[4].match(/^(\d{1,2})[:.](\d{2})$/), m = c[5].match(/^(\d+)/);
    if (!d || !t || !m) continue;
    const training = /training|pelatihan|\[learning\]/i.test(c[2]);
    out.push(`${d[3]}-${d[2]}-${d[1]} | ${t[1].padStart(2, "0")}:${t[2]} | ${m[1]} |${training ? " training |" : ""} ${c[2].replace(/\*\*/g, "")}`);
  }
  return out;
}

/** Called after the member approves a task. Does nothing unless it is an activity review. */
export async function afterReviewApproved(wsId: string, issue: Issue, comments: Comment[], memberId: string, memberName: string) {
  const m = issue.title.match(/Review Aktivitas\s+(\d{4}-\d{2}-\d{2})/i);
  if (!m) return null;
  const date = m[1];
  const mapping = [...comments].reverse().find(c => c.author_type === "agent" && taigaLines(c.content).length > 0);
  if (!mapping) return null;
  const lines = taigaLines(mapping.content);
  const total = lines.reduce((n, l) => n + (Number(l.split("|")[2]) || 0), 0);
  const description = `Mapping aktivitas **${date}** sudah di-approve ${memberName} di ${issue.identifier}. Cek kartu di bawah, lalu tekan **Log to Taiga**. Task ini tertutup sendiri setelah semuanya tercatat.

\`\`\`taiga
${lines.join("\n")}
\`\`\`

Total ${total} menit.`;
  const r = await call_<{ issues?: Issue[] } | Issue[]>("GET", "/api/issues?limit=300", wsId);
  const all = Array.isArray(r) ? r : r.issues ?? [];
  const existing = all.find(i => !/^(done|cancelled|canceled)$/.test(i.status) && i.title.includes("Catat aktivitas ke Taiga") && i.title.includes(date));
  if (existing) { await updateIssue(wsId, existing.id, { description }); return existing.identifier; }
  const made = await createIssue(wsId, {
    title: `📝 Catat aktivitas ke Taiga — ${date}`, description, status: "todo", priority: "high",
    assignee_type: "member", assignee_id: memberId, due_date: today(),
  }) as { id: string; identifier?: string };
  // The morning plan for that day is finished too.
  const plan = all.find(i => !/^(done|cancelled|canceled)$/.test(i.status) && i.title.includes("Rencana Kegiatan") && i.title.includes(date));
  if (plan) { await addComment(wsId, plan.id, `✅ Ditutup otomatis: review aktivitas ${date} sudah di-approve.`, []); await updateIssue(wsId, plan.id, { status: "done" }); }
  return made.identifier ?? made.id;
}
