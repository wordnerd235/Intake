// Quick add from a Claude chat: the prompt's format reads back exactly, and real-world pastes are read safely.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROMPT, parseChatNutrition, readValue, readAmount, chatEntry } from '../../js/chat-paste.js';
import { NUTRIENTS } from '../../js/nutrition.js';
import { createStore } from '../../js/store.js';
import { createMemoryAdapter } from '../../js/db.js';
import { createBus } from '../../js/bus.js';

test('the prompt\'s own template, filled in, reads back every nutrient', () => {
  const block = PROMPT.slice(PROMPT.indexOf('Intake\n'), PROMPT.indexOf('\n\nRules'));
  let n = 0;
  const filled = block.replace('<short food name>', 'Test food').replace('<portion in words> (<grams> g)', '1 bowl (300 g)')
    .replace('Added sugars: <number>', 'Added sugars: 3').replace(/<number>/g, () => String(++n)); // added sugars must not exceed total
  const { items, problems } = parseChatNutrition(filled);
  assert.deepEqual(problems, []);
  assert.equal(items.length, 1);
  const it = items[0];
  assert.equal(it.name, 'Test food');
  assert.deepEqual(it.amount, { label: '1 bowl', grams: 300 });
  for (const k of NUTRIENTS) assert.equal(typeof it.per[k], 'number', `${k} read`);
  assert.equal(n + 1, NUTRIENTS.length, 'the prompt asks for every nutrient Intake tracks');
  assert.equal(it.per.kcal, 1);
  assert.equal(it.per.sugar, 5);
  assert.equal(it.per.addedSugar, 3);
  assert.equal(it.per.vitD, 16);
});

const ANSWER = `Here's my estimate for the burrito bowl and the drink.

**Calories:** about 980 in total, mostly from the rice and horchata.

\`\`\`
Intake
Name: Chicken burrito bowl
Amount: 1 bowl (450 g)
Calories: 680
Protein: 42 g
Carbs: 72 g
Fiber: 11 g
Total sugars: 6 g
Added sugars: 1 g
Fat: 24 g
Saturated fat: 8 g
Trans fat: unknown
Sodium: 1,450 mg

Name: Horchata
Amount: 16 oz cup (480 g)
Calories: 300
Total sugars: 40 g
Added sugars: 36 g
\`\`\`

Let me know if you had sour cream.`;

test('a whole Claude answer: the prose is skipped, each food becomes one item', () => {
  const { items, problems } = parseChatNutrition(ANSWER);
  assert.deepEqual(problems, []);
  assert.deepEqual(items.map((i) => i.name), ['Chicken burrito bowl', 'Horchata'], 'the "Calories: about 980" in the prose is not a third item');
  const [bowl, drink] = items;
  assert.equal(bowl.per.sodium, 1450, '"1,450" is 1450');
  assert.equal(bowl.per.transFat, null, '"unknown" stays unknown');
  assert.equal(bowl.per.potassium, null, 'a line left out is unknown, not 0');
  assert.deepEqual(drink.amount, { label: '16 oz cup', grams: 480 });
  assert.equal(drink.per.addedSugar, 36);
  assert.equal(drink.per.protein, null);
});

test('markdown and loose formats: bullets, bold, tables, units in brackets, other units', () => {
  const t = [
    '- **Name:** Greek yogurt',
    '* Calories (kcal): 150',
    '1. Protein (g): 15',
    '| Carbohydrates | 8 g |',
    '|---|---|',
    'Sugars = 6g',
    'Added sugar – 0 g',
    'Sodium: 0.08 g',
    'Vitamin A: 500 IU',
    'Vitamin D: 2 µg',
    'Calcium: 200mg',
    'Net carbs: 8 g',
  ].join('\n');
  const { items, problems } = parseChatNutrition(t);
  assert.deepEqual(problems, []);
  const y = items[0].per;
  assert.equal(items[0].name, 'Greek yogurt');
  assert.equal(y.kcal, 150);
  assert.equal(y.protein, 15);
  assert.equal(y.carbs, 8, 'a table row');
  assert.equal(y.sugar, 6, '"Sugars" is total sugars');
  assert.equal(y.addedSugar, 0, 'a real 0 stays 0');
  assert.equal(y.sodium, 80, 'grams converted to mg');
  assert.equal(y.vitA, 150, '500 IU of vitamin A = 150 µg RAE');
  assert.equal(y.vitD, 2);
  assert.equal(y.calcium, 200);
  assert.equal(readValue('kcal', '2000 kJ').v, 478.011, 'kJ converted');
  assert.equal(readValue('protein', '~30 g').v, 30, '"~" means its best estimate');
  assert.equal(readValue('fiber', 'approx. 4g').v, 4);
  assert.equal(readValue('addedSugar', 'n/a').v, null);
  assert.equal(readValue('addedSugar', 'not listed').v, null);
  assert.equal(readValue('sugar', '—').v, null);
});

