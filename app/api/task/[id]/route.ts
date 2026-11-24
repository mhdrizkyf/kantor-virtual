import { NextResponse } from "next/server";
import { buildDetail } from "@/lib/detail";
import { addComment, createIssue, updateIssue, setIssueMeta, issueDetail, me, workspace, kantorSettings, rerunIssue, loadDirectory, activeRuns, cancelRun, invalidateWorkspaceCache } from "@/lib/multica";
import { parseMentions, plainText } from "@/lib/mentions";
import { telegram } from "@/lib/telegram";
import { friendlyTitle } from "@/lib/titles";
import { parkIssue, PARK_KEY } from "@/lib/office-control";
import { digest } from "@/lib/digest";
import { emitWorkflowHook } from "@/lib/workflow-hooks";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ws = new URL(req.url).searchParams.get("ws");
  try { return NextResponse.json(await buildDetail(id, ws)); }
  catch (e) { return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 }); }
}

type Body = {
  ws?: string;
  files?: string[];
  status?: string;
  assigneeType?: "agent" | "member" | null;
  assigneeId?: string | null;
  projectId?: string | null;
  startNow?: boolean;
  action: "move" | "assign" | "approve" | "approve-handoff" | "revise" | "reply" | "done" | "rename" | "rerun" | "reopen" | "stop" | "stop-extra" | "restart";
  text?: string;
  link?: string;
  handoff?: {
    title?: string;
    detail?: string;
    assigneeType: "agent" | "member";
    assigneeId: string;
    startNow?: boolean;
  };
};

