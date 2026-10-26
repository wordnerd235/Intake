import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBackup, parseBackup, csvField, toCsv, foodLogCsv, weightsCsv, dailyTotalsCsv } from '../../js/backup.js';
import { COLLECTIONS } from '../../js/sync-core.js';

const log = (id, date, meal, kcal) => ({ id, date, meal, name: 'Thing, "big"', brand: '', qty: 2, serving: { label: '1 cup', grams: 100 }, per: { kcal }, createdAt: 1, updatedAt: 5, deleted: false, _dirty: 1 });

test('backup drops tombstones and _dirty, parse validates', () => {
  const b = buildBackup({ foodLogs: [log('a', '2026-10-23', 0, 100), { ...log('b', '2026-10-23', 0, 50), deleted: true }], weights: [{ id: '2026-10-23', date: '2026-10-23', kg: 80, updatedAt: 3, deleted: false }] }, 123);
  assert.equal(b.app, 'intake');
  assert.equal(b.exportedAt, 123);
  assert.deepEqual(Object.keys(b.collections), COLLECTIONS);
  assert.equal(b.collections.foodLogs.length, 1);
  assert.ok(!('_dirty' in b.collections.foodLogs[0]));
  const p = parseBackup(JSON.parse(JSON.stringify(b)));
  assert.ok(p.ok);
  assert.equal(p.collections.foodLogs.length, 1);
  assert.equal(p.collections.foodLogs[0].id, 'a');
  assert.equal(p.collections.weights[0].kg, 80);
  assert.equal(p.skipped, 0);
});

test('parseBackup rejects foreign files and counts bad rows', () => {
  assert.equal(parseBackup(null).ok, false);
  assert.equal(parseBackup({ foo: 1 }).ok, false);
  assert.equal(parseBackup({ app: 'other', collections: {} }).ok, false);
  assert.equal(parseBackup({ app: 'intake', version: 99, collections: {} }).ok, false);
  const p = parseBackup({ app: 'intake', version: 1, collections: { foodLogs: [{ id: 'x', updatedAt: 1 }, { id: 5 }, null, { updatedAt: 3 }], bogus: [1] } });
  assert.ok(p.ok);
  assert.equal(p.collections.foodLogs.length, 1);
  assert.equal(p.skipped, 3);
  assert.equal(p.collections.bogus, undefined);
});

test('csv quoting and formula-injection guard', () => {
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvField('-5'), '-5');
  assert.equal(csvField(null), '');
  assert.equal(csvField('line\nbreak'), '"line\nbreak"');
  assert.equal(toCsv([['a', 'b'], [1, 2]]), 'a,b\r\n1,2\r\n');
});

test('food log, weights, daily CSVs', () => {
  const logs = [log('a', '2026-10-23', 1, 100), log('b', '2026-10-22', 0, 50)];
  const csv = foodLogCsv(logs, ['Breakfast', 'Lunch', 'Dinner', 'Snacks']);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^date,meal,food,brand,amount,unit,kcal,protein/);
  assert.match(lines[1], /^2026-10-22,Breakfast,"Thing, ""big""",,2,1 cup,100,/);
  const w = weightsCsv([{ date: '2026-10-23', kg: 80 }, { date: '2026-10-22', kg: 81.2 }]).trim().split('\r\n');
  assert.deepEqual(w, ['date,kg,lb', '2026-10-22,81.2,179', '2026-10-23,80,176.4']);
  const d = dailyTotalsCsv(logs, [{ date: '2026-10-23', kcal: 300 }]).trim().split('\r\n');
  assert.equal(d[2], '2026-10-23,200,0,0,0,300');
});
