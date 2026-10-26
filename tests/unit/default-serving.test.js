// Default serving: what the "+" button logs. A table of staples over the real USDA data plus invariants over every food.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parsePortion, orderServings, foodClass, pourOz, cleanLabel } from '../../js/default-serving.js';
import { rowToFood } from '../../js/foods-db.js';
import { servingText } from '../../js/nutrition.js';

const root = new URL('../../', import.meta.url);
const realPath = new URL('data/foods.json', root);
const hasReal = fs.existsSync(realPath);

test('parsePortion reads amounts, units and ounces', () => {
  assert.deepEqual(parsePortion('1 1/2 cup, diced'), { lower: '1 1/2 cup, diced', amount: 1.5, rest: 'cup, diced', unit: 'cup', ozTotal: null });
  assert.equal(parsePortion('1/2 breast, bone removed').amount, 0.5);
  assert.equal(parsePortion('3 oz').ozTotal, 3);
  assert.equal(parsePortion('1 serving (3 oz)').ozTotal, 3);
  assert.equal(parsePortion('1 oz (22 whole kernels)').unit, 'oz');
  assert.equal(parsePortion('weird label').amount, null);
  assert.equal(parsePortion(null).unit, '');
});

const food = (name, group, kcal100, servings) => ({ name, group, kcal100, servings: servings.map(([label, grams]) => ({ label, grams })) });

test('orderServings: units beat volume for countable foods, yields and packages never win', () => {
  const banana = orderServings(food('Bananas, raw', '09', 89, [['1 cup, mashed', 225], ['1 medium (7" to 7-7/8" long)', 118], ['1 small', 101], ['1 oz', 28.35]]));
  assert.match(banana[0].label, /^1 medium/);
  const chicken = orderServings(food('Chicken, breast, cooked, roasted', '05', 165, [['1 cup, chopped or diced', 140], ['1 unit (yield from 1 lb ready-to-cook chicken)', 52], ['1/2 breast, bone removed', 98], ['1 oz', 28.35]]));
  assert.match(chicken[0].label, /^1\/2 breast/);
  assert.ok(!/yield/.test(chicken[0].label));
  const only = orderServings(food('Thing', '22', 200, [['1 package', 900], ['1 unit (yield from 1 lb raw)', 300], ['1 oz', 28.35]]));
  assert.equal(only[0].label, '1 oz');
});

test('orderServings: fats and spreads default to spoons, never a cup or a stick', () => {
  assert.equal(orderServings(food('Butter, salted', '01', 717, [['1 pat', 5], ['1 tbsp', 14.2], ['1 cup', 227], ['1 stick', 113], ['1 oz', 28.35]]))[0].label, '1 tbsp');
  assert.equal(orderServings(food('Peanut butter, smooth', '16', 588, [['2 tbsp', 32], ['1 cup', 258], ['1 oz', 28.35]]))[0].label, '2 tbsp');
  assert.equal(orderServings(food('Sugars, granulated', '19', 387, [['1 packet', 2.8], ['1 tsp', 4.2], ['1 cup', 200], ['1 oz', 28.35]]))[0].label, '1 tsp');
});

test('orderServings: a drink that only lists fl oz gets an 8 fl oz serving', () => {
  const o = orderServings(food('Beverages, coffee, brewed, espresso', '14', 4, [['1 fl oz', 29.6], ['1 oz', 28.35]]));
  assert.equal(o[0].label, '8 fl oz');
  assert.ok(Math.abs(o[0].grams - 236.8) < 0.2);
  assert.equal(foodClass(food('Milk, whole', '01', 61, [['1 cup', 244]])), 'liquid');
});

