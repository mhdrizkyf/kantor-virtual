import { FACES } from './character-presets';
export const CAST = ['pam','jim','kelly','oscar','creed','andy','angela','dwight','stanley','kevin','michael','ryan'] as const;
export function castFor(face?: string | null) { return CAST[Math.max(0, FACES.findIndex(f => f.id === face)) % CAST.length]; }
