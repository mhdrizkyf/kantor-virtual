import { loadWorkspace, workspaces, me } from "@/lib/multica";
import { buildOffice, type Office } from "@/lib/office";
import { fetchLiveCodexQuota } from "@/lib/codex-quota";
import OfficeView from "./office-view";
import Shell from "./shell";

export const dynamic = "force-dynamic";

export type Building = { id: string; slug: string; name: string; attention?: number; open?: boolean; switchOpen?: boolean };

export default async function Page({ searchParams }: { searchParams: Promise<{ ws?: string }> }) {
  const { ws } = await searchParams;
  try {
    const [all, mine] = await Promise.all([workspaces(), me().catch(() => null)]);
    const selected = all.find(w => w.slug === ws || w.id === ws)
      ?? all.find(w => w.id === process.env.MULTICA_WORKSPACE_ID) ?? all[0];
    // Only the selected workspace needs issues, agent task history, and question comments.
    const snap = await loadWorkspace(selected.id);
    const built: Office = buildOffice(snap);
    const liveCodex = await fetchLiveCodexQuota({ runtimes: built.runtimes, timeZone: built.timeZone }).catch(() => built.codexQuota);
    const current: Office = liveCodex ? { ...built, codexQuota: liveCodex } : built;
    const count = (o: Office) => o.attention.overdue.length + o.attention.human.length + o.attention.review.length + o.attention.failed.length;
    const buildings: Building[] = all.map(w => ({ id: w.id, slug: w.slug, name: w.name,
      ...(w.id === selected.id ? { attention: count(current), open: current.open, switchOpen: current.switchOpen } : {}) }));
    const seen = current.seen;
    const cur = buildings.find(b => b.id === current.workspaceId)!;
    return (
      <Shell buildings={buildings} current={cur} section="kantor" roster={[...new Map([...current.rooms.flatMap(r => r.desks), ...current.idleDesks].map(d => [d.agentId, d])).values()].map(d => ({ agentId: d.agentId, name: d.name, description: d.description, face: d.face, state: d.state }))}>
        <OfficeView office={current} buildings={buildings} attention={current.attention} people={current.people} seen={seen} meId={mine?.id ?? null} />
      </Shell>
    );
  } catch (e) {
    return (
      <main className="wrap" style={{ paddingBlock: 40 }}>
        <div className="err">
          <h2>The office couldn't open</h2>
          <p>{e instanceof Error ? e.message : String(e)}</p>
          <p className="desc">Check your internet connection and Multica login, then reload the page.</p>
        </div>
      </main>
    );
  }
}
