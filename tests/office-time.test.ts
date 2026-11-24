import test from 'node:test';
import assert from 'node:assert/strict';
import { getOfficeClockStatus, isLunchHour, isWorkingHours } from '../lib/office-time';

test('lunch respects weekends, holidays, overtime, 12:00-13:15 window and timezone', () => {
  const sunday = new Date('2026-11-22T05:30:00Z'); // Sun 12:30 WIB
  assert.equal(isLunchHour('Asia/Jakarta', sunday), false);
  assert.equal(isLunchHour('Asia/Jakarta', sunday, { activeWork: true }), true);
  assert.equal(isLunchHour('Asia/Jakarta', sunday, { extraWorkDates: ['2026-11-22'] }), true);

  const monday1230 = new Date('2026-11-23T05:30:00Z'); // Mon 12:30 WIB
  assert.equal(isLunchHour('Asia/Jakarta', monday1230), true);
  assert.equal(isLunchHour('Asia/Jakarta', monday1230, { holidays: ['2026-11-23'] }), false);
  assert.equal(isLunchHour('Asia/Jakarta', monday1230, { holidays: ['2026-11-23'], activeWork: true }), true);
  assert.equal(isLunchHour('UTC', monday1230, { activeWork: true }), false);

  // 13:14 WIB is still lunch; 13:15 WIB returns to working hours
  assert.equal(isLunchHour('Asia/Jakarta', new Date('2026-11-23T06:14:00Z')), true);
  assert.equal(isLunchHour('Asia/Jakarta', new Date('2026-11-23T06:15:00Z')), false);
});

test('office clock enforces 08:00-17:30 weekdays, weekends, and Indonesian national holidays', () => {
  // Wednesday 06:24 WIB -> before_hours (off-duty)
  const early = getOfficeClockStatus('Asia/Jakarta', new Date('2026-11-24T23:24:00Z'));
  assert.equal(early.phase, 'before_hours');
  assert.equal(early.inWorkHours, false);
  assert.equal(isWorkingHours('Asia/Jakarta', new Date('2026-11-24T23:24:00Z')), false);

  // Wednesday 08:00 WIB -> working
  const start = getOfficeClockStatus('Asia/Jakarta', new Date('2026-11-25T01:00:00Z'));
  assert.equal(start.phase, 'working');
  assert.equal(start.inWorkHours, true);

  // Wednesday 12:30 WIB -> lunch
  const lunch = getOfficeClockStatus('Asia/Jakarta', new Date('2026-11-25T05:30:00Z'));
  assert.equal(lunch.phase, 'lunch');
  assert.equal(lunch.isLunch, true);
  assert.equal(lunch.inWorkHours, true);

  // Wednesday 17:29 WIB -> working; 17:30 WIB -> after_hours
  assert.equal(getOfficeClockStatus('Asia/Jakarta', new Date('2026-11-25T10:29:00Z')).phase, 'working');
  assert.equal(getOfficeClockStatus('Asia/Jakarta', new Date('2026-11-25T10:30:00Z')).phase, 'after_hours');

  // Saturday -> weekend
  assert.equal(getOfficeClockStatus('Asia/Jakarta', new Date('2026-11-28T03:00:00Z')).phase, 'weekend');

  // National holiday (17 Aug 2026 Monday) -> holiday; overridable by extraWorkDates
  const hutRi = getOfficeClockStatus('Asia/Jakarta', new Date('2026-08-17T03:00:00Z'));
  assert.equal(hutRi.phase, 'holiday');
  assert.equal(hutRi.isHoliday, true);
  assert.match(hutRi.holidayName ?? '', /Kemerdekaan/);
  assert.equal(getOfficeClockStatus('Asia/Jakarta', new Date('2026-08-17T03:00:00Z'), { extraWorkDates: ['2026-08-17'] }).phase, 'working');
});
