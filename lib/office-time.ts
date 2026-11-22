export type WorkCalendar = { holidays?: string[]; extraWorkDates?: string[]; activeWork?: boolean };

/** Dates and weekdays are always evaluated in the workspace timezone. */
export function isWorkDay(timeZone: string, at = new Date(), calendar: WorkCalendar = {}): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(at);
  const value = (key: string) => parts.find(p => p.type === key)?.value;
  const date = `${value('year')}-${value('month')}-${value('day')}`;
  if (calendar.activeWork || calendar.extraWorkDates?.includes(date)) return true;
  return !['Sat', 'Sun'].includes(value('weekday')!) && !calendar.holidays?.includes(date);
}

export function isLunchHour(timeZone: string, at = new Date(), calendar: WorkCalendar = {}): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(at));
  return hour === 12 && isWorkDay(timeZone, at, calendar);
}