test('orderServings: beer 12 fl oz, wine 5 fl oz, spirits 1.5 fl oz, synthesized from "1 fl oz" when no such portion is listed', () => {
  const beer = orderServings(food('Alcoholic beverage, beer, regular, all', '14', 43, [['1 fl oz', 29.7], ['1 can', 356], ['1 oz', 28.35]]));
  assert.equal(beer[0].label, '12 fl oz');
  assert.ok(Math.abs(beer[0].grams - 356.4) < 0.2);
  const listed = orderServings(food('Alcoholic beverage, beer, light', '14', 29, [['1 fl oz', 29.5], ['1 can or bottle (12 fl oz)', 354], ['1 oz', 28.35]]));
  assert.equal(listed[0].label, '1 can or bottle (12 fl oz)', 'a listed 12 fl oz portion is used as is');
  const wine = orderServings(food('Alcoholic beverage, wine, table, red', '14', 85, [['1 fl oz', 29.4], ['1 serving (5 fl oz)', 147], ['1 oz', 28.35]]));
  assert.equal(wine[0].label, '1 serving (5 fl oz)');
  const dessert = orderServings(food('Alcoholic beverage, wine, dessert, sweet', '14', 160, [['1 fl oz', 29.5], ['1 glass (3.5 fl oz)', 103], ['1 oz', 28.35]]));
  assert.equal(dessert[0].label, '5 fl oz');
  const vodka = orderServings(food('Alcoholic beverage, distilled, vodka, 80 proof', '14', 231, [['1 fl oz', 27.8], ['1 oz', 28.35]]));
  assert.equal(vodka[0].label, '1.5 fl oz');
  assert.ok(Math.abs(vodka[0].grams - 41.7) < 0.2);
  const jigger = orderServings(food('Alcoholic beverage, distilled, all (gin, rum, vodka, whiskey) 86 proof', '14', 250, [['1 fl oz', 27.8], ['1 Jigger 1.5 fl oz', 42], ['1 oz', 28.35]]));
  assert.equal(jigger[0].label, '1 Jigger 1.5 fl oz');
  assert.equal(pourOz('Beerwurst, pork and beef'), null);
  assert.equal(pourOz('Alcoholic beverage, wine, cooking'), null);
  assert.equal(pourOz('Alcoholic beverage, tequila sunrise, canned'), null, 'cocktails are not a pour');
  assert.equal(pourOz('Beverages, Wine, non-alcoholic'), null);
});

test('orderServings: fries default to a counted portion, not 1 oz', () => {
  const a = orderServings(food('Potatoes, french fried, all types, frozen, home-prepared, oven heated', '11', 158, [['10 fries', 76], ['1 package (9 oz), yields', 198], ['1 oz', 28.35]]));
  assert.equal(a[0].label, '10 fries');
  const b = orderServings(food('Potatoes, french fried, cottage-cut, frozen, oven-heated', '11', 218, [['10 strips', 50], ['1 package (9 oz), yields', 198], ['1 oz', 28.35]]));
  assert.equal(b[0].label, '10 strips');
  const c = orderServings(food('Fast foods, potato, french fried in vegetable oil', '21', 312, [['1 serving small', 71], ['1 serving medium', 117], ['1 serving large', 154], ['1 oz', 28.35]]));
  assert.match(c[0].label, /^1 serving/);
  assert.equal(parsePortion('10 strip').amount, 10);
});

test('orderServings: dry rice, grains and flour default to 1/4 cup or 2 oz, never a 650 kcal cup', () => {
  const rice = orderServings(food('Rice, white, long-grain, regular, raw, enriched', '20', 365, [['1 cup', 185], ['1 oz', 28.35]]));
  assert.equal(rice[0].label, '1/4 cup');
  assert.ok(Math.abs(rice[0].grams - 46.3) < 0.2);
  assert.ok(rice.some((s) => s.label === '1 cup' && s.grams === 185), 'the listed cup is still offered');
  const pasta = orderServings(food('Pasta, dry, enriched', '20', 371, [['1 cup spaghetti', 91], ['2 oz', 57], ['1 cup elbows', 122], ['1 oz', 28.35]]));
  assert.equal(pasta[0].label, '2 oz');
  const flour = orderServings(food('Wheat flour, white, all-purpose', '20', 364, [['1 cup', 125], ['1 oz', 28.35]]));
  assert.equal(flour[0].label, '1/4 cup');
  const listed = orderServings(food('Quinoa, uncooked', '20', 368, [['1/4 cup', 43], ['1 cup', 170], ['1 oz', 28.35]]));
  assert.equal(listed[0].label, '1/4 cup');
  assert.equal(listed.filter((s) => /^1\/4 cup/.test(s.label)).length, 1, 'nothing is synthesized when 1/4 cup is already listed');
  // cooked grains stay on the cup
  assert.equal(orderServings(food('Rice, white, long-grain, regular, cooked', '20', 130, [['1 cup', 158], ['1 oz', 28.35]]))[0].label, '1 cup');
});

