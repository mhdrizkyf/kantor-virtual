"use client";
import { useMemo, useState } from "react";
import { CHARACTER_RECIPES, FACES, faceById, type CharacterRecipe } from "@/lib/character-presets";
import CharacterFace from "./character-face";

type PickerFilter = "all" | "glasses" | "hijab" | "accessories";

const FILTERS: { id: PickerFilter; label: string }[] = [
  { id: "all", label: "Semua" },
  { id: "glasses", label: "Kacamata" },
  { id: "hijab", label: "Hijab" },
  { id: "accessories", label: "Aksesoris" },
];

function matchesFilter(recipe: CharacterRecipe, filter: PickerFilter): boolean {
  if (filter === "all") return true;
  if (filter === "glasses") return Boolean(recipe.glasses);
  if (filter === "hijab") return recipe.hairStyle === "hijab";
  return Boolean(
    recipe.capColor ||
    recipe.scarf ||
    recipe.headphones ||
    recipe.headband ||
    recipe.hairpin ||
    recipe.earrings ||
    recipe.hairStyle === "beanie"
  );
}

export default function CharacterPicker({ value, onChange }: { value: string; onChange: (face: string) => void }) {
  const [filter, setFilter] = useState<PickerFilter>("all");
  const active = faceById(value) ?? FACES[0];

  const visibleFaces = useMemo(() => {
    const allowedIds = new Set(CHARACTER_RECIPES.filter(r => matchesFilter(r, filter)).map(r => r.id));
    return FACES.filter(f => allowedIds.has(f.id));
  }, [filter]);

  const next = () => {
    const pool = visibleFaces.length > 1 ? visibleFaces : FACES;
    const choices = pool.filter(f => f.id !== value);
    if (choices.length === 0) return;
    onChange(choices[Math.floor(Math.random() * choices.length)].id);
  };

  return (
    <div className="character-picker">
      <div className="character-preview">
        <CharacterFace face={active.id} size={68} shape="rounded" />
        <span>
          <b>{active.label}</b>
          <small>{active.vibe}</small>
        </span>
        <button type="button" className="btn sm" onClick={next}>Shuffle</button>
      </div>
      <div className="character-filter-bar" role="tablist" aria-label="Filter pilihan avatar">
        <div className="character-filter-pills">
          {FILTERS.map(item => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              className={filter === item.id ? "character-filter-pill active" : "character-filter-pill"}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="character-count">{visibleFaces.length}/{FACES.length}</span>
      </div>
      <div className="character-grid" role="group" aria-label="Choose character avatar">
        {visibleFaces.map(f => (
          <button
            type="button"
            key={f.id}
            aria-label={`Choose ${f.label} (${f.vibe})`}
            aria-pressed={value === f.id}
            onClick={() => onChange(f.id)}
          >
            <CharacterFace face={f.id} size={48} shape="rounded" />
            <span>{f.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
