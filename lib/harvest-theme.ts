import type { FloorPropKind } from "./munder-workflows";

export type FloorTheme = "harvest" | "campus";
export type HarvestLightingMode = "auto" | "morning" | "day" | "sunset" | "night";
export type HarvestPhase = "morning" | "day" | "sunset" | "night";

export const FLOOR_THEME_STORAGE_KEY = "kantor-floor-theme";
export const HARVEST_LIGHTING_STORAGE_KEY = "kantor-harvest-lighting";

export function parseFloorTheme(raw?: string | null): FloorTheme {
  return raw === "campus" ? "campus" : "harvest";
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
      return "Morning Dew";
    case "day":
      return "Sunny Midday";
    case "sunset":
      return "Golden Hour";
    case "night":
      return "Cozy Lanterns";
  }
}

export function floorPropLabel(theme: FloorTheme, kind: FloorPropKind): { title: string; hint: string } {
  if (theme === "harvest") {
    switch (kind) {
      case "board":
        return { title: "Town Notice Board", hint: "Open Task Board & project requests" };
      case "server":
        return { title: "Farm Power Cabinet", hint: "Inspect AI Engines & office controls" };
      case "coffee":
        return { title: "Tea & Coffee Counter", hint: "Send free agents for a warm cup" };
      case "meeting":
        return { title: "Harvest Standup Table", hint: "Call Team Standup huddle here" };
    }
  }
  switch (kind) {
    case "board":
      return { title: "Task Board", hint: "Open Kanban board & all project tasks" };
    case "server":
      return { title: "AI Engines & Controls", hint: "Open office controls & engine status" };
    case "coffee":
      return { title: "Coffee Bar", hint: "Send free agents on a quick coffee break" };
    case "meeting":
      return { title: "Standup Meeting", hint: "Call a live Team Standup huddle here" };
  }
}
