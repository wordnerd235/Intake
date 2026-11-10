// Total sugars vs added sugars: the migration of old data, every source's mapping, and the limit/color logic.
// `sugar` is TOTAL sugars (and always was); `addedSugar` is new and null (not listed) unless a source gives it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../js/store.js';
import { createMemoryAdapter } from '../../js/db.js';
import { createBus } from '../../js/bus.js';
import { NUTRIENTS, NUTRIENT_INFO, migrateProfile, resolveTargets, sumNutrients, sumEntries, recipeNutrition, targetStatus, ADDED_SUGAR_DV } from '../../js/nutrition.js';
import { nutrientRow } from '../../js/nutrient-rows.js';
import { normalizeOFF, offNutrients, fdcNutrients, normalizeFDC } from '../../js/normalize.js';
import { parseNutritionLabel } from '../../js/label-parse.js';
import { parseEstimate, itemNutrients, SCHEMA, PROMPT } from '../../js/meal-photo-core.js';
import { parseBackup, foodLogCsv } from '../../js/backup.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
let clock = 5_000_000;
const mk = () => {
  let n = 0;
  return createStore({ adapter: createMemoryAdapter(), bus: createBus(), clock: () => ++clock, uuid: () => `id${++n}` });
};

// ---------- names and schema ----------

test('two nutrients: total sugars (the old `sugar` key) and added sugars', () => {
  assert.ok(NUTRIENTS.includes('sugar') && NUTRIENTS.includes('addedSugar'));
  assert.equal(NUTRIENTS.indexOf('addedSugar'), NUTRIENTS.indexOf('sugar') + 1, 'listed right under total sugars');
  assert.equal(NUTRIENT_INFO.sugar.label, 'Total sugars');
  assert.equal(NUTRIENT_INFO.addedSugar.label, 'Added sugars');
  assert.equal(NUTRIENT_INFO.addedSugar.unit, 'g');
});

// ---------- migration: settings ----------

test('migrateProfile: an old Sugars limit moves to added sugars; total sugars keeps no target', () => {
  assert.deepEqual(migrateProfile({ sex: 'male', nutrientTargets: { sugar: 40, sodium: 1500 } }), { sex: 'male', nutrientTargets: { addedSugar: 40, sodium: 1500 } });
  assert.deepEqual(migrateProfile({ nutrientTargets: { sugar: 40, addedSugar: 25 } }).nutrientTargets, { addedSugar: 25 }, 'an added-sugars target already set wins');
  assert.deepEqual(migrateProfile({ nutrientTargets: { sugar: null } }).nutrientTargets, {}, 'an empty old value is just dropped');
  assert.deepEqual(migrateProfile({ nutrientTargets: { sugar: 0 } }).nutrientTargets, {});
  const plain = { nutrientTargets: { sodium: 1500 } };
  assert.equal(migrateProfile(plain), plain, 'nothing to do: same object back');
  assert.equal(migrateProfile({}).nutrientTargets, undefined);
  assert.equal(migrateProfile(null), null);
  const once = migrateProfile({ nutrientTargets: { sugar: 30 } });
  assert.deepEqual(migrateProfile(once), once, 'idempotent');
});

test('resolveTargets: added sugars default to the 50 g Daily Value; total sugars never get a target', () => {
  const p = { sex: 'female', macroPct: { protein: 25, carbs: 45, fat: 30 }, nutrientTargets: {} };
  assert.equal(ADDED_SUGAR_DV, 50);
  assert.deepEqual(resolveTargets(p, 1800).addedSugar, { value: 50, kind: 'limit' });
  assert.deepEqual(resolveTargets(p, 1800).sugar, { value: null, kind: null });
  assert.deepEqual(resolveTargets({ ...p, nutrientTargets: { sugar: 90 } }, 1800).sugar, { value: null, kind: null }, 'not even by an override');
  assert.deepEqual(resolveTargets({ ...p, nutrientTargets: { sugar: 30 } }, 1800).addedSugar, { value: 30, kind: 'limit' }, 'the old limit is honored as an added-sugars limit');
});

