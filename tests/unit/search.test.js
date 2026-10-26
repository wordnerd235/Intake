import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tokenize, fold, buildIndex, searchIndex } from '../../js/foods-search.js';
import { parseFoodsDoc, rowToFood } from '../../js/foods-db.js';
import { shortLabel } from '../../js/units.js';

const root = new URL('../../', import.meta.url);
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, root), 'utf8'));
const sources = [['fixture', 'tests/fixtures/foods-small.json']];
if (fs.existsSync(new URL('data/foods.json', root))) sources.push(['real data/foods.json', 'data/foods.json']);

test('tokenize and fold', () => {
  assert.deepEqual(tokenize('Bananas, raw (ripe)'), ['bananas', 'raw', 'ripe']);
  assert.deepEqual(tokenize('  2% Milk!  '), ['2', 'milk']);
  assert.deepEqual(tokenize('Jalapeño'), ['jalapeno']);
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize(null), []);
  assert.equal(fold('bananas'), 'banana');
  assert.equal(fold('berries'), 'berry');
  assert.equal(fold('tomatoes'), 'tomato');
  assert.equal(fold('eggs'), 'egg');
  assert.equal(fold('hummus'), 'hummus');
  assert.equal(fold('glass'), 'glass');
  assert.equal(fold('peas'), 'pea');
  assert.equal(fold('2'), '2');
});

test('every query token must prefix-match; digits match exactly', () => {
  const idx = buildIndex([{ name: 'Milk, reduced fat, 2% milkfat' }, { name: 'Milk, whole, 3.25% milkfat' }, { name: 'Milkshake mix' }]);
  assert.equal(searchIndex(idx, 'milk 2').length, 1);
  assert.equal(searchIndex(idx, 'milk 20').length, 0, 'digits never prefix-match (2 != 20)');
  assert.equal(searchIndex(idx, 'milk xyz').length, 0);
  assert.equal(searchIndex(idx, 'mil').length, 3);
  assert.equal(searchIndex(idx, '   ').length, 0);
  assert.equal(searchIndex(idx, 'the').length, 0);
});

test('plural folding in queries and names', () => {
  const idx = buildIndex([{ name: 'Tomatoes, red, raw' }, { name: 'Blackberries, raw' }, { name: 'Eggs, boiled' }]);
  assert.equal(searchIndex(idx, 'tomato')[0].name, 'Tomatoes, red, raw');
  assert.equal(searchIndex(idx, 'tomatoes')[0].name, 'Tomatoes, red, raw');
  assert.equal(searchIndex(idx, 'blackberry')[0].name, 'Blackberries, raw');
  assert.equal(searchIndex(idx, 'blackberries')[0].name, 'Blackberries, raw');
  assert.equal(searchIndex(idx, 'egg')[0].name, 'Eggs, boiled');
  assert.equal(searchIndex(idx, 'tomatoe')[0].name, 'Tomatoes, red, raw', 'mid-typing still matches');
});

for (const [label, path] of sources) {
  const st = parseFoodsDoc(read(path));
  const top = (q, n = 3) => searchIndex(st.index, q, { limit: n }).map((h) => h.name);

  test(`ranking [${label}]: banana -> "Bananas, raw" first`, () => {
    assert.equal(top('banana', 1)[0], 'Bananas, raw');
    assert.equal(top('bananas', 1)[0], 'Bananas, raw');
  });

  test(`ranking [${label}]: egg -> whole egg in top 3`, () => {
    const t = top('egg');
    assert.ok(t.some((n) => /^Egg, whole, (raw|cooked, (hard-boiled|scrambled|fried|poached|omelet))/.test(n)), t.join(' | '));
  });

  test(`ranking [${label}]: chicken breast -> cooked chicken breast in top 3`, () => {
    const t = top('chicken breast');
    assert.ok(t.some((n) => /^Chicken, broilers? or fryers, breast.*cooked, roasted/.test(n)), t.join(' | '));
    assert.ok(!/(breaded|tenders|deli)/i.test(t[0]), `plain chicken should outrank processed: ${t[0]}`);
  });

  test(`ranking [${label}]: white rice -> cooked white rice in top 3`, () => {
    const t = top('white rice');
    assert.ok(t.some((n) => /^Rice, white/.test(n) && /cooked/.test(n)), t.join(' | '));
  });

  test(`ranking [${label}]: 2% milk / milk 2% -> reduced fat 2% milk in top 3`, () => {
    for (const q of ['2% milk', 'milk 2%']) {
      const t = top(q);
      assert.ok(t.some((n) => /^Milk, reduced fat.*2%/.test(n)), `${q}: ${t.join(' | ')}`);
    }
  });

  test(`ranking [${label}]: partial typing, no crash, results sorted`, () => {
    for (const q of ['b', 'ba', 'ban', 'banan', 'chick', 'appl']) {
      const hits = searchIndex(st.index, q, { limit: 20 });
      assert.ok(hits.length > 0, q);
      for (let i = 1; i < hits.length; i++) assert.ok(hits[i - 1].score >= hits[i].score, `${q} unsorted`);
    }
  });

  test(`rowToFood [${label}]: Food shape is complete`, () => {
    const doc = read(path);
    const f = rowToFood(doc.foods.find((r) => r[1] === 'Bananas, raw'), doc.nutrients);
    assert.match(f.key, /^usda:\d+$/);
    assert.equal(f.source, 'usda');
    assert.equal(Object.keys(f.per100g).length, 16);
    assert.ok(f.per100g.kcal > 80 && f.per100g.kcal < 100);
    assert.ok(f.servings.length >= 1 && f.servings.every((s) => s.label && s.grams > 0));
    assert.ok(f.servings.some((s) => /medium/.test(s.label) && Math.abs(s.grams - 118) < 2));
  });
}

