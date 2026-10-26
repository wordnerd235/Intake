// Every number a person can type must have a ceiling (or its own range check), so one typo cannot wreck a day.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const files = [...readdirSync(join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`), ...readdirSync(join(ROOT, 'js/views')).filter((f) => f.endsWith('.js')).map((f) => `js/views/${f}`)];

/** Fields that check their own range with a specific message (profile numbers) or use amountProblem (the diary Amount). */
const OWN_RANGE = new Set(['ob-birth', 'ob-cm', 'ob-ft', 'ob-in', 'ob-weight', 'ob-goal', 'pf-birth', 'pf-cm', 'pf-ft', 'pf-in', 'pf-goal', 'fd-qty']);

test('every numInput has a max or its own range check', () => {
  const missing = [];
  let seen = 0;
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/numInput\(\{([^]*?)\}\);/g)) {
      if (!/\blabel:/.test(m[1])) continue; // the definition in ui.js
      seen++;
      const id = (/\bid: '([\w-]+)'/.exec(m[1]) || [])[1];
      if (!/\bmax:/.test(m[1]) && !(id && OWN_RANGE.has(id))) missing.push(`${f} ${id || m[1].slice(0, 60)}`);
    }
  }
  assert.ok(seen >= 25, `only saw ${seen} numInput calls`);
  assert.deepEqual(missing, [], 'these number fields have no ceiling');
});

test('the fields from the QA report use the shared limits', () => {
  const read = (p) => readFileSync(join(ROOT, p), 'utf8');
  assert.match(read('js/views/add-food.js'), /id: 'qa-kcal'.*max: LIMITS\.kcal/);
  assert.match(read('js/views/add-food.js'), /id: 'qa-p'.*max: LIMITS\.macroGrams/);
  assert.match(read('js/views/exercise.js'), /id: 'ex-min'.*max: LIMITS\.exerciseMinutes/);
  assert.match(read('js/views/exercise.js'), /id: 'ex-kcal'.*max: LIMITS\.exerciseKcal/);
  assert.match(read('js/views/settings.js'), /id: 'pf-ovr'.*min: ovr\.min, max: ovr\.max/);
  assert.match(read('js/views/settings.js'), /id: 'pf-water'.*max: LIMITS\.waterGoal/);
  assert.match(read('js/views/food-editor.js'), /id: 'fe-grams'.*max: MAX_GRAMS/);
  assert.match(read('js/views/food-editor.js'), /id: `fe-\$\{k\}`.*max: maxForUnit/);
});