test('store: an old settings record with a Sugars limit reads as an added-sugars limit and saves that way', async () => {
  const s = mk();
  await s.adapter.put('settings', { id: 'profile', updatedAt: 1, deleted: false, sex: 'male', nutrientTargets: { sugar: 36, sodium: 2000 } });
  const got = await s.getSettings();
  assert.deepEqual(got.nutrientTargets, { addedSugar: 36, sodium: 2000 });
  await s.saveSettings({ theme: 'dark' });
  const raw = await s.adapter.get('settings', 'profile');
  assert.deepEqual(raw.nutrientTargets, { addedSugar: 36, sodium: 2000 }, 'the next save stores the migrated shape');
  await s.saveSettings({ nutrientTargets: {} });
  assert.deepEqual((await s.getSettings()).nutrientTargets, {}, 'clearing it sticks (the old key is gone, so it cannot come back)');
});

// ---------- migration: logs, foods and backups ----------

/** A backup file as the app wrote it before added sugars existed. */
const OLD_BACKUP = {
  app: 'intake', version: 1, exportedAt: 1_700_000_000_000,
  collections: {
    settings: [{ id: 'profile', updatedAt: 10, sex: 'female', birthYear: 1990, heightCm: 165, nutrientTargets: { sugar: 45 } }],
    foodLogs: [
      { id: 'l1', updatedAt: 10, date: '2026-10-01', meal: 0, foodKey: 'usda:173944', name: 'Bananas, raw', brand: '', serving: { label: '1 medium', grams: 118 }, qty: 1, per: { kcal: 105, protein: 1.3, carbs: 27, fat: 0.4, fiber: 3.1, sugar: 14.4, satFat: 0.1, transFat: null, cholesterol: 0, sodium: 1, potassium: 422, calcium: 6, iron: 0.3, vitA: 4, vitC: 10.3, vitD: 0 }, createdAt: 10 },
      { id: 'l2', updatedAt: 11, date: '2026-10-01', meal: 2, foodKey: 'custom:c1', name: 'Granola bar', brand: 'Home', serving: { label: '1 bar', grams: 40 }, qty: 2, per: { kcal: 190, carbs: 29, sugar: 12 }, createdAt: 11 },
    ],
    customFoods: [{ id: 'c1', updatedAt: 9, name: 'Granola bar', brand: 'Home', per100g: null, servings: [{ label: '1 bar', grams: 40, per: { kcal: 190, carbs: 29, sugar: 12 } }] }],
    recipes: [], meals: [], weights: [], water: [], notes: [], exerciseLogs: [], foodMeta: [],
  },
};

test('old backup: still accepted; every old sugar value is total sugars; added sugars are not listed (never 0)', async () => {
  const parsed = parseBackup(OLD_BACKUP);
  assert.ok(parsed.ok, 'version 1 files import as before');
  const s = mk();
  const res = await s.importAll(JSON.parse(JSON.stringify(OLD_BACKUP)));
  assert.equal(res.imported, 4);
  const logs = await s.logsForDate('2026-10-01');
  assert.equal(logs.length, 2);
  const sum = sumEntries(logs);
  near(sum.total.sugar, 14.4 + 24, 1e-9);
  assert.equal(sum.total.addedSugar, 0, 'nothing is counted toward the added-sugars total');
  assert.equal(sum.unknown.addedSugar, true);
  assert.equal(sum.missing.addedSugar, 2, 'both foods are "not listed"');
  assert.equal(sum.count, 2);
  const targets = resolveTargets(await s.getSettings(), 1800);
  assert.deepEqual(targets.addedSugar, { value: 45, kind: 'limit' }, "the backup's Sugars limit applies to added sugars");
  assert.equal(nutrientRow('addedSugar', sum, targets).status, '', 'no green "under limit" claim while nothing reported added sugars');
  const [cf] = await s.listCustomFoods();
  assert.equal(cf.servings[0].per.sugar, 12);
  assert.ok(!('addedSugar' in cf.servings[0].per) || cf.servings[0].per.addedSugar == null);
});

