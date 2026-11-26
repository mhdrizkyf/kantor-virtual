/** Lightweight office-manager identity helpers (kept separate from ChatPanel so ChatPanel stays lazy-loaded). */
export const MANAGER = process.env.NEXT_PUBLIC_KANTOR_MANAGER?.trim() || "Mika";
export const isManager = (name: string) => name.trim().toLowerCase() === MANAGER.toLowerCase();