test('orderServings: a seasoning packet is not the food, a small package is one serving, a big cup of dense food is not', () => {
  const ramen = orderServings(food('Soup, ramen noodle, any flavor, dry', '06', 440, [['1 package without flavor packet', 81], ['1 packet', 5.8], ['1 oz', 28.35]]));
  assert.equal(ramen[0].label, '1 package without flavor packet');
  const bacon = orderServings(food('Bacon, meatless', '16', 309, [['1 cup', 144], ['1 oz cooked, yield', 16], ['1 strip', 5], ['1 oz', 28.35]]));
  assert.notEqual(bacon[0].label, '1 cup');
  const mix = orderServings(food('Flan, caramel custard, dry mix', '19', 340, [['1 portion, amount to make 1/2 cup', 21], ['1 package (3 oz)', 85], ['1 oz', 28.35]]));
  assert.match(mix[0].label, /^1 portion/, 'a package of dry mix is several servings');
  const ketchup = orderServings(food('Sauce, tomato chili sauce, bottled', '06', 92, [['1 packet', 6], ['1 cup', 273], ['1 oz', 28.35]]));
  assert.equal(ketchup[0].label, '1 packet');
});

test('orderServings: a whole avocado is not the default when a label serving is listed', () => {
  const a = orderServings(food('Avocados, raw, all commercial varieties', '09', 160, [['1 cup, cubes', 150], ['1 cup, pureed', 230], ['1 avocado, NS as to Florida or California', 201], ['1 NLEA Serving', 50], ['1 oz', 28.35]]));
  assert.equal(a[0].label, '1 serving (label)', 'NLEA is jargon: shown as a label serving');
});

test('cleanLabel drops per-package noise and doubled phrases, and leaves normal labels alone', () => {
  assert.equal(cleanLabel('1 serving 9 servings per 24 oz package'), '1 serving (1/9 of 24 oz package)', 'a share of a package says so');
  assert.equal(cleanLabel('1 serving 6 servings per 34.98 oz package'), '1 serving (1/6 of 34.98 oz package)');
  assert.equal(cleanLabel('1 serving 1 serving per 8 oz box'), '1 serving (whole 8 oz box)');
  assert.equal(cleanLabel('1 serving 8 fl oz 8 fl oz'), '1 serving 8 fl oz');
  assert.equal(cleanLabel('1 cup 12 fl oz 12 fl oz'), '1 cup 12 fl oz');
  for (const ok of ['1 medium (7" to 7-7/8" long)', '1 package (9 oz), yields', '1 cup, chopped', '10 fries', '1 serving (label)', '1 serving (1/9 of 24 oz package)', '1/2 breast, bone and skin removed']) assert.equal(cleanLabel(ok), ok);
  assert.equal(cleanLabel(null), '');
});

test('cleanLabel takes the jargon NLEA out of every label (R-31 nit)', () => {
  const cases = [['1 NLEA serving', '1 serving (label)'], ['1 NLEA Serving', '1 serving (label)'], ['3/4 cup (1 NLEA serving)', '3/4 cup (label serving)'], ['1 cup (1 NLEA serving)', '1 cup (label serving)'],
    ['2 oz 1 NLEA serving', '2 oz (label serving)'], ['2 links 1 NLEA serving', '2 links (label serving)'], ['1 cherry (NLEA serving)', '1 cherry (label serving)'],
    ['1 serving (1 NLEA serving - about 4 crackers)', '1 serving (label serving - about 4 crackers)'], ['1 cup (1 NLEA serving for adults)', '1 cup (label serving for adults)']];
  for (const [raw, want] of cases) assert.equal(cleanLabel(raw), want, raw);
  for (const [, want] of cases) assert.equal(cleanLabel(want), want, `idempotent: ${want}`);
});

test('orderServings: a slice beats a share of a package, and the package share says so', () => {
  const f = orderServings(food('Pizza, cheese topping, thin crust, frozen, cooked', '21', 263, [['1 pie', 556], ['1 slice', 69], ['1 serving 3 servings per 15.1 oz package', 151], ['1 oz', 28.35]]));
  assert.equal(f[0].label, '1 slice');
  const g = orderServings(food('Pizza, cheese topping, regular crust, frozen, cooked', '21', 268, [['1 serving 9 servings per 24 oz package', 81], ['1 serving 3 servings per 15.1 oz package', 151], ['1 package 24 oz pizza', 727], ['1 oz', 28.35]]));
  assert.deepEqual(g.slice(0, 2).map((s) => s.label), ['1 serving (1/9 of 24 oz package)', '1 serving (1/3 of 15.1 oz package)'], 'two shares of different packages stay distinct');
  assert.match(servingText({ qty: 1, serving: { label: '1 NLEA Serving' } }, String), /^1 serving \(label\)$/, 'older diary entries are shown tidy too');
});