test('values it won\'t guess at are named, and an item without calories is left out', () => {
  const { items, problems } = parseChatNutrition('Name: Pizza\nCalories: 600-700\nProtein: 25 g\n\nName: Salad\nCalories: 250\nIron: 20% DV\nFat: 1,2345 g\nSodium: 150000 mg');
  assert.deepEqual(items.map((i) => i.name), ['Salad']);
  assert.equal(items[0].per.iron, null);
  assert.equal(items[0].per.fat, null);
  assert.equal(items[0].per.sodium, null);
  assert.deepEqual(problems, [
    'Pizza: Calories: give one number, not a range ("600-700").',
    'Pizza: no calories, so it was left out.',
    'Salad: Iron: give an amount, not a % Daily Value ("20% DV").',
    'Salad: Fat: "1,2345" is unclear. Use a point for decimals (1.5) and no commas for thousands (1200).',
    'Salad: Sodium: 150,000 mg is more than one entry can hold (100,000).',
  ]);
  assert.equal(parseChatNutrition('Calories: 99999').problems[0], 'Calories: 99,999 kcal is more than one entry can hold (10,000).');
});

test('added sugars above total sugars are left as not listed, with a note', () => {
  const { items, problems } = parseChatNutrition('Name: Creamer\nCalories: 35\nTotal sugars: 0 g\nAdded sugars: 5 g');
  assert.equal(items[0].per.addedSugar, null);
  assert.equal(items[0].per.sugar, 0);
  assert.deepEqual(problems, ["Creamer: added sugars were more than total sugars, so they're left as not listed."]);
});

test('blocks without names split where a nutrient repeats; nothing readable says so', () => {
  const { items } = parseChatNutrition('Calories: 100\nProtein: 5 g\nCalories: 200\nProtein: 10 g');
  assert.deepEqual(items.map((i) => [i.name, i.per.kcal]), [['Quick add', 100], ['Quick add', 200]]);
  assert.match(parseChatNutrition('That looks delicious! Enjoy your lunch.').problems[0], /^No nutrition found/);
  assert.equal(parseChatNutrition('').items.length, 0);
  const long = parseChatNutrition(`Name: ${'x'.repeat(120)}\nCalories: 1`).items[0].name;
  assert.equal(long.length, 80, 'names are capped like Quick add');
});

test('amounts: words and grams, grams only, words only', () => {
  assert.deepEqual(readAmount('1 bowl (450 g)'), { label: '1 bowl', grams: 450 });
  assert.deepEqual(readAmount('450 g'), { label: '450 g', grams: 450 });
  assert.deepEqual(readAmount('2 slices (about 90g)'), { label: '2 slices', grams: 90 });
  assert.deepEqual(readAmount('1 cup'), { label: '1 cup', grams: null });
  assert.deepEqual(readAmount('1 cup (8 fl oz)'), { label: '1 cup', grams: null });
  const w = parseChatNutrition('Name: Steak\nAmount: 1 steak\nWeight: 225 g\nCalories: 550').items[0];
  assert.deepEqual(w.amount, { label: '1 steak', grams: 225 }, 'a Weight line adds the grams');
});

test('as a diary entry: one Quick add serving; added sugars survive the store', async () => {
  const [bowl] = parseChatNutrition(ANSWER).items;
  const e = chatEntry(bowl);
  assert.deepEqual({ foodKey: e.foodKey, name: e.name, serving: e.serving, qty: e.qty }, { foodKey: 'quick', name: 'Chicken burrito bowl', serving: { label: '1 bowl', grams: 450 }, qty: 1 });
  assert.deepEqual(chatEntry({ name: 'Snack', amount: null, per: { kcal: 100 } }).serving, { label: 'serving', grams: null });
  const s = createStore({ adapter: createMemoryAdapter(), bus: createBus(), clock: () => 1, uuid: () => 'id1' });
  const rec = await s.addLog({ ...e, date: '2026-11-13', meal: 1 });
  assert.equal(rec.per.addedSugar, 1);
  assert.equal(rec.per.kcal, 680);
  assert.equal(rec.per.potassium, null);
});
