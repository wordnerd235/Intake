// Saved copies of commercial products (Recents/Favorites, recipe ingredients) gain added sugars without a rescan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../js/store.js';
import { createMemoryAdapter } from '../../js/db.js';
import { createBus } from '../../js/bus.js';
import { recipeNutrition, recipeAsFood } from '../../js/nutrition.js';
import { pendingKeys, fillIngredientAddedSugar, sugarMatches, metaNeedsRefresh, refreshSavedFoods, refreshMessage, REFRESH_META_KEY } from '../../js/food-refresh.js';
import { fetchSavedFood, foodFDC } from '../../js/online-foods.js';

let clock = 9_000_000;
const mk = () => {
  let n = 0;
  return createStore({ adapter: createMemoryAdapter(), bus: createBus(), clock: () => ++clock, uuid: () => `id${++n}` });
};
const noWait = async () => {};

/** A product as saved before added sugars existed (no addedSugar key at all). */
const OLD_BREAD = { key: 'off:0073130002005', name: 'Sourdough bread', brand: 'Bakery Co', source: 'off', per100g: { kcal: 250, carbs: 48, sugar: 4, fat: 2 }, servings: [{ label: '1 slice (50 g)', grams: 50 }] };
/** The same product looked up today. */
const FRESH_BREAD = { ...OLD_BREAD, per100g: { ...OLD_BREAD.per100g, addedSugar: 2 } };
const OLD_CHIPS = { key: 'fdc:2041155', name: 'Chocolate chips', brand: 'Choco', source: 'fdc', per100g: { kcal: 480, carbs: 64, sugar: 56, fat: 28 }, servings: [{ label: '1 tbsp (15 g)', grams: 15 }] };
const FRESH_CHIPS = { ...OLD_CHIPS, per100g: { ...OLD_CHIPS.per100g, addedSugar: 54 } };
const ing = (food, grams, qty = 1) => ({ foodKey: food.key, name: food.name, brand: food.brand, serving: { label: `${grams} g`, grams }, qty, per: Object.fromEntries(Object.entries(food.per100g).map(([k, v]) => [k, (v * grams) / 100])) });

test('which saved copies need a fresh lookup', () => {
  const metas = [
    { id: OLD_BREAD.key, food: OLD_BREAD },
    { id: 'off:111111', food: { ...OLD_BREAD, key: 'off:111111', per100g: { kcal: 1, addedSugar: 0 } } }, // already has it
    { id: 'usda:173944', food: { key: 'usda:173944', per100g: { kcal: 89, sugar: 12 } } }, // built-in list: nothing to fetch
    { id: 'custom:c1', food: { key: 'custom:c1', per100g: { kcal: 1 } } }, // your own food: never overwritten
    { id: 'off:222222', food: { key: 'off:222222', per100g: null, servings: [] } }, // no per-100 g numbers
  ];
  const recipes = [{ id: 'r1', ingredients: [ing(OLD_CHIPS, 30), ing(OLD_BREAD, 100), { foodKey: 'usda:1', serving: { grams: 50 }, per: { sugar: 1 } }] }];
  assert.deepEqual(pendingKeys(metas, recipes), ['off:0073130002005', 'fdc:2041155'], 'Recents first, each product once');
  assert.deepEqual(pendingKeys(metas, recipes, new Set(['off:0073130002005'])), ['fdc:2041155'], 'already looked up: skipped');
  assert.equal(metaNeedsRefresh({ id: OLD_BREAD.key, food: OLD_BREAD, deleted: true }), false);
});

