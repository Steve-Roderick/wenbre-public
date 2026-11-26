import test from 'node:test';
import assert from 'node:assert/strict';
import { windowDates, roomToday, addDays } from '../src/server/dates.js';
import { calendarDate } from '../src/server/validation.js';

test('room-local midnight controls today regardless of UTC day', () => {
  assert.equal(roomToday('America/Toronto', new Date('2026-10-18T03:59:59Z')), '2026-10-17');
  assert.equal(roomToday('America/Toronto', new Date('2026-10-18T04:00:00Z')), '2026-10-18');
  assert.equal(roomToday('Pacific/Auckland', new Date('2026-12-31T12:00:00Z')), '2027-01-01');
});
test('ten unique calendar dates span DST, month, year and leap boundaries', () => {
  for (const [now, start] of [
    ['2026-03-07T17:00:00Z', '2026-03-07'], ['2026-10-31T16:00:00Z', '2026-10-31'],
    ['2026-12-29T17:00:00Z', '2026-12-29'], ['2028-02-27T17:00:00Z', '2028-02-27']
  ]) {
    const dates = windowDates('America/Toronto', new Date(now));
    assert.equal(dates.length, 10); assert.equal(new Set(dates).size, 10);
    assert.equal(dates[0], start); assert.equal(dates[9], addDays(start, 9));
    for (let i = 1; i < dates.length; i++) assert.equal(dates[i], addDays(dates[i - 1], 1));
  }
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});
test('date validation rejects malformed, expired and too-far-future dates', () => {
  const dates = windowDates('UTC', new Date('2026-10-17T12:00:00Z'));
  for (const value of ['2026-10-16', '2026-10-27', '2026-02-31', '17/10/2026', null]) {
    assert.throws(() => calendarDate(value, dates), (error) => error.status === 400);
  }
  assert.equal(calendarDate('2026-10-20', dates), '2026-10-20');
});
