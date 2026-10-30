import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../js/store.js';
import { createMemoryAdapter } from '../../js/db.js';
import { createBus } from '../../js/bus.js';
import { recipeAsFood, perForServing, servingOptions } from '../../js/nutrition.js';

let t = 1_000_000;
const mk = (opts = {}) => {
  let n = 0;
  const bus = createBus();
  const s = createStore({ adapter: createMemoryAdapter(), bus, clock: () => ++t, uuid: () => `id${++n}`, ...opts });
  return { s, bus };
};
const banana = { key: 'usda:1', name: 'Bananas, raw', brand: '', source: 'usda', per100g: { kcal: 89, protein: 1.09 }, servings: [{ label: '1 medium', grams: 118 }] };
const entry = (over = {}) => ({ date: '2026-10-23', meal: 0, foodKey: 'usda:1', name: 'Bananas, raw', serving: { label: '1 medium', grams: 118 }, qty: 1, per: { kcal: 105.02, protein: 1.286 }, ...over });

test('defaults, settings merge and persistence', async () => {
  const { s } = mk();
  const d = await s.getSettings();
  assert.equal(d.units.weight, 'lb');
  assert.equal(d.onboarded, false);
  assert.deepEqual(d.mealNames, ['Breakfast', 'Lunch', 'Dinner', 'Snacks']);
  const n = await s.saveSettings({ units: { weight: 'kg' }, sex: 'female', onboarded: true });
  assert.equal(n.units.weight, 'kg');
  assert.equal(n.units.height, 'ftin', 'partial units merge');
  assert.equal((await s.getSettings()).sex, 'female');
  const n2 = await s.saveSettings({ macroPct: { protein: 30, carbs: 40, fat: 30 } });
  assert.equal(n2.macroPct.protein, 30);
  assert.equal(n2.sex, 'female', 'earlier fields survive');
});

test('food logs: add, query by date, update, delete + restore', async () => {
  const { s, bus } = mk();
  const events = [];
  bus.on('change:*', (p) => events.push(p.collection));
  const a = await s.addLog(entry());
  assert.equal(a.id, 'id1');
  assert.ok(!('_dirty' in a), 'UI never sees _dirty');
  assert.equal(a.deleted, false);
  await s.addLog(entry({ meal: 1, name: 'Lunch thing' }));
  await s.addLog(entry({ date: '2026-10-22' }));
  assert.equal((await s.logsForDate('2026-10-23')).length, 2);
  assert.equal((await s.logsInRange('2026-10-22', '2026-10-23')).length, 3);
  const u = await s.updateLog(a.id, { qty: 2 });
  assert.equal(u.qty, 2);
  assert.ok(u.updatedAt > a.updatedAt);
  const prev = await s.deleteLog(a.id);
  assert.equal(prev.qty, 2, 'delete returns the previous record for Undo');
  assert.equal((await s.logsForDate('2026-10-23')).length, 1);
  assert.equal(await s.deleteLog(a.id), null, 'second delete is a no-op');
  await s.restoreLog(prev);
  assert.equal((await s.logsForDate('2026-10-23')).length, 2);
  assert.ok(events.includes('foodLogs'));
  const raw = await s.adapter.get('foodLogs', a.id);
  assert.equal(raw._dirty, 1);
});

test('tombstones are kept for sync but hidden from every query', async () => {
  const { s } = mk();
  const a = await s.addLog(entry());
  await s.deleteLog(a.id);
  const raw = await s.adapter.get('foodLogs', a.id);
  assert.equal(raw.deleted, true);
  assert.equal((await s.logsInRange('2000-01-01', '2100-01-01')).length, 0);
  assert.equal((await s.exportAll()).collections.foodLogs.length, 0);
});

test('validation: bad qty / missing name rejected; per sanitised', async () => {
  const { s } = mk();
  await assert.rejects(() => s.addLog(entry({ qty: 0 })), /greater than zero/);
  await assert.rejects(() => s.addLog(entry({ qty: NaN })), /greater than zero/);
  await assert.rejects(() => s.addLog(entry({ name: '' })), /name/);
  const a = await s.addLog(entry({ per: { kcal: 50, bogus: 1, protein: NaN } }));
  assert.equal(a.per.kcal, 50);
  assert.equal(a.per.protein, null);
  assert.ok(!('bogus' in a.per));
  assert.equal(Object.keys(a.per).length, 16);
  await assert.rejects(() => s.updateLog(a.id, { qty: -1 }), /greater than zero/);
  await assert.rejects(() => s.updateLog('nope', { qty: 1 }), /not found/);
});

