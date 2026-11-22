export type Face = { id: string; label: string; skin: string; hair: string; shirt: string; style: "short" | "bob" | "long" | "curly" | "fringe" | "bald" };

export const FACES: Face[] = [
  { id: "raya", label: "Raya", skin: "#e7ad84", hair: "#472a25", shirt: "#d76778", style: "bob" },
  { id: "niko", label: "Niko", skin: "#f2c7a7", hair: "#27212b", shirt: "#6f9ab9", style: "short" },
  { id: "sari", label: "Sari", skin: "#b87958", hair: "#241d25", shirt: "#e7b34f", style: "long" },
  { id: "bima", label: "Bima", skin: "#9d654c", hair: "#29242c", shirt: "#72a28b", style: "curly" },
  { id: "lia", label: "Lia", skin: "#f2c9ae", hair: "#9c6444", shirt: "#b991cb", style: "fringe" },
  { id: "danu", label: "Danu", skin: "#d59b71", hair: "#3a302b", shirt: "#cf715a", style: "short" },
  { id: "mira", label: "Mira", skin: "#dba682", hair: "#26202a", shirt: "#6fa7a7", style: "long" },
  { id: "ardi", label: "Ardi", skin: "#a96e50", hair: "#6b4431", shirt: "#8e91bb", style: "fringe" },
  { id: "nala", label: "Nala", skin: "#8d5a47", hair: "#241b1d", shirt: "#d884a2", style: "bob" },
  { id: "yusuf", label: "Yusuf", skin: "#edbf9c", hair: "#867b73", shirt: "#8eaa77", style: "bald" },
  { id: "tari", label: "Tari", skin: "#c68762", hair: "#39272a", shirt: "#e5aa63", style: "curly" },
  { id: "reno", label: "Reno", skin: "#f0c8aa", hair: "#b88c5e", shirt: "#7c9abd", style: "short" },
];

export const faceById = (id?: string | null) => FACES.find(x => x.id === id) ?? null;
export function defaultFace(seed: string): string {
  let hash = 7;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return FACES[hash % FACES.length].id;
}
