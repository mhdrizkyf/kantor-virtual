import { NextResponse } from "next/server";
import { loadWorkspaceCached, workspaces } from "@/lib/multica";
import { buildOffice, type RunView, type TaskView } from "@/lib/office";

export const dynamic = "force-dynamic";

/** Cross-workspace Unified Attention Hub: aggregates review, overdue, human to-dos, and failures across all workspaces. */
export async function GET() {
  try {
    const all = await workspaces();
    const results = await Promise.all(all.map(async w => {
      try {
        const snap = await loadWorkspaceCached(w.id, 10_000);
        const o = buildOffice(snap);
        return { ok: true as const, ws: w, office: o };
      } catch (e) {
        return { ok: false as const, ws: w, error: e instanceof Error ? e.message : String(e) };
      }
    }));

    const review: TaskView[] = [];
    const overdue: TaskView[] = [];
    const human: TaskView[] = [];
    const failed: (RunView & { wsName: string; wsSlug: string })[] = [];
    const workspacesSummary: { id: string; slug: string; name: string; switchOpen: boolean; total: number; error?: string }[] = [];

    for (const r of results) {
      if (!r.ok) {
        workspacesSummary.push({ id: r.ws.id, slug: r.ws.slug, name: r.ws.name, switchOpen: true, total: 0, error: r.error });
        continue;
      }
      const a = r.office.attention;
      review.push(...a.review);
      overdue.push(...a.overdue);
      human.push(...a.human);
      failed.push(...a.failed.map(f => ({ ...f, wsName: r.ws.name, wsSlug: r.ws.slug })));
      workspacesSummary.push({
        id: r.ws.id,
        slug: r.ws.slug,
        name: r.ws.name,
        switchOpen: r.office.switchOpen,
        total: a.review.length + a.overdue.length + a.human.length + a.failed.length,
      });
    }

    return NextResponse.json({
      total: review.length + overdue.length + human.length + failed.length,
      workspaces: workspacesSummary,
      attention: { review, overdue, human, failed },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