test('shortLabel trims long USDA portion labels cleanly', () => {
  const long = '1 chop, excluding refuse (yield from 1 raw chop, with refuse, weighing 151 g)';
  assert.equal(shortLabel(long), '1 chop, excluding refuse…');
  assert.equal(shortLabel('1 cup'), '1 cup');
  assert.ok(shortLabel('x'.repeat(100)).length <= 46);
  assert.equal(shortLabel(null), '');
  assert.equal(shortLabel('1 medium (7" to 7-7/8" long)'), '1 medium (7" to 7-7/8" long)');
});

for (const [label, path] of sources) {
  test(`banana default serving is "1 medium" [${label}]`, () => {
    const doc = read(path);
    const f = rowToFood(doc.foods.find((r) => r[1] === 'Bananas, raw'), doc.nutrients);
    assert.match(f.servings[0].label, /^1 medium/);
    assert.equal(f.servings[0].grams, 118);
    assert.equal(f.servings[f.servings.length - 1].label.length > 0, true);
  });
}

if (sources.some(([l]) => l.startsWith('real'))) {
  const st = parseFoodsDoc(read('data/foods.json'));
  const top = (q, n = 3) => searchIndex(st.index, q, { limit: n }).map((h) => h.name);

  test('ranking [real]: potato -> a plain potato first, not hash browns', () => {
    assert.match(top('potato', 1)[0], /^Potatoes, (baked|boiled|raw)/);
    assert.match(top('potatoes', 1)[0], /^Potatoes, (baked|boiled|raw)/);
  });

  test('ranking [real]: bacon -> pork bacon, cooked, above Canadian bacon; meatless bacon is not near the top', () => {
    const t = top('bacon', 5);
    const pork = t.findIndex((n) => /^Pork, cured, bacon, .*cooked/.test(n));
    const canadian = t.findIndex((n) => /^Canadian bacon/.test(n));
    assert.equal(pork, 0, t.join(' | '));
    assert.ok(canadian > pork, t.join(' | '));
    assert.ok(!/meatless/i.test(top('bacon', 3).join('|')), 'meatless bacon stays out of the top 3');
    assert.ok(/meatless/i.test(top('meatless bacon', 1)[0]), 'but asking for it finds it');
  });

  test('ranking [real]: "hot dog" finds frankfurters, not relish or rolls', () => {
    for (const q of ['hot dog', 'hot dogs', 'hotdog']) {
      const t = top(q, 2);
      assert.ok(t.every((n) => /^Frankfurter/.test(n)), `${q}: ${t.join(' | ')}`);
    }
  });

  test('ranking [real]: "water" finds plain or tap water, not watermelon, coffee or tea', () => {
    const t = top('water', 3);
    assert.ok(t.length >= 2 && t.every((n) => /^(Water, bottled, generic|Beverages, water, tap)/.test(n)), t.join(' | '));
    assert.ok(!/melon|coffee|tea|coconut|convolvulus/i.test(t.join('|')));
    assert.match(top('watermelon', 1)[0], /^Watermelon/, 'other water words still work');
    assert.match(top('bottled water', 1)[0], /^(Water, bottled|Beverages, water, bottled)/);
  });

  test('ranking [real]: single-noun queries prefer the plain food over salads, spreads and light versions', () => {
    assert.ok(!/salad/i.test(top('tuna', 1)[0]), top('tuna', 3).join(' | '));
    assert.match(top('tuna', 1)[0], /^Fish, tuna/);
    assert.ok(!/spread/i.test(top('chocolate', 1)[0]), top('chocolate', 3).join(' | '));
    const beer = top('beer', 2);
    assert.match(beer[0], /beer, regular/, beer.join(' | '));
    assert.ok(/light/i.test(beer[1]) || /beer/.test(beer[1]));
    assert.match(top('light beer', 1)[0], /beer, light/, 'asking for light finds it');
  });

  test('ranking [real]: french fries -> potato fries first', () => {
    assert.match(top('french fries', 1)[0], /^Potatoes, french fried/);
    assert.match(top('fries', 1)[0], /french fried/i);
  });

  test('ranking [real]: "2% milk" and "milk 2%" -> 2% milk first', () => {
    for (const q of ['2% milk', 'milk 2%']) {
      const t = top(q, 1);
      assert.match(t[0], /^Milk, reduced fat, fluid, 2% milkfat/, `${q}: ${t[0]}`);
    }
  });

  test('ranking [real]: rolled oats, oatmeal and oats find oats in the top 3', () => {
    for (const q of ['rolled oats', 'old fashioned oats', 'oatmeal', 'oats']) {
      const t = top(q);
      assert.ok(t.some((n) => /^Cereals, oats/.test(n)), `${q}: ${t.join(' | ')}`);
    }
    assert.ok(!/Honey Bunches/i.test(top('oats').join('|')), 'branded cereal stays out of the top 3 for "oats"');
  });

  test('ranking [real]: apple -> raw apples first; coffee -> brewed coffee first', () => {
    assert.match(top('apple', 1)[0], /^Apples, raw/);
    assert.match(top('coffee', 1)[0], /^Beverages, coffee, brewed/);
  });

  test('ranking [real]: everyday words map to the USDA vocabulary', () => {
    assert.match(top('ketchup', 1)[0], /^Catsup/);
    assert.match(top('oj', 1)[0], /^Orange juice/);
    assert.match(top('soda', 1)[0], /^(Beverages, carbonated|Carbonated beverage)/);
    assert.match(top('ground beef', 1)[0], /^Beef, ground/);
    assert.match(top('pb', 1)[0], /^Peanut butter/);
  });

  test('ranking [real]: mayo and mayonnaise -> regular mayonnaise before tofu and reduced-fat versions (R-31)', () => {
    for (const q of ['mayo', 'mayonnaise']) {
      const t = top(q, 6);
      assert.match(t[0], /^Salad dressing, mayonnaise, regular/, `${q}: ${t.join(' | ')}`);
      assert.ok(t.indexOf('Mayonnaise, made with tofu') < 0 || t.indexOf('Mayonnaise, made with tofu') > 2, 'tofu mayonnaise is a variant, not the default');
    }
  });

  test('ranking [real]: soy milk finds soymilk; oat milk never returns baby cereal (R-31)', () => {
    assert.match(top('soy milk', 1)[0], /^Soymilk/);
    assert.ok(top('soy milk', 5).every((n) => /^Soymilk/.test(n)), top('soy milk', 5).join(' | '));
    const oat = top('oat milk', 10);
    assert.ok(!oat.some((n) => /baby/i.test(n)), oat.join(' | '));
    assert.ok(!oat.some((n) => /^Cookies|oatmeal/i.test(n)), `a finished short word "oat" is not the start of "oatmeal": ${oat.join(' | ')}`);
  });

  test('ranking [real]: baby foods only appear when the search names a baby', () => {
    const plain = searchIndex(st.index, 'apple juice', { limit: 40 }).map((h) => h.name);
    assert.ok(!plain.some((n) => /^Babyfood/i.test(n)), plain.join(' | '));
    for (const q of ['baby food apple juice', 'babyfood cereal', 'infant formula']) {
      assert.ok(searchIndex(st.index, q, { limit: 40 }).length > 0, q);
    }
    assert.ok(searchIndex(st.index, 'babyfood cereal', { limit: 5 }).every((h) => /^Babyfood/i.test(h.name)));
  });

  test('ranking [real]: the last word may be half typed, an earlier short word may not (R-31)', () => {
    assert.ok(top('oat', 5).length > 0 && top('oatm', 5).length > 0 && top('ice cr', 3).some((n) => /^Ice cream/.test(n)));
    assert.ok(top('chick brea', 3).length > 0, 'a 4-letter earlier word can still be a prefix');
    assert.ok(top('pea soup', 3).some((n) => /^Soup, pea/i.test(n)), top('pea soup', 3).join(' | '));
  });

  test('ranking [real]: pizza prefers foods eaten by the slice over a share of a frozen package (R-31)', () => {
    const t = top('pizza', 3);
    assert.ok(t.every((n) => !/regular crust/.test(n)), `a 1/9-of-a-package serving is not the top pizza: ${t.join(' | ')}`);
    const first = rowToFood(st.byId.get(String(searchIndex(st.index, 'pizza', { limit: 1 })[0].ref[0])), st.order);
    assert.match(first.servings[0].label, /slice/i, first.servings[0].label);
  });

  test('ranking [real]: bacon, hot dog, water, beer and fries keep their defaults', () => {
    assert.match(top('bacon', 1)[0], /^Pork, cured, bacon/);
    assert.match(top('hot dog', 1)[0], /^Frankfurter/);
    assert.match(top('water', 1)[0], /^(Water, bottled|Beverages, water, tap)/);
    assert.match(top('beer', 1)[0], /^Alcoholic beverage, beer, regular/);
    assert.match(top('french fries', 2).join('|'), /french fried/i);
  });
}
