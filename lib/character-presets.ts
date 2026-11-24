import recipes from "./character-recipes.json";

export type CharacterRecipe = {
  id: string;
  label: string;
  vibe: string;
  bg1: string;
  bg2: string;
  skin: string;
  hair: string;
  hairStyle: "bob" | "sidepart" | "longwavy" | "afro" | "highbun" | "messy" | "hijab" | "spiky" | "twinpuffs" | "bald" | "curlyband" | "curtain";
  eyes: "lashed" | "normal" | "wide" | "sparkle" | "focused" | "calm" | "happy";
  eyeColor: string;
  brow: "arched" | "confident" | "soft" | "thick";
  mouth: "smile" | "smirk" | "grin" | "neutral";
  blush?: boolean;
  freckles?: boolean;
  earrings?: "gold";
  hairpin?: string;
  headband?: string;
  headphones?: string;
  glasses?: "round" | "cateye" | "rect" | "halfrim";
  facial?: "goatee" | "mustache" | "fullbeard";
  outfit: "collar" | "tie" | "cardigan" | "crew" | "turtleneck" | "hoodie" | "blazer" | "jacket" | "striped" | "vest";
  shirt: string;
  shirt2: string;
  pants: string;
  shoes: string;
};

export type Face = {
  id: string;
  label: string;
  vibe: string;
  bg1: string;
  bg2: string;
  skin: string;
  hair: string;
  shirt: string;
  style: "short" | "bob" | "long" | "curly" | "fringe" | "bald";
};

const STYLE_MAP: Record<CharacterRecipe["hairStyle"], Face["style"]> = {
  bob: "bob",
  sidepart: "short",
  longwavy: "long",
  afro: "curly",
  highbun: "fringe",
  messy: "short",
  hijab: "long",
  spiky: "fringe",
  twinpuffs: "bob",
  bald: "bald",
  curlyband: "curly",
  curtain: "short",
};

export const CHARACTER_RECIPES = recipes as CharacterRecipe[];

export const FACES: Face[] = CHARACTER_RECIPES.map(r => ({
  id: r.id,
  label: r.label,
  vibe: r.vibe,
  bg1: r.bg1,
  bg2: r.bg2,
  skin: r.skin,
  hair: r.hair,
  shirt: r.shirt,
  style: STYLE_MAP[r.hairStyle],
}));

export const faceById = (id?: string | null) => FACES.find(x => x.id === id) ?? null;
export const recipeById = (id?: string | null) => CHARACTER_RECIPES.find(x => x.id === id) ?? null;

export function defaultFace(seed: string): string {
  let hash = 7;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return FACES[hash % FACES.length].id;
}

/**
 * Assign a distinct character face to each agent in a workspace.
 * Explicitly saved choices are always honored; unsaved agents pick the closest unused
 * face from their deterministic hash so teammates never end up with duplicate faces.
 */
export function assignUniqueFaces(agentIds: string[], saved: Record<string, string> = {}): Record<string, string> {
  const result: Record<string, string> = {};
  const used = new Set<string>();

  for (const id of agentIds) {
    const pick = saved[id];
    if (pick && faceById(pick)) {
      result[id] = pick;
      used.add(pick);
    }
  }

  for (const id of agentIds) {
    if (result[id]) continue;
    let hash = 7;
    for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const start = hash % FACES.length;
    let chosen = FACES[start].id;
    if (used.size < FACES.length) {
      for (let offset = 0; offset < FACES.length; offset++) {
        const candidate = FACES[(start + offset) % FACES.length].id;
        if (!used.has(candidate)) {
          chosen = candidate;
          break;
        }
      }
    }
    result[id] = chosen;
    used.add(chosen);
  }

  return result;
}
