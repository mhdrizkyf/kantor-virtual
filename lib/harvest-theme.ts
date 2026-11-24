import type { FloorPropKind } from "./munder-workflows";

export type FloorTheme = "harvest";
export type HarvestLightingMode = "auto" | "morning" | "day" | "sunset" | "night";
export type HarvestPhase = "morning" | "day" | "sunset" | "night";

export const FLOOR_THEME_STORAGE_KEY = "kantor-floor-theme";
export const HARVEST_LIGHTING_STORAGE_KEY = "kantor-harvest-lighting";

export function parseFloorTheme(_raw?: string | null): FloorTheme {
  return "harvest";
}

export function parseHarvestLighting(raw?: string | null): HarvestLightingMode {
  if (raw === "morning" || raw === "day" || raw === "sunset" || raw === "night") return raw;
  return "auto";
}

/** Resolve the current local hour (0..23) in the workspace timezone safely. */
export function localHourInZone(timeZone: string, now = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const h = Number(parts.find(p => p.type === "hour")?.value);
    if (Number.isFinite(h)) return h % 24;
  } catch {
    // Fallback to host local hour if timezone string is invalid.
  }
  return now.getHours();
}

/**
 * Determine Harvest Moon atmospheric lighting phase.
 * - Explicit overrides ("morning" | "day" | "sunset" | "night") always win.
 * - "auto" uses cozy lantern night when the office is closed, otherwise follows workspace time.
 */
export function resolveHarvestPhase(
  mode: HarvestLightingMode,
  timeZone: string,
  officeOpen: boolean,
  now = new Date()
): HarvestPhase {
  if (mode !== "auto") return mode;
  if (!officeOpen) return "night";
  const h = localHourInZone(timeZone, now);
  if (h >= 5 && h < 9) return "morning";
  if (h >= 9 && h < 16) return "day";
  if (h >= 16 && h < 19) return "sunset";
  return "night";
}

export function harvestPhaseLabel(phase: HarvestPhase): string {
  switch (phase) {
    case "morning":
      return "Spring Dawn";
    case "day":
      return "Pelican Midday";
    case "sunset":
      return "Golden Hour";
    case "night":
      return "Lantern Night";
  }
}

export function floorPropLabel(_theme: FloorTheme, kind: FloorPropKind): { title: string; hint: string } {
  switch (kind) {
    case "board":
      return { title: "Help Wanted Board", hint: "Open Task Board & Pelican Town requests" };
    case "server":
      return { title: "AI Compute Cabinet", hint: "Inspect Codex credit & office controls" };
    case "coffee":
      return { title: "Coffee Machine Bar", hint: "Send free agents to the coffee bar or kitchen for a break" };
    case "meeting":
      return { title: "Executive Meeting Room", hint: "Call a live Team Standup huddle in the boardroom" };
  }
}