test('a recipe ingredient gains added sugars only when it is safe', () => {
  const chips = ing(OLD_CHIPS, 30);
  const filled = fillIngredientAddedSugar(chips, FRESH_CHIPS);
  assert.equal(filled.per.addedSugar, 16.2, '54 g per 100 g x 30 g');
  assert.equal(filled.per.kcal, chips.per.kcal, 'nothing else changes');
  assert.equal(filled.per.sugar, chips.per.sugar);
  assert.equal(chips.per.addedSugar, undefined, 'the original is not mutated');
  assert.equal(fillIngredientAddedSugar(chips, { ...FRESH_CHIPS, per100g: { ...FRESH_CHIPS.per100g, sugar: 40, addedSugar: 38 } }), null, 'recipe changed (total sugars 56 -> 40): not filled');
  assert.equal(fillIngredientAddedSugar(chips, { ...FRESH_CHIPS, per100g: { ...FRESH_CHIPS.per100g, sugar: 57.5 } }).per.addedSugar, 16.2, 'rounding differences still match');
  assert.equal(fillIngredientAddedSugar(chips, OLD_CHIPS), null, 'the product still lists no added sugars');
  assert.equal(fillIngredientAddedSugar(chips, { ...FRESH_CHIPS, per100g: { ...FRESH_CHIPS.per100g, addedSugar: 70 } }), null, 'more added than total: bad data');
  assert.equal(fillIngredientAddedSugar({ ...chips, per: { ...chips.per, sugar: null } }, FRESH_CHIPS), null, 'no saved total to check against');
  assert.equal(fillIngredientAddedSugar({ ...chips, serving: { label: '1 cup', grams: null } }, FRESH_CHIPS), null, 'no weight to scale by');
  assert.equal(fillIngredientAddedSugar({ ...chips, per: { ...chips.per, addedSugar: 3 } }, FRESH_CHIPS), null, 'already known: left alone');
  assert.ok(sugarMatches(4, 4.2) && sugarMatches(0, 0.4) && !sugarMatches(4, 5) && !sugarMatches(null, 4));
});

/** A store holding what Caleb has: the bread in Recents and diary, two recipes with commercial ingredients. */
async function seeded() {
  const s = mk();
  await s.touchFoodMeta(OLD_BREAD, OLD_BREAD.servings[0], 2);
  await s.touchFoodMeta(OLD_BREAD, OLD_BREAD.servings[0], 2);
  await s.toggleFavorite(OLD_CHIPS);
  const log = await s.addLog({ date: '2026-11-01', meal: 0, foodKey: OLD_BREAD.key, name: OLD_BREAD.name, serving: OLD_BREAD.servings[0], qty: 2, per: { kcal: 125, sugar: 2 } });
  const cookies = await s.saveRecipe({ name: 'Cookies', servings: 10, ingredients: [ing(OLD_CHIPS, 150), { foodKey: 'usda:169761', name: 'Flour', brand: '', serving: { label: 'g', grams: 1 }, qty: 250, per: { kcal: 3.64, sugar: 0.003 } }] });
  const toast = await s.saveRecipe({ name: 'Choc toast', servings: 1, ingredients: [ing(OLD_BREAD, 50), ing(OLD_CHIPS, 15)] });
  return { s, log, cookies, toast };
}

