"use client";
// Client preferences (Harvest lighting, Handover & Review delivery styles) + minute-aligned office clock status.
import { useCallback, useEffect, useState } from "react";
import {
  HANDOVER_STYLE_KEY,
  REVIEW_STYLE_KEY,
  type HandoverStyle,
  type ReviewStyle,
} from "@/lib/munder-workflows";
import { getOfficeClockStatus, type OfficeClockStatus, type WorkCalendar } from "@/lib/office-time";
import {
  HARVEST_LIGHTING_STORAGE_KEY,
  parseHarvestLighting,
  resolveHarvestPhase,
  type HarvestLightingMode,
  type HarvestPhase,
} from "@/lib/harvest-theme";

export function useOfficePreferences(opts: {
  timeZone: string;
  switchOpen: boolean;
  workCalendar?: WorkCalendar;
}) {
  const [harvestLighting, setHarvestLightingState] = useState<HarvestLightingMode>("auto");
  const [harvestPhase, setHarvestPhase] = useState<HarvestPhase>("day");
  const [handoverStyle, setHandoverStyleState] = useState<HandoverStyle>("auto");
  const [reviewStyle, setReviewStyleState] = useState<ReviewStyle>("auto");
  const [clockStatus, setClockStatus] = useState<OfficeClockStatus>(() =>
    getOfficeClockStatus(opts.timeZone, new Date(), opts.workCalendar)
  );

  useEffect(() => {
    try {
      setHarvestLightingState(parseHarvestLighting(localStorage.getItem(HARVEST_LIGHTING_STORAGE_KEY)));
      const hs = localStorage.getItem(HANDOVER_STYLE_KEY);
      if (hs === "auto" || hs === "walk" || hs === "bubble") setHandoverStyleState(hs);
      const rs = localStorage.getItem(REVIEW_STYLE_KEY);
      if (rs === "auto" || rs === "walk" || rs === "bubble") setReviewStyleState(rs);
    } catch {
      // Ignore storage access failures in private browsing.
    }
  }, []);

  const setHarvestLighting = useCallback((next: HarvestLightingMode) => {
    setHarvestLightingState(next);
    try { localStorage.setItem(HARVEST_LIGHTING_STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);

  const setHandoverStyle = useCallback((next: HandoverStyle) => {
    setHandoverStyleState(next);
    try { localStorage.setItem(HANDOVER_STYLE_KEY, next); } catch { /* ignore */ }
  }, []);

  const setReviewStyle = useCallback((next: ReviewStyle) => {
    setReviewStyleState(next);
    try { localStorage.setItem(REVIEW_STYLE_KEY, next); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setClockStatus(getOfficeClockStatus(opts.timeZone, now, opts.workCalendar));
      setHarvestPhase(resolveHarvestPhase(harvestLighting, opts.timeZone, opts.switchOpen, now));
    };
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      update();
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    tick();
    document.addEventListener("visibilitychange", update);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [opts.timeZone, opts.switchOpen, opts.workCalendar, harvestLighting]);

  return {
    harvestLighting,
    setHarvestLighting,
    harvestPhase,
    handoverStyle,
    setHandoverStyle,
    reviewStyle,
    setReviewStyle,
    clockStatus,
    lunchHour: opts.switchOpen && clockStatus.isLunch,
  };
}