test('store sanitizing: a new entry keeps added sugars; an entry without them stores null, not 0', async () => {
  const s = mk();
  const a = await s.addLog({ date: '2026-10-02', meal: 0, foodKey: 'quick', name: 'Soda', serving: { label: '1 can', grams: 355 }, qty: 1, per: { kcal: 140, sugar: 39, addedSugar: 39 } });
  assert.equal(a.per.sugar, 39);
  assert.equal(a.per.addedSugar, 39);
  const b = await s.addLog({ date: '2026-10-02', meal: 0, foodKey: 'quick', name: 'Apple', serving: { label: '1', grams: 180 }, qty: 1, per: { kcal: 95, sugar: 19 } });
  assert.equal(b.per.addedSugar, null);
  const c = await s.addLog({ date: '2026-10-02', meal: 0, foodKey: 'quick', name: 'Water', serving: { label: '1', grams: 240 }, qty: 1, per: { kcal: 0, sugar: 0, addedSugar: 0 } });
  assert.equal(c.per.addedSugar, 0, 'a real 0 stays 0');
  const dump = JSON.parse(JSON.stringify(await s.exportAll()));
  const s2 = mk();
  await s2.importAll(dump);
  const round = await s2.logsForDate('2026-10-02');
  assert.deepEqual(round.map((e) => e.per.addedSugar).sort(), [0, 39, null].sort(), 'backup round trip keeps known, zero and not listed apart');
});

test('sumNutrients counts the foods missing each nutrient', () => {
  const r = sumNutrients([{ kcal: 100, sugar: 10, addedSugar: 6 }, { kcal: 50, sugar: 5, addedSugar: null }, null]);
  assert.equal(r.total.addedSugar, 6);
  assert.equal(r.missing.addedSugar, 2);
  assert.equal(r.missing.sugar, 1);
  assert.equal(r.missing.kcal, 1);
  assert.equal(r.count, 3);
  assert.equal(sumNutrients([]).count, 0);
});

test('recipes: added sugars stay "not listed" unless every ingredient lists them', () => {
  const ing = (per, qty = 1) => ({ per, qty });
  const some = recipeNutrition({ servings: 2, cookedGrams: 400, ingredients: [ing({ kcal: 400, sugar: 20, addedSugar: 20 }), ing({ kcal: 100, sugar: 2 })] });
  assert.equal(some.perServing.addedSugar, null, 'a partial sum would be logged as a known amount');
  assert.equal(some.per100g.addedSugar, null);
  assert.equal(some.perServing.sugar, 11, 'total sugars keep the known sum as before');
  const all = recipeNutrition({ servings: 2, ingredients: [ing({ kcal: 400, sugar: 20, addedSugar: 20 }), ing({ kcal: 100, sugar: 2, addedSugar: 0 })] });
  assert.equal(all.perServing.addedSugar, 10);
});

// ---------- limit and color logic ----------

const T = { addedSugar: { value: 50, kind: 'limit' }, sugar: { value: null, kind: null }, sodium: { value: 2300, kind: 'limit' } };
const sumOf = (list) => sumNutrients(list);

test('added sugars: green while under (all foods listed), red once over, neutral with a note while some are not listed', () => {
  const under = nutrientRow('addedSugar', sumOf([{ sugar: 30, addedSugar: 20 }, { sugar: 10, addedSugar: 0 }]), T);
  assert.deepEqual(under, { status: 'under', bar: 40, text: '40% · under limit', note: '' });
  const over = nutrientRow('addedSugar', sumOf([{ sugar: 70, addedSugar: 60 }]), T);
  assert.equal(over.status, 'over');
  assert.equal(over.bar, 100, 'the bar stops at full');
  assert.equal(over.text, '120% · over limit');
  const overPartial = nutrientRow('addedSugar', sumOf([{ sugar: 70, addedSugar: 55 }, { sugar: 19, addedSugar: null }]), T);
  assert.equal(overPartial.status, 'over', 'over is over, even if another food did not say');
  assert.equal(overPartial.note, 'Not listed for 1 of 2 foods, so the real total may be higher.');
  const partial = nutrientRow('addedSugar', sumOf([{ sugar: 30, addedSugar: 12 }, { sugar: 19 }, { sugar: 1 }]), T);
  assert.equal(partial.status, '', 'not called "under" while foods are missing');
  assert.equal(partial.bar, 24);
  assert.equal(partial.text, '24%');
  assert.equal(partial.note, 'Not listed for 2 of 3 foods, so the real total may be higher.');
  assert.equal(nutrientRow('addedSugar', sumOf([{ sugar: 19 }, { sugar: 2 }]), T).note, 'None of these foods list added sugars.');
  assert.equal(nutrientRow('addedSugar', sumOf([{ sugar: 19 }]), T).note, "This food doesn't list added sugars.");
  assert.equal(nutrientRow('addedSugar', sumOf([]), T).note, '', 'an empty day has nothing to note');
  const exactly = nutrientRow('addedSugar', sumOf([{ sugar: 50, addedSugar: 50 }]), T);
  assert.equal(exactly.status, 'under', 'at the limit is not over');
});