test('one run fills Recents/Favorites and recipes; diary entries are not touched', async () => {
  const { s, log, cookies, toast } = await seeded();
  const asked = [];
  const fetchFood = async (key) => { asked.push(key); return { [OLD_BREAD.key]: FRESH_BREAD, [OLD_CHIPS.key]: FRESH_CHIPS }[key] || null; };
  const r = await refreshSavedFoods({ store: s, fetchFood, wait: noWait });
  assert.deepEqual(asked.sort(), [OLD_BREAD.key, OLD_CHIPS.key].sort());
  assert.deepEqual(r, { foods: 2, recipes: 2, pending: 0 });
  assert.equal(refreshMessage(r), 'Added sugars filled in for 2 saved foods and 2 recipes.');
  const bread = await s.getFoodMeta(OLD_BREAD.key);
  assert.equal(bread.food.per100g.addedSugar, 2, 'Recents now has added sugars');
  assert.equal(bread.useCount, 2, 'use count kept');
  assert.equal(bread.lastServing.qty, 2, 'last serving kept');
  assert.equal((await s.getFoodMeta(OLD_CHIPS.key)).favorite, true, 'still a favorite');
  assert.equal((await s.getFoodMeta(OLD_CHIPS.key)).food.per100g.addedSugar, 54);
  const [entry] = await s.logsForDate('2026-11-01');
  assert.equal(entry.per.addedSugar, null, 'the diary entry keeps what was logged');
  assert.equal(entry.updatedAt, log.updatedAt);
  const c = await s.getRecipe(cookies.id);
  assert.equal(c.ingredients[0].per.addedSugar, 81, 'chips: 54% of 150 g');
  assert.equal(c.ingredients[1].per.addedSugar, null, 'USDA flour: nothing to fetch');
  assert.equal(recipeNutrition(c).perServing.addedSugar, null, 'a recipe with a USDA ingredient still reads "not listed"');
  const t = await s.getRecipe(toast.id);
  assert.equal(recipeNutrition(t).perServing.addedSugar, 1 + 8.1, 'all-commercial recipe: bread 2% of 50 g + chips 54% of 15 g');
  assert.equal(recipeAsFood(t).servings[0].per.addedSugar, 9.1);
  const again = await refreshSavedFoods({ store: s, fetchFood: async () => assert.fail('nothing left to ask'), wait: noWait });
  assert.deepEqual(again, { foods: 0, recipes: 0, pending: 0 });
  assert.equal(refreshMessage(again), '');
});

test('a product that is gone, or still lists no added sugars, is asked about once', async () => {
  const { s } = await seeded();
  const r = await refreshSavedFoods({ store: s, fetchFood: async (key) => (key === OLD_BREAD.key ? OLD_BREAD : null), wait: noWait });
  assert.deepEqual(r, { foods: 0, recipes: 0, pending: 0 });
  assert.equal((await s.getFoodMeta(OLD_BREAD.key)).food.per100g.addedSugar, null, 'unchanged');
  assert.deepEqual((await s.getMeta(REFRESH_META_KEY)).checked.sort(), [OLD_BREAD.key, OLD_CHIPS.key].sort());
  let asked = 0;
  await refreshSavedFoods({ store: s, fetchFood: async () => { asked++; return null; }, wait: noWait });
  assert.equal(asked, 0);
});

test('a busy service is skipped for this run; a dropped connection stops it; the next start finishes', async () => {
  const { s } = await seeded();
  const rate = Object.assign(new Error('busy'), { kind: 'rate' });
  const r1 = await refreshSavedFoods({ store: s, fetchFood: async (key) => { if (key.startsWith('fdc:')) throw rate; return FRESH_BREAD; }, wait: noWait });
  assert.deepEqual(r1, { foods: 1, recipes: 1, pending: 1 }, 'bread done; USDA busy, chips wait');
  const net = Object.assign(new Error('offline'), { kind: 'network' });
  const r2 = await refreshSavedFoods({ store: s, fetchFood: async () => { throw net; }, wait: noWait });
  assert.equal(r2.pending, 1);
  const r3 = await refreshSavedFoods({ store: s, fetchFood: async () => FRESH_CHIPS, wait: noWait });
  assert.deepEqual(r3, { foods: 1, recipes: 2, pending: 0 });
});

test('lookups are paced, not fired all at once', async () => {
  const { s } = await seeded();
  const waits = [];
  await refreshSavedFoods({ store: s, fetchFood: async (key) => (key === OLD_BREAD.key ? FRESH_BREAD : FRESH_CHIPS), wait: async (ms) => { waits.push(ms); }, gapMs: 1100 });
  assert.deepEqual(waits, [1100], 'two lookups, one pause between them');
});

