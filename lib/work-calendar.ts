import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkCalendar } from './office-time';

/** Optional local calendar, keyed by workspace ID. No external holiday assumptions. */
export function readWorkCalendar(workspaceId: string): WorkCalendar {
  try {
    const data = JSON.parse(readFileSync(join(process.cwd(), 'data/work-calendar.json'), 'utf8'))[workspaceId] ?? {};
    const dates = (v: unknown): string[] => Array.isArray(v) ? v.filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
    return { holidays: dates(data.holidays), extraWorkDates: dates(data.extraWorkDates) };
  } catch { return {}; }
}
