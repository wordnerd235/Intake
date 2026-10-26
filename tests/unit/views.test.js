// Macro rebalance and the custom-food builder (pure helpers in nutrition.js used by the settings and food-editor views).
import test from 'node:test';
import assert from 'node:assert/strict';
import { rebalance, buildCustomFood } from '../../js/nutrition.js';

const total = (p) => p.protein + p.carbs + p.fat;

test('rebalance keeps the three macros at exactly 100', () => {
  for (const key of ['protein', 'carbs', 'fat']) {
    for (let v = 0; v <= 100; v += 7) {
      const out = rebalance({ protein: 30, carbs: 45, fat: 25 }, key, v);
      assert.equal(total(out), 100, `${key}=${v}`);
      assert.equal(out[key], v);
      assert.ok(Object.values(out).every((n) => Number.isInteger(n) && n >= 0));
    }
  }
});

test('rebalance splits what is left in proportion to the old values', () => {
  const out = rebalance({ protein: 30, carbs: 45, fat: 25 }, 'protein', 40);
  assert.deepEqual(out, { protein: 40, carbs: 39, fat: 21 });
});

test('rebalance handles zeroed neighbours and out-of-range input without NaN', () => {
  assert.deepEqual(rebalance({ protein: 100, carbs: 0, fat: 0 }, 'protein', 50), { protein: 50, carbs: 25, fat: 25 });
  assert.deepEqual(rebalance({ protein: 30, carbs: 45, fat: 25 }, 'fat', 250), { protein: 0, carbs: 0, fat: 100 });
  assert.deepEqual(rebalance({ protein: 30, carbs: 45, fat: 25 }, 'fat', -5), { protein: 40, carbs: 60, fat: 0 });
  assert.equal(total(rebalance({ protein: 30, carbs: 45, fat: 25 }, 'carbs', 33.4)), 100);
  const bad = rebalance({ protein: 30, carbs: 45, fat: 25 }, 'carbs', NaN);
  assert.equal(total(bad), 100);
  assert.ok(Object.values(bad).every(Number.isFinite));
});

test('buildCustomFood stores per-serving values and derives per-100 g from the weight', () => {
  const f = buildCustomFood({ name: '  Protein bar ', brand: ' Acme ', label: '', grams: 50, per: { kcal: 200, protein: 20, carbs: 22, fat: 6 } });
  assert.equal(f.name, 'Protein bar');
  assert.equal(f.brand, 'Acme');
  assert.equal(f.servings[0].label, '1 serving');
  assert.equal(f.servings[0].grams, 50);
  assert.equal(f.servings[0].per.kcal, 200);
  assert.equal(f.per100g.kcal, 400);
  assert.equal(f.per100g.protein, 40);
  assert.equal(f.per100g.fiber, null, 'unknown nutrients stay unknown, not zero');
});

test('buildCustomFood without a weight keeps only the per-serving numbers', () => {
  const f = buildCustomFood({ name: 'Mystery stew', brand: '', label: '1 bowl', grams: null, per: { kcal: 350 } });
  assert.equal(f.per100g, null);
  assert.equal(f.servings[0].grams, null);
  assert.equal(f.servings[0].label, '1 bowl');
  assert.equal(f.servings[0].per.kcal, 350);
});