test('total sugars: a plain bar (share of the day\'s carbs), never a limit color, however high', () => {
  const r = nutrientRow('sugar', { total: { sugar: 90, carbs: 120 }, unknown: {}, missing: {}, count: 1 }, T);
  assert.deepEqual(r, { status: '', bar: 75, text: '75% of carbs', note: '' });
  const huge = nutrientRow('sugar', { total: { sugar: 400, carbs: 300 }, unknown: {}, missing: {}, count: 1 }, { ...T, sugar: { value: 10, kind: 'limit' } });
  assert.equal(huge.status, '', 'even a stray target cannot color it');
  assert.equal(huge.bar, 100);
  assert.equal(nutrientRow('sugar', { total: { sugar: 10, carbs: 40 }, unknown: { sugar: true }, missing: { sugar: 1 }, count: 2 }, T).text, '≥ 25% of carbs');
  assert.deepEqual(nutrientRow('sugar', { total: { sugar: 0, carbs: 40 }, unknown: {}, count: 1 }, T), { status: '', bar: null, text: 'no target', note: '' });
  assert.equal(nutrientRow('sugar', { total: { sugar: 5, carbs: 0 }, unknown: {}, count: 1 }, T).bar, null);
});

test('other limits keep working as before', () => {
  assert.equal(nutrientRow('sodium', sumOf([{ sodium: 2400 }]), T).status, 'over');
  assert.equal(nutrientRow('sodium', sumOf([{ sodium: 400 }]), T).status, 'under');
  assert.equal(targetStatus(60, T.addedSugar), 'over');
  assert.equal(targetStatus(20, T.addedSugar, true), '');
});

// ---------- Open Food Facts ----------

const OFF_US = {
  code: '0044000000000', product_name: 'Sandwich cookies', brands: 'Example', serving_size: '3 cookies (34 g)', serving_quantity: 34,
  nutriments: { 'energy-kcal_100g': 471, carbohydrates_100g: 70.6, sugars_100g: 41.2, 'added-sugars_100g': 38.2, sodium_100g: 0.4 },
};

test('OFF: sugars_100g is total, added-sugars_100g is added', () => {
  const f = normalizeOFF(OFF_US);
  assert.equal(f.per100g.sugar, 41.2);
  assert.equal(f.per100g.addedSugar, 38.2);
});

test('OFF: no added-sugars value means not listed (null), not 0', () => {
  const f = normalizeOFF({ ...OFF_US, nutriments: { 'energy-kcal_100g': 539, sugars_100g: 56.3 } });
  assert.equal(f.per100g.sugar, 56.3);
  assert.equal(f.per100g.addedSugar, null);
  assert.equal(normalizeOFF({ ...OFF_US, nutriments: { 'energy-kcal_100g': 0, sugars_100g: 0, 'added-sugars_100g': 0 } }).per100g.addedSugar, 0, 'a listed 0 is 0');
});

