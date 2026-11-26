// Declarative floor layout schema & reusable geometry helpers.
// Designed as a clean boundary so future dynamic rooms, custom layouts, or multi-floor offices
// can swap FloorPlanSchema without rewriting canvas rendering or actor logic.
import { OFFICE_PLAN } from "../floor-seats";
import type { DropZone } from "../munder-workflows";

export type FloorDeskSlot = {
  x: number;
  y: number;
  seat: "n" | "s" | string;
};

export type FloorErrandSpot = {
  x: number;
  y: number;
  face?: string;
  kind: string;
};

export type FloorPlanSchema = typeof OFFICE_PLAN;

export type OfficeFloorConfig = {
  id: string;
  label: string;
  plan: FloorPlanSchema;
};

export const DEFAULT_FLOOR_CONFIG: OfficeFloorConfig = {
  id: "main-floor",
  label: "Main Floor",
  plan: OFFICE_PLAN,
};

export const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function seatPointFor(seatIndex: number, plan: FloorPlanSchema = OFFICE_PLAN) {
  return plan.desks[seatIndex] ?? plan.desks[0];
}

export function computeFloorScale(containerW: number, containerH: number, plan: FloorPlanSchema = OFFICE_PLAN) {
  const width = Math.min(containerW, (containerH * plan.cols) / plan.rows);
  return {
    width,
    height: (width * plan.rows) / plan.cols,
    frameWidth: containerW + 16,
    frameHeight: containerH + 16,
  };
}

export type BreakCoffeeSpot = {
  x: number;
  y: number;
  face: string;
  kind: string;
  isCoffeeBar: boolean;
  label: string;
};

/** Resolve real break destinations (Kitchen Pantry + Dedicated Coffee Machine Bar) from the active floor schema. */
export function getBreakCoffeeSpots(plan: FloorPlanSchema = OFFICE_PLAN): BreakCoffeeSpot[] {
  const spots = plan.errands.filter(e => e.kind === "coffee");
  if (spots.length >= 2) {
    return spots.map(e => ({
      ...e,
      face: e.face || "up",
      isCoffeeBar: e.x >= 30,
      label: e.x >= 30 ? "Pulling an espresso at the coffee bar ☕" : "Grabbing a brew in the kitchen 🍳",
    }));
  }
  const fallback = spots[0] ?? plan.lunch;
  return [{ ...fallback, face: "up", kind: "coffee", isCoffeeBar: false, label: "Grabbing a quick coffee ☕" }];
}

export function describeDropTarget(draggedName: string, zone: DropZone): string {
  switch (zone.kind) {
    case "desk":
      return `Hand off task to ${zone.name}`;
    case "human":
      return `Send update to ${zone.name}`;
    case "meeting":
      return `Call Standup Huddle with ${draggedName}`;
    case "coffee":
      return `Send ${draggedName} for a coffee break`;
    case "board":
      return "Open Task Board";
    case "server":
      return "Inspect AI Engines";
    default:
      return `Drop ${draggedName} on floor`;
  }
}
