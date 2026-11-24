"use client";
import { FACES, faceById } from "@/lib/character-presets";
import CharacterFace from "./character-face";

export default function CharacterPicker({ value, onChange }: { value: string; onChange: (face: string) => void }) {
  const active = faceById(value) ?? FACES[0];
  const next = () => {
    const choices = FACES.filter(f => f.id !== value);
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
      <div className="character-grid" role="group" aria-label="Choose character avatar">
        {FACES.map(f => (
          <button
            type="button"
            key={f.id}
            aria-label={`Choose ${f.label} (${f.vibe})`}
            aria-pressed={value === f.id}
            onClick={() => onChange(f.id)}
          >
            <CharacterFace face={f.id} size={50} shape="rounded" />
            <span>{f.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