test('OFF: values given only per serving are scaled to 100 g', () => {
  const nm = { 'energy-kcal_100g': 471, sugars_serving: 14, 'added-sugars_serving': 13 };
  const per = offNutrients(nm, 34);
  near(per.sugar, (14 * 100) / 34, 1e-3);
  near(per.addedSugar, (13 * 100) / 34, 1e-3);
  assert.equal(offNutrients(nm).addedSugar, null, 'without the serving weight it stays unknown');
  assert.equal(offNutrients({ ...nm, 'added-sugars_100g': 40 }, 34).addedSugar, 40, 'a per-100 g value wins');
  const f = normalizeOFF({ ...OFF_US, nutriments: nm });
  near(f.per100g.addedSugar, 38.235, 1e-3);
});

// ---------- USDA FoodData Central ----------

test('FDC: total = 269 / id 2000 (or 1063), added = 539 / id 1235', () => {
  const bySearch = fdcNutrients([
    { nutrientId: 1008, nutrientNumber: '208', unitName: 'KCAL', value: 480 },
    { nutrientId: 2000, nutrientNumber: '269', unitName: 'G', value: 35.3 },
    { nutrientId: 1235, nutrientNumber: '539', unitName: 'G', value: 32.4 },
  ]);
  assert.equal(bySearch.sugar, 35.3);
  assert.equal(bySearch.addedSugar, 32.4);
  const byDetail = fdcNutrients([
    { nutrient: { id: 1008, number: '208', unitName: 'kcal' }, amount: 100 },
    { nutrient: { id: 1063, number: '269.3', unitName: 'g' }, amount: 8 },
    { nutrient: { id: 1235, number: '539', unitName: 'g' }, amount: 4 },
  ]);
  assert.equal(byDetail.sugar, 8, 'Sugars, Total NLEA by id');
  assert.equal(byDetail.addedSugar, 4, 'food-detail rows nest the id and number');
  const noAdded = fdcNutrients([{ nutrientId: 1008, unitName: 'KCAL', value: 89 }, { nutrientNumber: '269', unitName: 'G', value: 12.2 }]);
  assert.equal(noAdded.sugar, 12.2);
  assert.equal(noAdded.addedSugar, null, 'not listed');
  const mg = fdcNutrients([{ nutrientId: 1008, unitName: 'KCAL', value: 10 }, { nutrientId: 1235, unitName: 'MG', value: 1500 }]);
  assert.equal(mg.addedSugar, 1.5, 'converted to grams');
  const f = normalizeFDC({ fdcId: 1, description: 'COOKIES', foodNutrients: [{ nutrientId: 1008, unitName: 'KCAL', value: 480 }, { nutrientId: 1235, nutrientNumber: '539', unitName: 'G', value: 30 }] });
  assert.equal(f.per100g.addedSugar, 30);
});

// ---------- Nutrition Facts label ----------

test('label: "Total Sugars 12g / Includes 8g Added Sugars" -> both', () => {
  const r = parseNutritionLabel('Calories 200\nTotal Carbohydrate 37g 13%\nTotal Sugars 12g\nIncludes 8g Added Sugars 16%\nProtein 3g');
  assert.equal(r.per.sugar, 12);
  assert.equal(r.per.addedSugar, 8);
  assert.ok(r.found.includes('addedSugar'));
});

test('label: added sugars in the shapes labels and OCR produce', () => {
  const rows = [
    // [text, total, added]
    ['Total Sugars 12g Includes 10g Added Sugars 20%', 12, 10], // two rows read as one line
    ['Total Sugars 0g\nIncl. 0g Added Sugars 0%', 0, 0],
    ['Total Sugars 5g\nIncludes <1g Added Sugars 1%', 5, 1],
    ['Total Sugars 22g\nlncludes 109 Added Sugars 20%', 22, 10], // "I" read as "l", the "g" read as 9 (10 g = 20% of 50 g)
    ['Total Sugars 22g\nIncludes 18 g Added Sugars 36%', 22, 18],
    ['Total Sugars 22g\nIncludes 10g\nAdded Sugars 20%', 22, 10], // the words wrapped to the next line
    ['Sugars 15g\nAdded Sugars 9g 18%', 15, 9], // name first, amount after
    ['Total Sugars/Azucares Totales 14g\nIncludes/Incluye 12g Added Sugars/Azucares Anadidos 24%', 14, 12],
  ];
  for (const [text, total, added] of rows) {
    const r = parseNutritionLabel(text);
    assert.equal(r.per.sugar, total, `total in ${JSON.stringify(text)}`);
    assert.equal(r.per.addedSugar, added, `added in ${JSON.stringify(text)}`);
  }
});