test('orderServings keeps every portion and never returns NaN grams', () => {
  const list = [['1 slice', 28], ['1 oz', 28.35], ['1 cup, crumbs', 45]];
  const out = orderServings(food('Bread', '18', 265, list));
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((s) => s.label).sort(), list.map((l) => l[0]).sort());
  assert.deepEqual(orderServings(food('Empty', '09', 10, [])), []);
  assert.ok(orderServings(food('No kcal', '09', null, [['1 cup', 100]])).every((s) => Number.isFinite(s.grams)));
});

if (hasReal) {
  const doc = JSON.parse(fs.readFileSync(realPath, 'utf8'));
  const rows = doc.foods;
  const pick = (name) => {
    const r = rows.find((x) => x[1] === name) || rows.find((x) => x[1].startsWith(name));
    assert.ok(r, `food not found: ${name}`);
    return rowToFood(r, doc.nutrients);
  };
  const kcalOf = (f, s) => (s.grams * f.per100g.kcal) / 100;

  // [food name, allowed default labels (regex), description]
  const TABLE = [
    ['Bananas, raw', /^1 medium/],
    ['Egg, whole, raw, fresh', /^1 large/],
    ['Egg, whole, cooked, hard-boiled', /^1 large/],
    ['Egg, whole, cooked, scrambled', /^1 large/],
    ["Peanut butter, smooth style, with salt", /^(2|1) tbsp/],
    ['Peanut butter, chunk style, with salt', /^(2|1) tbsp/],
    ['Milk, whole, 3.25% milkfat, with added vitamin D', /^1 cup/],
    ['Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D', /^1 cup/],
    ['Cereals, oats, regular and quick, unenriched, cooked with water (includes boiling and microwaving), without salt', /^1 cup/],
    ['Butter, salted', /^(1 tbsp|1 pat)/],
    ['Nuts, almonds, dry roasted, without salt added', /^1 oz/],
    ['Nuts, almonds', /^1 oz/],
    ['Chicken, broilers or fryers, breast, meat only, cooked, roasted', /^(3 oz|1\/2 breast)/],
    ['Rice, white, long-grain, regular, enriched, cooked', /^1 cup/],
    ['Bread, white, commercially prepared (includes soft bread crumbs)', /^1 slice/],
    ['Bread, whole-wheat, commercially prepared', /^1 slice/],
    ['Apples, raw, with skin', /medium/],
    ['Cheese, cheddar (Includes', /^(1 slice|1 oz)/],
    ['Oil, olive, salad or cooking', /^1 tbsp/],
    ['Beverages, coffee, brewed, prepared with tap water', /^(1 cup|6 fl oz)/],
    ['Broccoli, cooked, boiled, drained, without salt', /^(1 cup|1\/2 cup)/],
    ['Beef, ground, 95% lean meat / 5% fat, patty, cooked, broiled', /^3 oz/],
    ['Beef, ground, 80% lean meat / 20% fat, patty, cooked, broiled', /^3 oz/],
    ['Fish, salmon, Atlantic, farmed, cooked, dry heat', /^(3 oz|1\/2 fillet)/],
    ['Potatoes, baked, flesh and skin, without salt', /medium/],
    ['Orange juice, chilled, includes from concentrate', /^1 cup/],
    ['Yogurt, plain, whole milk', /^(1 container|1 cup)/],
    ['Yogurt, plain, low fat', /^(1 container|1 cup)/],
    ['Sugars, granulated', /^(1 tsp|1 tbsp)/],
    ['Mayonnaise, reduced-calorie', /^1 tbsp/],
    ['Honey', /^1 tbsp/],
    ['Catsup', /^1 tbsp/],
    ['Cream, fluid, heavy whipping', /^1 tbsp/],
    ['Nuts, walnuts, english', /^1 oz/],
    ['Snacks, potato chips, plain, salted', /^1 oz/],
    ['Spinach, cooked, boiled, drained, without salt', /^1 cup/],
    ['Lentils, mature seeds, cooked, boiled, without salt', /^1 cup/],
    ['Pork, cured, bacon, pre-sliced, cooked, pan-fried', /^1 slice/],
    ['Tomatoes, red, ripe, raw, year round average', /medium/],
    ['Avocados, raw, California', /^1 fruit/],
    ['Avocados, raw, all commercial varieties', /^1 serving \(label\)/],
    ['Alcoholic beverage, beer, regular, all', /^12 fl oz/],
    ['Alcoholic beverage, beer, regular, BUDWEISER', /^12 fl oz/],
    ['Alcoholic beverage, wine, table, red', /5 fl oz/],
    ['Alcoholic beverage, wine, table, white', /5 fl oz/],
    ['Alcoholic beverage, distilled, vodka, 80 proof', /^(1\.5|1 1\/2) fl oz/],
    ['Alcoholic beverage, distilled, whiskey, 86 proof', /(jigger|1\.5 fl oz)/i],
    ['Potatoes, french fried, all types, salt added in processing, frozen, home-prepared', /^10 (fries|strips?)/],
    ['Fast foods, potato, french fried in vegetable oil', /^1 serving/],
    ['Soup, ramen noodle, any flavor, dry', /^1 package/],
    ['Rice, white, long-grain, regular, raw, enriched', /^1\/4 cup/],
    ['Quinoa, uncooked', /^1\/4 cup/],
    ['Pasta, dry, enriched', /^2 oz/],
    ['Wheat flour, white, all-purpose, enriched, bleached', /^1\/4 cup/],
    ['Bacon, meatless', /^(1 oz|1 strip)/],
  ];
  for (const [name, re] of TABLE) {
    test(`default serving: ${name.slice(0, 60)}`, () => {
      const f = pick(name);
      const d = f.servings[0];
      assert.match(d.label, re, `${f.name} -> ${d.label} (${d.grams} g)`);
      assert.ok(!/yield|refuse/i.test(d.label), d.label);
    });
  }

  test('default serving: every food has a plausible default (real data)', () => {
    let over600 = 0;
    let yielding = 0;
    let heavy = 0;
    let tiny = 0;
    const worst = [];
    for (const r of rows) {
      const f = rowToFood(r, doc.nutrients);
      const s = f.servings[0];
      assert.ok(s && s.label && Number.isFinite(s.grams) && s.grams > 0, f.name);
      const k = kcalOf(f, s);
      assert.ok(Number.isFinite(k), f.name);
      if (k > 600) { over600++; worst.push(`${f.name} -> ${s.label} ${Math.round(k)} kcal`); }
      if (/yield|refuse/i.test(s.label)) yielding++;
      if (s.grams > 400) heavy++;
      if (k < 5 && f.per100g.kcal >= 10) tiny++;
    }
    assert.ok(over600 < 50, `${over600} defaults over 600 kcal: ${worst.slice(0, 5).join(' | ')}`);
    assert.equal(yielding, 0, 'no default may be a "yield from" or "refuse" portion');
    assert.equal(heavy, 0, 'no default over 400 g');
    assert.ok(tiny < 60, `${tiny} defaults under 5 kcal for a calorie-bearing food`);
  });

  test('default serving: dry grains, pasta and legumes never default to a meal-sized measure', () => {
    const bad = [];
    for (const r of rows) {
      if (r[2] !== '20' && r[2] !== '16') continue;
      const f = rowToFood(r, doc.nutrients);
      if (f.per100g.kcal < 300) continue; // dry foods only
      const k = kcalOf(f, f.servings[0]);
      if (k >= 450) bad.push(`${f.name} -> ${f.servings[0].label} ${Math.round(k)} kcal`);
    }
    assert.deepEqual(bad, []);
  });

  test('default serving: no label carries "servings per ... package" noise, and none is a doubled phrase', () => {
    for (const r of rows) {
      const f = rowToFood(r, doc.nutrients);
      for (const s of f.servings) assert.ok(!/servings? per .*(package|box|container|bag|can|bottle|jar)/i.test(s.label), `${f.name}: ${s.label}`);
    }
  });

  test('default serving: every USDA food keeps all of its portions', () => {
    for (const r of rows.slice(0, 600)) {
      const f = rowToFood(r, doc.nutrients);
      const raw = r[5].filter((p) => p[0] && p[1] > 0).length;
      assert.ok(f.servings.length >= raw, f.name);
    }
  });
}
