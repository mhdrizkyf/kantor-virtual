// Automatic Office Open/Close schedule evaluator (pure logic, safe to test deterministically).
import { holidayNameOf, type WorkCalendar } from "./office-time";

export type OfficeSchedule = {
  enabled: boolean;
  openTime: string;   // "08:00" (24h HH:MM)
  closeTime: string;  // "17:30" (24h HH:MM)
  days: number[];     // 0=Sun..6=Sat, default [1,2,3,4,5]
  stopRunningOnClose?: boolean;
  lastAutoOpenDate?: string;
  lastAutoCloseDate?: string;
};

export const DEFAULT_SCHEDULE: OfficeSchedule = {
  enabled: false,
  openTime: "08:00",
  closeTime: "17:30",
  days: [1, 2, 3, 4, 5],
  stopRunningOnClose: false,
};

const WEEKDAY_MAP: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function parseClockMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function normalizeSchedule(input?: Partial<OfficeSchedule> | null): OfficeSchedule {
  const openTime = input?.openTime && parseClockMinutes(input.openTime) !== null ? input.openTime.trim() : DEFAULT_SCHEDULE.openTime;
  const closeTime = input?.closeTime && parseClockMinutes(input.closeTime) !== null ? input.closeTime.trim() : DEFAULT_SCHEDULE.closeTime;
  const days = Array.isArray(input?.days)
    ? [...new Set(input.days.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
    : DEFAULT_SCHEDULE.days;
  return {
    enabled: !!input?.enabled,
    openTime,
    closeTime,
    days: days.length ? days : DEFAULT_SCHEDULE.days,
    stopRunningOnClose: !!input?.stopRunningOnClose,
    lastAutoOpenDate: typeof input?.lastAutoOpenDate === "string" ? input.lastAutoOpenDate : undefined,
    lastAutoCloseDate: typeof input?.lastAutoCloseDate === "string" ? input.lastAutoCloseDate : undefined,
  };
}

export type ScheduleDecision =
  | { action: "open"; date: string; reason: string }
  | { action: "close"; date: string; stopRunning: boolean; reason: string }
  | null;

/** Decide whether the office should automatically open or close at `now` in `timeZone`. */
export function evaluateOfficeSchedule(
  rawSchedule: Partial<OfficeSchedule> | null | undefined,
  ctx: { open: boolean; timeZone: string; now?: Date; calendar?: WorkCalendar }
): ScheduleDecision {
  const schedule = normalizeSchedule(rawSchedule);
  if (!schedule.enabled) return null;
  const openMins = parseClockMinutes(schedule.openTime);
  const closeMins = parseClockMinutes(schedule.closeTime);
  if (openMins === null || closeMins === null || openMins >= closeMins) return null;

  const now = ctx.now ?? new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: ctx.timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(now).map(p => [p.type, p.value])
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const weekday = WEEKDAY_MAP[parts.weekday] ?? 1;
  const nowMins = Number(parts.hour) * 60 + Number(parts.minute);

  const isHoliday = holidayNameOf(date, ctx.calendar) !== null;
  const isExtraWork = !!ctx.calendar?.extraWorkDates?.includes(date);
  const isWorkDay = isExtraWork || (!isHoliday && schedule.days.includes(weekday));

  if (isWorkDay && nowMins >= openMins && nowMins < closeMins) {
    if (!ctx.open && schedule.lastAutoOpenDate !== date) {
      return { action: "open", date, reason: `Scheduled open (${schedule.openTime})` };
    }
    return null;
  }

  // Outside working window (or holiday/non-working day): close once per day if still open.
  const pastClose = isWorkDay && nowMins >= closeMins;
  const nonWorkDay = !isWorkDay && nowMins >= openMins;
  if ((pastClose || nonWorkDay) && ctx.open && schedule.lastAutoCloseDate !== date) {
    return {
      action: "close",
      date,
      stopRunning: !!schedule.stopRunningOnClose,
      reason: nonWorkDay ? (isHoliday ? `Holiday (${date})` : "Non-working day") : `Scheduled close (${schedule.closeTime})`,
    };
  }
  return null;
}
