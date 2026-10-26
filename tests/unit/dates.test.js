import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../../js/dates.js';

test('fmt/today use LOCAL fields, not UTC', () => {
  const d = new Date(2026, 9, 23, 23, 59, 59); // local 11:59pm
  assert.equal(D.today(d), '2026-10-23');
  assert.equal(D.fmt(new Date(2026, 0, 1, 0, 0, 1)), '2026-01-01');
});

test('addDays crosses month, year and leap boundaries', () => {
  assert.equal(D.addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(D.addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(D.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(D.addDays('2028-02-29', 1), '2028-03-01');
  assert.equal(D.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(D.addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(D.addDays('2026-10-23', 0), '2026-10-23');
  assert.equal(D.addDays('2026-10-23', 400), '2027-11-27');
});

test('DST transitions never skip or repeat a day (US 2026: Mar 8 spring-forward, Nov 1 fall-back)', () => {
  assert.equal(D.addDays('2026-03-07', 1), '2026-03-08');
  assert.equal(D.addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(D.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(D.addDays('2026-11-01', 1), '2026-11-02');
  assert.equal(D.diffDays('2026-03-01', '2026-03-15'), 14);
  assert.equal(D.diffDays('2026-10-25', '2026-11-08'), 14);
  const days = D.range('2026-03-06', '2026-03-10');
  assert.deepEqual(days, ['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10']);
  // parse() lands on local noon so a one-hour shift cannot change the date
  assert.equal(D.fmt(D.parse('2026-03-08')), '2026-03-08');
  assert.equal(D.fmt(D.parse('2026-11-01')), '2026-11-01');
});

test('diffDays and range', () => {
  assert.equal(D.diffDays('2026-10-23', '2026-10-23'), 0);
  assert.equal(D.diffDays('2026-10-23', '2026-10-22'), -1);
  assert.equal(D.diffDays('2025-12-31', '2026-01-01'), 1);
  assert.deepEqual(D.range('2026-10-23', '2026-10-22'), []);
  assert.equal(D.range('2026-01-01', '2026-12-31').length, 365);
});

test('isValid rejects impossible dates', () => {
  assert.ok(D.isValid('2026-02-28'));
  assert.ok(!D.isValid('2026-02-29'));
  assert.ok(D.isValid('2028-02-29'));
  assert.ok(!D.isValid('2026-13-01'));
  assert.ok(!D.isValid('2026-1-1'));
  assert.ok(!D.isValid(null));
  assert.equal(D.daysInMonth(2026, 2), 28);
  assert.equal(D.daysInMonth(2026, 12), 31);
});

test('labels', () => {
  assert.equal(D.weekdayLabel('2026-10-23'), 'Friday');
  assert.equal(D.weekdayLabel('2026-10-23', 'short'), 'Fri');
  assert.equal(D.formatDate('2026-10-23'), 'Fri, Oct 23');
  assert.equal(D.formatDate('2025-10-23', '2026-10-23'), 'Thu, Oct 23, 2025');
  assert.equal(D.relativeLabel('2026-10-23', '2026-10-23'), 'Today');
  assert.equal(D.relativeLabel('2026-10-22', '2026-10-23'), 'Yesterday');
  assert.equal(D.relativeLabel('2026-10-24', '2026-10-23'), 'Tomorrow');
  assert.equal(D.relativeLabel('2026-10-20', '2026-10-23'), 'Tue, Oct 20');
  assert.equal(D.formatShort('2026-02-01'), 'Feb 1');
});

test('mealForClock thresholds', () => {
  const at = (h, m) => D.mealForClock(new Date(2026, 9, 23, h, m));
  assert.equal(at(7, 0), 0);
  assert.equal(at(10, 29), 0);
  assert.equal(at(10, 30), 1);
  assert.equal(at(14, 59), 1);
  assert.equal(at(15, 0), 2);
  assert.equal(at(20, 29), 2);
  assert.equal(at(20, 30), 3);
  assert.equal(at(23, 59), 3);
});

test('streak counts back from today, or yesterday if today empty', () => {
  const s = new Set(['2026-10-23', '2026-10-22', '2026-10-21', '2026-10-19']);
  assert.equal(D.streak(s, '2026-10-23'), 3);
  assert.equal(D.streak(new Set(['2026-10-22', '2026-10-21']), '2026-10-23'), 2);
  assert.equal(D.streak(new Set(['2026-10-20']), '2026-10-23'), 0);
  assert.equal(D.streak([], '2026-10-23'), 0);
});

test('monthsAgo clamps to month length; age', () => {
  assert.equal(D.monthsAgo('2026-03-31', 1), '2026-02-28');
  assert.equal(D.monthsAgo('2026-01-15', 3), '2025-10-15');
  assert.equal(D.monthsAgo('2026-10-23', 12), '2025-10-23');
  assert.equal(D.ageFromBirthYear(1990, new Date(2026, 5, 1)), 36);
});

test('formatClock', () => {
  assert.equal(D.formatClock(new Date(2026, 9, 23, 15, 7).getTime()), '3:07 pm');
  assert.equal(D.formatClock(new Date(2026, 9, 23, 0, 5).getTime()), '12:05 am');
});

test('birthYearRange: ages 13 to 110 this year, recomputed per call', async () => {
  const { birthYearRange } = await import('../../js/dates.js');
  assert.deepEqual(birthYearRange(new Date(2026, 5, 1)), { min: 1916, max: 2013 });
  assert.deepEqual(birthYearRange(new Date(2027, 0, 1)), { min: 1917, max: 2014 }, 'a new year moves both limits');
});