test('fix 1: a fresh scan or search refreshes the saved copy of products already used, and nothing else', async () => {
  const s = mk();
  await s.touchFoodMeta(OLD_BREAD, OLD_BREAD.servings[0], 1);
  const before = await s.getFoodMeta(OLD_BREAD.key);
  const other = { ...FRESH_CHIPS, key: 'off:999999' };
  assert.equal(await s.refreshSnapshots([FRESH_BREAD, other, { key: 'usda:1', per100g: {} }, null]), 1);
  const after = await s.getFoodMeta(OLD_BREAD.key);
  assert.equal(after.food.per100g.addedSugar, 2);
  assert.equal(after.lastUsed, before.lastUsed, 'a refresh is not a use: Recents order is unchanged');
  assert.equal(after.useCount, 1);
  assert.equal(await s.getFoodMeta('off:999999'), null, 'a product never used is not added to Recents');
  assert.equal(await s.refreshSnapshots([FRESH_BREAD]), 0, 'same data again: no write (no sync churn)');
  assert.equal((await s.getFoodMeta(OLD_BREAD.key)).updatedAt, after.updatedAt);
});

/** fetch stand-in that records URLs and answers from a table. */
function fakeFetch(table) {
  const urls = [];
  const fn = async (url) => {
    urls.push(url);
    const hit = Object.entries(table).find(([k]) => url.includes(k));
    const [status, body] = hit ? hit[1] : [404, {}];
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
  return { fn, urls };
}

test('looking a saved product up again: Open Food Facts by barcode, USDA by id (details endpoint, nested rows)', async () => {
  const { fn, urls } = fakeFetch({
    'openfoodfacts.org/api/v2/product/0073130002005': [200, { status: 1, product: { product_name: 'Sourdough bread', brands: 'Bakery Co', serving_quantity: 50, serving_size: '1 slice (50 g)', nutriments: { 'energy-kcal_100g': 250, sugars_100g: 4, 'added-sugars_100g': 2 } } }],
    'fdc/v1/food/2041155': [200, { fdcId: 2041155, description: 'CHOCOLATE CHIPS', brandOwner: 'Choco', servingSize: 15, servingSizeUnit: 'g', foodNutrients: [
      { type: 'FoodNutrient', id: 1, nutrient: { id: 1008, number: '208', name: 'Energy', unitName: 'kcal' }, amount: 480 },
      { type: 'FoodNutrient', id: 2, nutrient: { id: 2000, number: '269', name: 'Sugars, total including NLEA', unitName: 'g' }, amount: 56 },
      { type: 'FoodNutrient', id: 3, nutrient: { id: 1235, number: '539', name: 'Sugars, added', unitName: 'g' }, amount: 54 },
    ] }],
  });
  const bread = await fetchSavedFood('off:0073130002005', '', { fetchFn: fn });
  assert.equal(bread.key, 'off:0073130002005');
  assert.equal(bread.per100g.addedSugar, 2);
  const chips = await fetchSavedFood('fdc:2041155', 'MYKEY', { fetchFn: fn });
  assert.equal(chips.key, 'fdc:2041155');
  assert.equal(chips.per100g.sugar, 56);
  assert.equal(chips.per100g.addedSugar, 54);
  assert.match(urls[1], /^https:\/\/api\.nal\.usda\.gov\/fdc\/v1\/food\/2041155\?api_key=MYKEY$/);
  assert.equal(await fetchSavedFood('fdc:404404', '', { fetchFn: fn }), null, 'gone from USDA (404): null, not an error');
  assert.match(urls[2], /api_key=DEMO_KEY/, 'no key: the shared demo key');
  assert.equal(await fetchSavedFood('off:000000', '', { fetchFn: fakeFetch({ 'product/000000': [200, { status: 0 }] }).fn }), null);
  assert.equal(await fetchSavedFood('custom:abc', ''), null, 'not a product: nothing to fetch');
  await assert.rejects(() => foodFDC(1, '', { fetchFn: fakeFetch({ 'food/1': [429, {}] }).fn }), (e) => e.kind === 'rate');
});

// ---------- order, and impossible numbers (Caleb's backup, 2026-11-10) ----------

test('most recently used first: what you log every day is done within seconds of opening', () => {
  const m = (id, lastUsed) => ({ id, lastUsed, food: { key: id, per100g: { kcal: 1, sugar: 1 } } });
  const metas = [m('fdc:100', 10), m('off:0016000169685', 20), m('off:4069365630655', 99), { id: 'off:777777', favorite: true, food: { key: 'off:777777', per100g: { kcal: 1 } } }];
  assert.deepEqual(pendingKeys(metas, []), ['off:4069365630655', 'off:0016000169685', 'fdc:100', 'off:777777'], 'by last use, not by barcode; never-logged favorites last');
});

test('added sugars above total sugars are refused when read from Open Food Facts or USDA', async () => {
  const { offNutrients, fdcNutrients } = await import('../../js/normalize.js');
  const coffeeMate = offNutrients({ 'energy-kcal_100g': 400, sugars_100g: 0, 'added-sugars_100g': 56.95 });
  assert.equal(coffeeMate.sugar, 0);
  assert.equal(coffeeMate.addedSugar, null, '56.95 g added in 0 g total: not listed rather than wrong');
  assert.equal(offNutrients({ 'energy-kcal_100g': 100, sugars_100g: 4, 'added-sugars_100g': 4.2 }).addedSugar, 4.2, 'rounding apart: kept');
  assert.equal(offNutrients({ 'energy-kcal_100g': 100, 'added-sugars_100g': 3 }).addedSugar, 3, 'no total to compare: kept');
  assert.equal(fdcNutrients([{ nutrientId: 1008, unitName: 'KCAL', value: 10 }, { nutrientId: 2000, unitName: 'G', value: 5 }, { nutrientId: 1235, unitName: 'G', value: 9 }]).addedSugar, null);
});

test('the store never saves added sugars above total sugars, whatever the route', async () => {
  const s = mk();
  const e = await s.addLog({ date: '2026-11-10', meal: 0, foodKey: 'off:0050000303021', name: 'Coffee mate', serving: { label: '1 tbsp', grams: 15 }, qty: 1, per: { kcal: 60, sugar: 0, addedSugar: 8.5 } });
  assert.equal(e.per.addedSugar, null);
  const ok = await s.addLog({ date: '2026-11-10', meal: 0, foodKey: 'quick', name: 'Soda', serving: { label: '1 can', grams: 355 }, qty: 1, per: { kcal: 140, sugar: 39, addedSugar: 39 } });
  assert.equal(ok.per.addedSugar, 39);
});

test('a saved copy already holding an impossible number is looked up once more, even if checked before', async () => {
  const s = mk();
  const bad = { key: 'off:0050000303021', name: 'Coffee mate', brand: 'Nestle', source: 'off', per100g: { kcal: 400, sugar: 0, addedSugar: 56.95 }, servings: [{ label: '15 g', grams: 15 }] };
  await s.adapter.put('foodMeta', { id: bad.key, favorite: false, useCount: 3, lastUsed: 5, lastServing: null, food: bad, updatedAt: 5, deleted: false });
  await s.setMeta(REFRESH_META_KEY, { checked: [bad.key] }); // the first run had looked it up already
  const fresh = { ...bad, per100g: { kcal: 400, sugar: 0, addedSugar: null } }; // today's reader refuses the number
  let asked = 0;
  const r = await refreshSavedFoods({ store: s, fetchFood: async () => { asked++; return fresh; }, wait: noWait });
  assert.equal(asked, 1);
  assert.equal(r.pending, 0);
  const m = await s.getFoodMeta(bad.key);
  assert.equal(m.food.per100g.addedSugar, null, 'now "not listed"');
  assert.equal(m.useCount, 3);
  await refreshSavedFoods({ store: s, fetchFood: async () => { asked++; return fresh; }, wait: noWait });
  assert.equal(asked, 1, 'not asked again');
});