test('label: added sugars stay unknown when the label has none, or when they cannot be right', () => {
  assert.equal(parseNutritionLabel('Calories 100\nTotal Sugars 6g\nProtein 2g').per.addedSugar, undefined, 'not on the label: left for the person');
  assert.equal(parseNutritionLabel('Calories 100\nTotal Sugars 6g\nIncludes 2g Sugar Alcohol').per.addedSugar, undefined, 'sugar alcohol is not added sugar');
  const bad = parseNutritionLabel('Calories 100\nTotal Sugars 6g\nIncludes 16g Added Sugars 32%');
  assert.equal(bad.per.sugar, 6);
  assert.equal(bad.per.addedSugar, undefined, 'more added than total: one is misread, so added is left blank to check');
  assert.ok(!bad.found.includes('addedSugar'));
  assert.equal(parseNutritionLabel('Total Sugars 6g\nIncludes Added Sugars').per.addedSugar, undefined, 'no amount read');
});

// ---------- Gemini meal photo ----------

test('meal photo: Gemini is asked for total and added sugars; added may be null', () => {
  const props = SCHEMA.properties.items.items.properties;
  assert.deepEqual(props.sugar, { type: 'NUMBER', nullable: true });
  assert.deepEqual(props.addedSugar, { type: 'NUMBER', nullable: true });
  assert.ok(!SCHEMA.properties.items.items.required.includes('addedSugar'), 'never forced to guess');
  assert.match(PROMPT, /addedSugar/);
  assert.match(PROMPT, /null when you can't reasonably tell/);
  const answer = { items: [
    { name: 'Lemonade', search: 'lemonade', grams: 240, kcal: 100, protein: 0, carbs: 26, fat: 0, sugar: 25, addedSugar: 23 },
    { name: 'Apple', search: 'apple raw', grams: 180, kcal: 95, protein: 0, carbs: 25, fat: 0, sugar: 19, addedSugar: null },
    { name: 'Cake', search: 'cake', grams: 100, kcal: 350, protein: 4, carbs: 50, fat: 15, sugar: 30, addedSugar: 45 },
    { name: 'Toast', search: 'toast', grams: 30, kcal: 80, protein: 3, carbs: 15, fat: 1 },
  ], note: '' };
  const { items } = parseEstimate(JSON.stringify(answer));
  assert.deepEqual(items.map((i) => [i.sugar, i.addedSugar]), [[25, 23], [19, null], [30, null], [null, null]], 'more added than total is dropped, not trusted');
  const n = itemNutrients(items[0], null, 480);
  assert.equal(n.sugar, 50);
  assert.equal(n.addedSugar, 46);
  assert.equal(itemNutrients(items[1], null, 90).addedSugar, null, 'unknown stays unknown when the grams change');
  const usda = { per100g: { kcal: 52, sugar: 10.4, addedSugar: null } };
  assert.equal(itemNutrients(items[1], usda, 100).addedSugar, null, 'a USDA match uses USDA (which lists no added sugars)');
});

// ---------- CSV export ----------

test('food log CSV has a total sugars and an added sugars column', () => {
  const csv = foodLogCsv([{ date: '2026-10-01', meal: 0, name: 'Soda', qty: 1, serving: { label: '1 can' }, per: { kcal: 140, sugar: 39, addedSugar: 39 } }, { date: '2026-10-01', meal: 0, name: 'Apple', qty: 1, serving: { label: '1' }, per: { kcal: 95, sugar: 19, addedSugar: null } }], ['B', 'L', 'D', 'S']);
  const [head, soda, apple] = csv.trim().split('\r\n').map((l) => l.split(','));
  const ti = head.indexOf('totalSugar');
  const ai = head.indexOf('addedSugar');
  assert.ok(ti > 0 && ai === ti + 1);
  assert.equal(soda[ti], '39');
  assert.equal(soda[ai], '39');
  assert.equal(apple[ai], '', 'not listed is blank, not 0');
});
