import test from 'node:test';
import assert from 'node:assert/strict';
import { isLunchHour } from '../lib/office-time';
test('lunch respects weekends, holidays, overtime and timezone', () => {
  const sunday = new Date('2026-11-22T05:30:00Z');
  assert.equal(isLunchHour('Asia/Jakarta', sunday), false);
  assert.equal(isLunchHour('Asia/Jakarta', sunday, { activeWork: true }), true);
  assert.equal(isLunchHour('Asia/Jakarta', sunday, { extraWorkDates: ['2026-11-22'] }), true);
  const monday = new Date('2026-11-23T05:30:00Z');
  assert.equal(isLunchHour('Asia/Jakarta', monday), true);
  assert.equal(isLunchHour('Asia/Jakarta', monday, { holidays: ['2026-11-23'] }), false);
  assert.equal(isLunchHour('Asia/Jakarta', monday, { holidays: ['2026-11-23'], activeWork: true }), true);
  assert.equal(isLunchHour('UTC', monday, { activeWork: true }), false);
});