test('updatedAt is strictly increasing even if the clock stands still or goes back', async () => {
  const { s } = mk({ clock: () => 5000 });
  const a = await s.addLog(entry());
  const b = await s.updateLog(a.id, { qty: 2 });
  const c = await s.updateLog(a.id, { qty: 3 });
  assert.ok(b.updatedAt > a.updatedAt && c.updatedAt > b.updatedAt);
});

test('exercise, weight, water, notes', async () => {
  const { s } = mk();
  const e = await s.addExercise({ date: '2026-10-23', name: 'Running', minutes: 30, kcal: 320.4, met: 8 });
  assert.equal(e.kcal, 320);
  await s.updateExercise(e.id, { kcal: 300 });
  assert.equal((await s.exerciseForDate('2026-10-23'))[0].kcal, 300);
  const prev = await s.deleteExercise(e.id);
  assert.equal((await s.exerciseForDate('2026-10-23')).length, 0);
  await s.restoreExercise(prev);
  assert.equal((await s.exerciseForDate('2026-10-23')).length, 1);

  await s.setWeight('2026-10-20', 80);
  await s.setWeight('2026-10-23', 79.5);
  await s.setWeight('2026-10-23', 79.2);
  assert.equal(await s.getWeight('2026-10-23'), 79.2);
  assert.equal(await s.getWeight('2026-10-01'), null);
  assert.deepEqual((await s.allWeights()).map((w) => w.kg), [80, 79.2]);
  assert.equal((await s.weightsInRange('2026-10-21', '2026-10-31')).length, 1);
  await s.deleteWeight('2026-10-23');
  assert.equal(await s.getWeight('2026-10-23'), null);
  await s.setWeight('2026-10-23', 78);
  assert.equal(await s.getWeight('2026-10-23'), 78, 'set after delete revives the date');
  await assert.rejects(() => s.setWeight('2026-10-24', 0), /positive/);

  assert.equal(await s.getWater('2026-10-23'), 0);
  await s.addWater('2026-10-23', 250);
  await Promise.all([s.addWater('2026-10-23', 250), s.addWater('2026-10-23', 250)]);
  assert.equal(await s.getWater('2026-10-23'), 750, 'rapid taps do not lose updates');
  await s.addWater('2026-10-23', -5000);
  assert.equal(await s.getWater('2026-10-23'), 0);
  await s.setWater('2026-10-23', 1500);
  assert.equal(await s.getWater('2026-10-23'), 1500);

  assert.equal(await s.getNote('2026-10-23'), '');
  await s.setNote('2026-10-23', 'felt good');
  assert.equal(await s.getNote('2026-10-23'), 'felt good');
  await s.setNote('2026-10-23', '   ');
  assert.equal(await s.getNote('2026-10-23'), '');
});

test('custom foods, recipes, meals CRUD', async () => {
  const { s } = mk();
  const cf = await s.saveCustomFood({ name: 'Protein bar', brand: 'Acme', servings: [{ label: '1 bar', grams: 60, per: { kcal: 200, protein: 20 } }], per100g: { kcal: 333 } });
  assert.equal((await s.listCustomFoods())[0].name, 'Protein bar');
  await assert.rejects(() => s.saveCustomFood({ name: '', servings: [] }), /Name/);
  await assert.rejects(() => s.saveCustomFood({ name: 'x', servings: [] }), /serving/);
  await s.saveCustomFood({ ...cf, name: 'Protein bar v2' });
  assert.equal((await s.listCustomFoods()).length, 1);
  assert.equal((await s.getCustomFood(cf.id)).name, 'Protein bar v2');
  const fixed = await s.saveCustomFood({ name: 'Scanned bar', barcode: '0016000504622x', servings: [{ label: '1 bar', grams: 40, per: { kcal: 150 } }] });
  assert.equal((await s.getCustomFood(fixed.id)).barcode, '0016000504622', 'barcode kept, digits only');
  await s.deleteCustomFood(fixed.id);

  const r = await s.saveRecipe({ name: 'Oats', servings: 2, cookedGrams: 400, ingredients: [{ foodKey: 'usda:1', name: 'Banana', serving: { label: '1 medium', grams: 118 }, qty: 2, per: { kcal: 100 } }] });
  assert.equal(r.ingredients[0].qty, 2);
  await assert.rejects(() => s.saveRecipe({ name: 'x', servings: 0 }), /Servings/);
  const food = recipeAsFood(r);
  assert.equal(perForServing(food, servingOptions(food)[0]).kcal, 100);
  const m = await s.saveMeal({ name: 'Usual breakfast', items: [{ foodKey: 'usda:1', name: 'Banana', serving: { label: '1 medium' }, qty: 1, per: { kcal: 105 } }] });
  assert.equal((await s.listMeals()).length, 1);
  await s.deleteMeal(m.id);
  assert.equal((await s.listMeals()).length, 0);
  await s.deleteRecipe(r.id);
  await s.deleteCustomFood(cf.id);
  assert.equal((await s.listRecipes()).length + (await s.listCustomFoods()).length, 0);
});