/** Aksi dari kantor. Setiap aksi ditulis ke Multica atas nama pemilik token. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as Body;
  const text = (body.text ?? "").trim();
  const files = body.files ?? [];
  try {
    const ws = body.ws ?? null;
    const wsObj = await workspace(ws);
    const { issue, comments, attachments } = await issueDetail(id, wsObj.id);
    const meUser = await me(); const who = meUser.name, meId = meUser.id;
    // Kantor tutup: pesan tetap tercatat, tapi worker baru mengerjakannya saat kantor dibuka.
    const officeClosed = (await kantorSettings(wsObj.id)).open === false;
    const closed = officeClosed && issue.assignee_type === "agent";
    // Agen yang dipanggil dengan @ langsung merespons (Multica membangunkannya), kecuali kantor sedang tutup.
    const mentions = body.action === "rename" ? [] : parseMentions(text);
    const mutedMentions = officeClosed ? mentions.filter(m => m.kind === "agent").map(m => m.id) : [];
    const quiet = [...(issue.assignee_type === "agent" && issue.assignee_id ? [issue.assignee_id] : []), ...mutedMentions];
    let handoffResult: { id: string; title: string; assigneeName: string; parked: boolean } | null = null;

    switch (body.action) {
      case "move":
        if (!["backlog", "todo", "in_review"].includes(body.status ?? "")) return NextResponse.json({ error: "Use the task actions to start work or complete a task." }, { status: 400 });
        if (issue.status === "in_progress") return NextResponse.json({ error: "Stop the active task before moving it." }, { status: 409 });
        if (issue.status === "done" || issue.status === "cancelled") return NextResponse.json({ error: "Use Reopen to bring a finished task back, so it's logged." }, { status: 409 });
        if (closed && body.status === "todo") await parkIssue(wsObj.id, id, "todo");
        else await updateIssue(wsObj.id, id, { status: body.status! });
        break;
      case "assign": {
        if (issue.status === "in_progress") return NextResponse.json({ error: "Stop the active task before reassigning it." }, { status: 409 });
        if (issue.status === "done" || issue.status === "cancelled") return NextResponse.json({ error: "Reopen this task before reassigning it." }, { status: 409 });
        const targetType = body.assigneeType ?? (body.assigneeId ? "agent" : null);
        const targetId = targetType ? (body.assigneeId ?? null) : null;
        if (targetType && !targetId) return NextResponse.json({ error: "Pick an assignee first." }, { status: 400 });
        const patch: Record<string, unknown> = { assignee_type: targetType, assignee_id: targetId };
        if (body.projectId !== undefined) patch.project_id = body.projectId || null;
        const shouldStart = !!body.startNow;
        const targetClosed = officeClosed && targetType === "agent";
        if (body.startNow === true) {
          patch.status = targetClosed ? "backlog" : "todo";
        } else if (body.startNow === false) {
          patch.status = "backlog";
        } else if (targetClosed && issue.status === "todo") {
          patch.status = "backlog";
        }
        await updateIssue(wsObj.id, id, patch);
        if ((shouldStart || (body.startNow === undefined && issue.status === "todo")) && targetClosed) {
          await parkIssue(wsObj.id, id, "todo");
        }
        if (targetId) {
          const dir = await loadDirectory(wsObj.id).catch(() => null);
          const targetName = targetType === "agent"
            ? dir?.agents.find(a => a.id === targetId)?.name ?? "Agent"
            : dir?.members.find(m => m.user_id === targetId || m.id === targetId)?.name ?? "Member";
          const suppress = targetType === "agent" && (!shouldStart || targetClosed) ? [targetId] : [];
          await addComment(wsObj.id, id, `↪️ Assigned to ${targetName} by ${who} in Virtual Office.${text ? `\n\n${text}` : ""}`, suppress, files);
        }
        break;
      }
      case "approve":
        // Komentar persetujuan tidak membangunkan agen (hemat token), lalu task ditutup.
        await addComment(wsObj.id, id, `✅ Approved by ${who} in Virtual Office.${text ? `\n\n${text}` : ""}`, quiet, files);
        await updateIssue(wsObj.id, id, { status: "done" });
        await emitWorkflowHook("task.approved", {
          wsId: wsObj.id, issue, comments, memberId: meId, memberName: who, officeClosed, note: text || undefined,
        });
        break;
      case "approve-handoff": {
        const h = body.handoff;
        if (!h || !h.assigneeId || (h.assigneeType !== "agent" && h.assigneeType !== "member")) {
          return NextResponse.json({ error: "Pick who to hand off the follow-up task to." }, { status: 400 });
        }
        const dir = await loadDirectory(wsObj.id).catch(() => null);
        const targetName = h.assigneeType === "agent"
          ? dir?.agents.find(a => a.id === h.assigneeId)?.name ?? "Agent"
          : dir?.members.find(m => m.user_id === h.assigneeId || m.id === h.assigneeId)?.name ?? "Member";

        await addComment(wsObj.id, id, `✅ Approved by ${who} and handed off to ${targetName}.${text ? `\n\n${text}` : ""}`, quiet, files);
        await updateIssue(wsObj.id, id, { status: "done" });
        await emitWorkflowHook("task.approved", {
          wsId: wsObj.id, issue, comments, memberId: meId, memberName: who, officeClosed, note: `Handed off to ${targetName}`,
        });

        // Build rich handoff description with summary + deliverables from the approved issue
        const ordered = comments.filter(c => !c.deleted_at).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
        const lastAgent = [...ordered].reverse().find(c => c.author_type === "agent" && c.content?.trim());
        const dg = lastAgent ? digest(lastAgent.content) : null;
        const deliverableNames = [...new Set([
          ...attachments.map(a => a.filename),
          ...ordered.flatMap(c => (c.attachments ?? []).map(a => a.filename)),
        ])].slice(0, 10);

        const nextTitle = (h.title ?? "").trim().slice(0, 120) || `Follow up: ${friendlyTitle(issue)}`.slice(0, 120);
        const descParts = [
          h.detail?.trim() || text || `Continue from approved task **${issue.identifier} · ${friendlyTitle(issue)}**.`,
          "",
          `### Handoff from ${issue.identifier} (${friendlyTitle(issue)})`,
          ...(dg?.summary?.length ? dg.summary.map(s => `- ${s}`) : ["- Approved without extra summary."]),
          ...(deliverableNames.length ? [`- Deliverables: ${deliverableNames.join(", ")}`] : []),
        ];

        const startNow = h.startNow !== false;
        const parkTarget = officeClosed && h.assigneeType === "agent" && startNow;
        const created = await createIssue(wsObj.id, {
          title: nextTitle,
          description: descParts.join("\n"),
          status: !startNow || parkTarget ? "backlog" : "todo",
          priority: issue.priority || "medium",
          assignee_type: h.assigneeType,
          assignee_id: h.assigneeId,
          project_id: issue.project_id ?? null,
          due_date: issue.due_date ?? null,
        });
        if (parkTarget) await setIssueMeta(wsObj.id, created.id, PARK_KEY, "todo");

        handoffResult = { id: created.id, title: nextTitle, assigneeName: targetName, parked: parkTarget };
        await emitWorkflowHook("task.handoff", {
          wsId: wsObj.id,
          fromIssueId: issue.id,
          fromTitle: friendlyTitle(issue),
          toIssueId: created.id,
          toTitle: nextTitle,
          toAssigneeId: h.assigneeId,
          toAssigneeName: targetName,
          memberName: who,
        });
        break;
      }
      case "revise":
        if (!text && !files.length) return NextResponse.json({ error: "The change request is empty." }, { status: 400 });
        if (closed) {
          await addComment(wsObj.id, id, `✏️ Changes requested:\n\n${text}`, quiet, files);
          await parkIssue(wsObj.id, id, "todo");
        } else {
          await addComment(wsObj.id, id, `✏️ Changes requested:\n\n${text}`, mutedMentions, files);
          await updateIssue(wsObj.id, id, { status: "todo" });
        }
        await emitWorkflowHook("task.revised", {
          wsId: wsObj.id,
          issueId: issue.id,
          title: friendlyTitle(issue),
          assigneeId: issue.assignee_type === "agent" ? issue.assignee_id : null,
          memberName: who,
          feedback: text || "(attachments)",
        });
        break;
      case "reopen":
        if (text || files.length) {
          if (closed) { await addComment(wsObj.id, id, `↩️ Reopened by ${who}:\n\n${text}`, quiet, files); await parkIssue(wsObj.id, id, "todo"); }
          else { await addComment(wsObj.id, id, `↩️ Reopened by ${who}:\n\n${text}`, mutedMentions, files); await updateIssue(wsObj.id, id, { status: "todo" }); }
        } else {
          await addComment(wsObj.id, id, `↩️ Reopened by ${who}.`, quiet);
          await updateIssue(wsObj.id, id, { status: "in_review" });
        }
        break;
      case "reply":
        if (!text && !files.length) return NextResponse.json({ error: "The message is empty." }, { status: 400 });
        if (closed) { await addComment(wsObj.id, id, text, quiet, files); await parkIssue(wsObj.id, id, issue.status === "in_progress" ? "in_progress" : "todo"); }
        else await addComment(wsObj.id, id, text, mutedMentions, files);
        break;
      case "done":
        await addComment(wsObj.id, id, `✅ Done by ${who}.${body.link ? `\n\nLink: ${body.link}` : ""}${text ? `\n\n${text}` : ""}`, quiet, files);
        await updateIssue(wsObj.id, id, { status: "done" });
        break;
      case "rerun":
        await rerunIssue(wsObj.id, id);
        break;
      case "stop": case "stop-extra": case "restart": {
        const runs = (await activeRuns(wsObj.id, id)).sort((a, b) => a.created_at.localeCompare(b.created_at));
        for (const r of body.action === "stop-extra" ? runs.slice(1) : runs) await cancelRun(wsObj.id, id, r.id).catch(() => {});
        if (body.action === "restart") { await new Promise(r => setTimeout(r, 1500)); await rerunIssue(wsObj.id, id); }
        break;
      }
      case "rename":
        await setIssueMeta(wsObj.id, id, "kantor_title", text);
        break;
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }

    invalidateWorkspaceCache(wsObj.id);

    const people = mentions.filter(m => m.kind === "member");
    if (people.length) {
      const dir = await loadDirectory(wsObj.id).catch(() => null);
      if (dir) {
        const tg = { id: dir.workspace.id, slug: dir.workspace.slug, name: dir.workspace.name, members: dir.members.map(m => m.name) };
        const excerpt = plainText(text).slice(0, 280);
        for (const p of people) {
          const name = dir.members.find(m => m.user_id === p.id || m.id === p.id)?.name ?? p.name;
          if (name === who) continue;
          void telegram(`📣 **${who}** mentioned you in "${friendlyTitle(issue)}"\n\n${excerpt}\n\nOpen Virtual Office to reply.`, name, tg).catch(() => 0);
        }
      }
    }
    const detail = await buildDetail(id, wsObj.id);
    return NextResponse.json(handoffResult ? { ...detail, handoff: handoffResult } : detail);
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
