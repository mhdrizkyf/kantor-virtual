// Workspace clock, working hours (08:00–17:30), lunch break (12:00–13:15),
// weekdays, and national/custom holiday awareness.
export type WorkCalendar = {
  holidays?: string[];
  extraWorkDates?: string[];
  activeWork?: boolean;
  /** Disable built-in national holidays when testing custom calendars explicitly. */
  ignoreNationalHolidays?: boolean;
};

export type OfficePhase =
  | "working"
  | "lunch"
  | "before_hours"
  | "after_hours"
  | "weekend"
  | "holiday";

export type OfficeClockStatus = {
  phase: OfficePhase;
  date: string;
  time: string;
  minutes: number;
  isWorkDay: boolean;
  inWorkHours: boolean;
  isLunch: boolean;
  isHoliday: boolean;
  holidayName: string | null;
  label: string;
  shortLabel: string;
};

export const WORK_START_MIN = 8 * 60;          // 08:00
export const WORK_END_MIN = 17 * 60 + 30;      // 17:30
export const LUNCH_START_MIN = 12 * 60;        // 12:00
export const LUNCH_END_MIN = 13 * 60 + 15;     // 13:15

/** Built-in Indonesian national holidays (2026–2027) for Asia/Jakarta default; overridable via data/work-calendar.json. */
export const NATIONAL_HOLIDAYS: Record<string, string> = {
  // 2026
  "2026-01-01": "Tahun Baru Masehi",
  "2026-01-16": "Isra Mi'raj",
  "2026-02-17": "Tahun Baru Imlek",
  "2026-03-19": "Hari Suci Nyepi",
  "2026-03-20": "Idul Fitri 1447 H",
  "2026-03-21": "Idul Fitri 1447 H",
  "2026-04-03": "Wafat Isa Almasih",
  "2026-05-01": "Hari Buruh Internasional",
  "2026-05-14": "Kenaikan Isa Almasih",
  "2026-05-27": "Idul Adha 1447 H",
  "2026-05-31": "Hari Raya Waisak",
  "2026-06-01": "Hari Lahir Pancasila",
  "2026-06-16": "Tahun Baru Islam 1448 H",
  "2026-08-17": "Hari Kemerdekaan RI",
  "2026-08-25": "Maulid Nabi Muhammad SAW",
  "2026-12-25": "Hari Raya Natal",
  // 2027
  "2027-01-01": "Tahun Baru Masehi",
  "2027-01-05": "Isra Mi'raj",
  "2027-02-06": "Tahun Baru Imlek",
  "2027-03-08": "Hari Suci Nyepi",
  "2027-03-10": "Idul Fitri 1448 H",
  "2027-03-11": "Idul Fitri 1448 H",
  "2027-03-26": "Wafat Isa Almasih",
  "2027-05-01": "Hari Buruh Internasional",
  "2027-05-06": "Kenaikan Isa Almasih",
  "2027-05-17": "Idul Adha 1448 H",
  "2027-05-20": "Hari Raya Waisak",
  "2027-06-01": "Hari Lahir Pancasila",
  "2027-06-06": "Tahun Baru Islam 1449 H",
  "2027-08-17": "Hari Kemerdekaan RI",
  "2027-08-15": "Maulid Nabi Muhammad SAW",
  "2027-12-25": "Hari Raya Natal",
};

function clockParts(timeZone: string, at: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const value = (key: string) => parts.find(p => p.type === key)?.value ?? "";
  const date = `${value("year")}-${value("month")}-${value("day")}`;
  const hour = Number(value("hour"));
  const minute = Number(value("minute"));
  const weekday = value("weekday");
  return {
    date,
    weekday,
    hour,
    minute,
    minutes: hour * 60 + minute,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

export function holidayNameOf(date: string, calendar: WorkCalendar = {}): string | null {
  if (calendar.extraWorkDates?.includes(date)) return null;
  if (calendar.holidays?.includes(date)) return NATIONAL_HOLIDAYS[date] ?? "Hari Libur";
  if (!calendar.ignoreNationalHolidays && NATIONAL_HOLIDAYS[date]) return NATIONAL_HOLIDAYS[date];
  return null;
}

/** Dates and weekdays are always evaluated in the workspace timezone. */
export function isWorkDay(timeZone: string, at = new Date(), calendar: WorkCalendar = {}): boolean {
  const { date, weekday } = clockParts(timeZone, at);
  if (calendar.activeWork || calendar.extraWorkDates?.includes(date)) return true;
  if (["Sat", "Sun"].includes(weekday)) return false;
  return holidayNameOf(date, calendar) === null;
}

/** Break / lunch window: 12:00 – 13:15 on work days. */
export function isLunchHour(timeZone: string, at = new Date(), calendar: WorkCalendar = {}): boolean {
  const { minutes } = clockParts(timeZone, at);
  return minutes >= LUNCH_START_MIN && minutes < LUNCH_END_MIN && isWorkDay(timeZone, at, calendar);
}

/** True during regular office working hours: Mon–Fri 08:00–17:30 (excluding holidays, unless extraWorkDates/activeWork). */
export function isWorkingHours(timeZone: string, at = new Date(), calendar: WorkCalendar = {}): boolean {
  const { minutes } = clockParts(timeZone, at);
  return minutes >= WORK_START_MIN && minutes < WORK_END_MIN && isWorkDay(timeZone, at, calendar);
}

/** Full office clock status used by the live floor scene to decide whether idle agents are present, on break, or off-duty. */
export function getOfficeClockStatus(
  timeZone: string,
  at = new Date(),
  calendar: WorkCalendar = {}
): OfficeClockStatus {
  const { date, weekday, minutes, time } = clockParts(timeZone, at);
  const isExtra = !!calendar.extraWorkDates?.includes(date);
  const isWeekend = ["Sat", "Sun"].includes(weekday) && !isExtra;
  const holidayName = isExtra ? null : holidayNameOf(date, calendar);
  const isHoliday = holidayName !== null;
  const workDay = isExtra || (!isWeekend && !isHoliday);
  const inHours = workDay && minutes >= WORK_START_MIN && minutes < WORK_END_MIN;
  const lunch = inHours && minutes >= LUNCH_START_MIN && minutes < LUNCH_END_MIN;

  let phase: OfficePhase;
  let label: string;
  let shortLabel: string;

  if (isHoliday) {
    phase = "holiday";
    label = `Libur Nasional (${holidayName}) · Agen libur`;
    shortLabel = `Libur · ${holidayName}`;
  } else if (isWeekend) {
    phase = "weekend";
    label = "Akhir pekan · Kantor libur (Senin–Jumat 08:00–17:30)";
    shortLabel = "Akhir pekan · Libur";
  } else if (minutes < WORK_START_MIN) {
    phase = "before_hours";
    label = `Belum jam kerja · Agen masuk pukul 08:00`;
    shortLabel = "Masuk 08:00";
  } else if (minutes >= WORK_END_MIN) {
    phase = "after_hours";
    label = "Di luar jam kerja (08:00–17:30) · Agen sudah pulang";
    shortLabel = "Pulang · 17:30";
  } else if (lunch) {
    phase = "lunch";
    label = "Jam istirahat · 12:00–13:15";
    shortLabel = "Istirahat 12:00–13:15";
  } else {
    phase = "working";
    label = "Jam kerja · 08:00–17:30";
    shortLabel = "Jam kerja";
  }

  return {
    phase,
    date,
    time,
    minutes,
    isWorkDay: workDay,
    inWorkHours: inHours,
    isLunch: lunch,
    isHoliday,
    holidayName,
    label,
    shortLabel,
  };
}