test('foodMeta: recents, frequent, favorites; custom/recipe deletes drop their meta', async () => {
  const { s } = mk();
  const apple = { ...banana, key: 'usda:2', name: 'Apples, raw' };
  await s.touchFoodMeta(banana, banana.servings[0], 1);
  await s.touchFoodMeta(apple, apple.servings[0], 2);
  await s.touchFoodMeta(banana, banana.servings[0], 1.5);
  await s.touchFoodMeta({ key: 'quick', name: 'Quick' }, {}, 1);
  const recent = await s.recentFoods(10);
  assert.deepEqual(recent.map((m) => m.id), ['usda:1', 'usda:2']);
  assert.equal(recent[0].lastServing.qty, 1.5);
  assert.equal(recent[0].food.name, 'Bananas, raw');
  assert.equal((await s.frequentFoods(10))[0].id, 'usda:1');
  assert.equal(await s.toggleFavorite(apple), true);
  assert.deepEqual((await s.favorites()).map((m) => m.id), ['usda:2']);
  assert.equal(await s.toggleFavorite(apple), false);
  assert.equal((await s.favorites()).length, 0);
  assert.equal(await s.toggleFavorite(banana), true);
  assert.equal((await s.getFoodMeta('usda:1')).useCount, 2, 'favoriting keeps use count');
  const cf = await s.saveCustomFood({ name: 'Mine', servings: [{ label: '1', grams: null, per: { kcal: 10 } }] });
  await s.touchFoodMeta({ key: `custom:${cf.id}`, name: 'Mine', source: 'custom', servings: cf.servings }, cf.servings[0], 1);
  await s.deleteCustomFood(cf.id);
  assert.equal(await s.getFoodMeta(`custom:${cf.id}`), null);
});

test('copyMeal / copyDay / clearMeal', async () => {
  const { s } = mk();
  await s.addLog(entry({ date: '2026-10-22', meal: 0, name: 'A' }));
  await s.addLog(entry({ date: '2026-10-22', meal: 0, name: 'B' }));
  await s.addLog(entry({ date: '2026-10-22', meal: 2, name: 'C' }));
  assert.equal(await s.copyMeal('2026-10-22', 0, '2026-10-23', 1), 2);
  const day = await s.logsForDate('2026-10-23');
  assert.deepEqual(day.map((l) => [l.name, l.meal]), [['A', 1], ['B', 1]]);
  assert.equal(await s.copyDay('2026-10-22', '2026-10-24'), 3);
  assert.deepEqual((await s.logsForDate('2026-10-24')).map((l) => l.name).sort(), ['A', 'B', 'C']);
  const cleared = await s.clearMeal('2026-10-24', 0);
  assert.equal(cleared.length, 2);
  assert.equal((await s.logsForDate('2026-10-24')).length, 1);
  assert.equal(await s.copyMeal('2026-10-01', 0, '2026-10-02', 0), 0);
  assert.ok((await s.loggedDates('2026-10-01', '2026-10-31')).has('2026-10-22'));
});

test('copyLog copies one entry to another day and meal as a new row', async () => {
  const { s } = mk();
  const a = await s.addLog(entry({ date: '2026-10-22', meal: 0, name: 'A', qty: 2 }));
  await s.addLog(entry({ date: '2026-10-22', meal: 0, name: 'B' }));
  const c = await s.copyLog(a.id, '2026-10-25', 2);
  assert.notEqual(c.id, a.id);
  assert.deepEqual((await s.logsForDate('2026-10-25')).map((l) => [l.name, l.meal, l.qty]), [['A', 2, 2]]);
  assert.equal((await s.logsForDate('2026-10-22')).length, 2, 'the original stays');
  assert.deepEqual(c.per, a.per);
  await s.deleteLog(c.id); // Undo
  assert.equal((await s.logsForDate('2026-10-25')).length, 0);
  await s.deleteLog(a.id);
  await assert.rejects(() => s.copyLog(a.id, '2026-10-25', 0), /not found/);
});

