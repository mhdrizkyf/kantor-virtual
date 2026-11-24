import { workspaces, workspace, loadDirectory } from "@/lib/multica";
import { syncInfo, sharedFolder } from "@/lib/knowledge";
import { readCharacters } from "@/lib/characters";
import { assignUniqueFaces, defaultFace } from "@/lib/character-presets";
import Shell from "../shell";
import FilesView, { type Folder } from "./files-view";

export const dynamic = "force-dynamic";
export const metadata = { title: "Knowledge & Files · Virtual Office" };

const emojiOf = (u?: string | null) => (u?.startsWith("emoji:") ? u.slice(6) : null);

export default async function Page({ searchParams }: { searchParams: Promise<{ ws?: string }> }) {
  const { ws } = await searchParams;
  try {
    const [all, cur] = await Promise.all([workspaces(), workspace(ws)]);
    const dir = await loadDirectory(cur.id);
    const info = syncInfo();
    const faces = assignUniqueFaces(dir.agents.map(a => a.id), readCharacters(cur.id));
    const folders: Folder[] = [
      { id: `shared:${cur.id}`, name: "Shared", sub: "for every agent in this workspace", emoji: null, face: null, rel: sharedFolder(cur.name), links: info.links[`shared:${cur.id}`] ?? [] },
      ...dir.agents.map(a => ({ id: a.id, name: a.name.replace(/^[\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]+/u, "") || a.name, sub: info.agents[a.id] ? "" : "no folder yet", emoji: emojiOf(a.avatar_url), face: faces[a.id] ?? defaultFace(a.id), rel: info.agents[a.id] ?? "", links: info.links[a.id] ?? [] })),
    ];
    const buildings = all.map(w => ({ id: w.id, slug: w.slug, name: w.name }));
    return (
      <Shell buildings={buildings} current={buildings.find(b => b.id === cur.id)!} section="files">
        <FilesView folders={folders} hasRoot={!!info.root} lastSync={info.lastSync} lastResult={info.lastResult} top={info.top} />
      </Shell>
    );
  } catch (e) {
    return <main className="wrap" style={{ paddingBlock: 40 }}><div className="err"><h2>The files page couldn&apos;t load</h2><p>{e instanceof Error ? e.message : String(e)}</p></div></main>;
  }
}
