"use client";
import { FACES } from "@/lib/character-presets";
import CharacterFace from "./character-face";

export default function CharacterPicker({ value, onChange }: { value: string; onChange: (face: string) => void }) {
  const next = () => { const choices = FACES.filter(f => f.id !== value); onChange(choices[Math.floor(Math.random() * choices.length)].id); };
  return <div className="character-picker">
    <div className="character-preview"><CharacterFace face={value} size={76} /><span><b>Character</b><small>Pick a face for this agent&apos;s desk and profile.</small></span><button type="button" className="btn sm" onClick={next}>Shuffle</button></div>
    <div className="character-grid" role="group" aria-label="Choose agent character">{FACES.map(f => <button type="button" key={f.id} aria-label={`Choose ${f.label}`} aria-pressed={value === f.id} onClick={() => onChange(f.id)}><CharacterFace face={f.id} size={56} /><span>{f.label}</span></button>)}</div>
  </div>;
}