test('copyDay can add to or replace what is already on the target day, and the replaced rows come back with restoreLog', async () => {
  const { s } = mk();
  await s.addLog(entry({ date: '2026-10-22', meal: 0, name: 'A' }));
  await s.addLog(entry({ date: '2026-10-22', meal: 2, name: 'B' }));
  await s.addLog(entry({ date: '2026-10-23', meal: 1, name: 'Old' }));
  // default: add
  assert.equal(await s.copyDay('2026-10-22', '2026-10-23'), 2);
  assert.deepEqual((await s.logsForDate('2026-10-23')).map((l) => l.name).sort(), ['A', 'B', 'Old']);
  // replace: the old rows go, the copies stay; Undo = delete the copies and restore the old rows
  const before = await s.logsForDate('2026-10-23');
  assert.equal(await s.copyDay('2026-10-22', '2026-10-23', { replace: true }), 2);
  const after = await s.logsForDate('2026-10-23');
  assert.deepEqual(after.map((l) => l.name).sort(), ['A', 'B']);
  assert.ok(after.every((l) => !before.some((b) => b.id === l.id)), 'replaced rows are new rows');
  for (const l of after) await s.deleteLog(l.id);
  for (const l of before) await s.restoreLog(l);
  assert.deepEqual((await s.logsForDate('2026-10-23')).map((l) => l.name).sort(), ['A', 'B', 'Old']);
  // an empty source never wipes the target, and replacing a day with itself changes nothing
  assert.equal(await s.copyDay('2026-10-01', '2026-10-23', { replace: true }), 0);
  assert.equal((await s.logsForDate('2026-10-23')).length, 3);
  assert.equal(await s.copyDay('2026-10-23', '2026-10-23', { replace: true }), 3);
  assert.equal((await s.logsForDate('2026-10-23')).length, 6);
});

test('export -> import round trip (merge and replace)', async () => {
  const a = mk().s;
  await a.saveSettings({ onboarded: true, sex: 'female' });
  const l = await a.addLog(entry());
  await a.setWeight('2026-10-23', 80);
  await a.addWater('2026-10-23', 500);
  await a.saveCustomFood({ name: 'Mine', servings: [{ label: '1', grams: null, per: { kcal: 10 } }] });
  const deleted = await a.addLog(entry({ name: 'gone' }));
  await a.deleteLog(deleted.id);
  const dump = JSON.parse(JSON.stringify(await a.exportAll()));

  const b = mk().s;
  const res = await b.importAll(dump, { mode: 'merge' });
  assert.ok(res.imported >= 5);
  assert.equal((await b.logsForDate('2026-10-23')).length, 1);
  assert.equal((await b.logsForDate('2026-10-23'))[0].id, l.id);
  assert.equal(await b.getWeight('2026-10-23'), 80);
  assert.equal(await b.getWater('2026-10-23'), 500);
  assert.equal((await b.getSettings()).sex, 'female');
  assert.equal((await b.listCustomFoods()).length, 1);
  assert.equal((await b.dirtyRecords()).length > 0, true, 'imports are queued for sync');

  // merge keeps a newer local edit
  await b.updateLog(l.id, { qty: 3 });
  const again = await b.importAll(dump, { mode: 'merge' });
  assert.equal((await b.logsForDate('2026-10-23'))[0].qty, 3);
  assert.ok(again.kept >= 1);

  // replace tombstones what is not in the file and takes the file's values
  await b.addLog(entry({ name: 'extra', date: '2026-10-25' }));
  await b.importAll(dump, { mode: 'replace' });
  assert.equal((await b.logsInRange('2026-10-01', '2026-10-31')).length, 1);
  assert.equal((await b.logsForDate('2026-10-23'))[0].qty, 1);

  await assert.rejects(() => b.importAll({ nope: 1 }), /not an Intake backup/);
});

test('eraseAll clears everything and signals', async () => {
  const { s, bus } = mk();
  let erased = 0;
  bus.on('store:erased', () => erased++);
  await s.addLog(entry());
  await s.setMeta('cursor:u:foodLogs', 5);
  await s.eraseAll();
  assert.equal(erased, 1);
  assert.equal((await s.logsInRange('2000-01-01', '2100-01-01')).length, 0);
  assert.equal(await s.getMeta('cursor:u:foodLogs'), undefined);
  assert.equal(await s.hasLocalData(), false);
});

test('import: a profile-less settings record (Skip setup) does not shadow the backup profile', async () => {
  const a = mk().s;
  await a.saveSettings({ birthYear: 1990, heightCm: 178, sex: 'female', onboarded: true });
  const dump = JSON.parse(JSON.stringify(await a.exportAll()));
  const b = mk().s;
  await b.saveSettings({ onboarded: true }); // fresh install, user tapped Skip setup: newer than the backup
  await b.importAll(dump, { mode: 'merge' });
  const st = await b.getSettings();
  assert.equal(st.birthYear, 1990);
  assert.equal(st.sex, 'female');
  // but a profile the user really entered locally still wins over an older backup
  const c = mk().s;
  await c.saveSettings({ birthYear: 1985, onboarded: true });
  await c.importAll(dump, { mode: 'merge' });
  assert.equal((await c.getSettings()).birthYear, 1985);
});
