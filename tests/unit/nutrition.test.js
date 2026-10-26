import test from 'node:test';
import assert from 'node:assert/strict';
import * as N from '../../js/nutrition.js';
import { formatQty } from '../../js/units.js';

const NOW = new Date(2026, 5, 1); // June 2026
const male = { sex: 'male', birthYear: 1996, heightCm: 180, activity: 'moderate', goalType: 'lose', weeklyRateKg: 0.5, calorieOverride: null, startWeightKg: 80, macroPct: { protein: 25, carbs: 45, fat: 30 } };
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('BMR Mifflin-St Jeor known values', () => {
  near(N.bmr(male, 80, NOW), 10 * 80 + 6.25 * 180 - 5 * 30 + 5); // 1780
  near(N.bmr(male, 80, NOW), 1780);
  near(N.bmr({ sex: 'female', birthYear: 1991, heightCm: 165 }, 65, NOW), 650 + 1031.25 - 175 - 161); // 1345.25
});

test('TDEE and target: lose 0.5 kg/week at moderate activity', () => {
  const t = N.calorieTarget(male, 80, NOW);
  near(t.bmr, 1780);
  near(t.tdee, 1780 * 1.55);
  near(t.adjust, -550);
  assert.equal(t.target, Math.round(1780 * 1.55 - 550)); // 2209
  assert.equal(t.source, 'calc');
  assert.equal(t.clamped, false);
});

test('gain adds, maintain is zero, activity factors', () => {
  assert.equal(N.calorieTarget({ ...male, goalType: 'gain' }, 80, NOW).target, Math.round(1780 * 1.55 + 550));
  assert.equal(N.calorieTarget({ ...male, goalType: 'maintain' }, 80, NOW).target, Math.round(1780 * 1.55));
  for (const [k, f] of Object.entries({ sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very: 1.9 })) {
    near(N.calorieTarget({ ...male, goalType: 'maintain', activity: k }, 80, NOW).tdee, 1780 * f);
  }
});

test('calorie floor clamps (1200 f / 1500 m) and flags it', () => {
  const f = { sex: 'female', birthYear: 1986, heightCm: 155, activity: 'sedentary', goalType: 'lose', weeklyRateKg: 1, startWeightKg: 55 };
  const t = N.calorieTarget(f, 55, NOW);
  assert.equal(t.target, 1200);
  assert.equal(t.clamped, true);
  assert.ok(t.raw < 1200);
  const m = N.calorieTarget({ ...male, weeklyRateKg: 1, activity: 'sedentary', heightCm: 160 }, 50, NOW);
  assert.equal(m.target, 1500);
  assert.equal(m.clamped, true);
});

test('calorieOverride wins; missing data falls back to default 2000', () => {
  const o = N.calorieTarget({ ...male, calorieOverride: 1850 }, 80, NOW);
  assert.equal(o.target, 1850);
  assert.equal(o.source, 'override');
  const d = N.calorieTarget({ ...N.DEFAULT_PROFILE }, null, NOW);
  assert.equal(d.target, 2000);
  assert.equal(d.source, 'default');
  assert.equal(N.calorieTarget(male, null, NOW).target, N.calorieTarget(male, 80, NOW).target, 'falls back to startWeightKg');
  assert.equal(N.calorieTarget({ ...male, weeklyRateKg: -1 }, 80, NOW).adjust, 0, 'negative rate treated as 0');
});

test('macro grams from percentages', () => {
  const g = N.macroTargets(2000, { protein: 25, carbs: 45, fat: 30 });
  near(g.protein, 125);
  near(g.carbs, 225);
  near(g.fat, (2000 * 0.3) / 9);
  const p = N.macroPercents({ protein: 125, carbs: 225, fat: 66.6667 });
  near(p.protein + p.carbs + p.fat, 100);
  assert.deepEqual(N.macroPercents({}), { protein: 0, carbs: 0, fat: 0 });
});

test('default nutrient targets', () => {
  const t = N.resolveTargets({ ...male }, 2000);
  assert.equal(t.fiber.value, 28);
  assert.equal(t.fiber.kind, 'goal');
  assert.equal(t.sodium.value, 2300);
  assert.equal(t.sodium.kind, 'limit');
  near(t.satFat.value, 200 / 9);
  assert.equal(t.satFat.kind, 'limit');
  assert.equal(t.cholesterol.value, 300);
  assert.equal(t.potassium.value, 3400);
  assert.equal(t.iron.value, 8);
  assert.equal(t.vitA.value, 900);
  assert.equal(t.vitC.value, 90);
  assert.equal(t.vitD.value, 15);
  assert.equal(t.sugar.kind, null);
  const f = N.resolveTargets({ ...male, sex: 'female' }, 1800);
  assert.equal(f.potassium.value, 2600);
  assert.equal(f.iron.value, 18);
  assert.equal(f.vitA.value, 700);
  assert.equal(f.vitC.value, 75);
  const o = N.resolveTargets({ ...male, nutrientTargets: { sodium: 1500, sugar: 50 } }, 2000);
  assert.equal(o.sodium.value, 1500);
  assert.equal(o.sugar.value, 50);
  assert.equal(o.sugar.kind, 'limit');
});

test('exercise kcal = MET x kg x min / 60', () => {
  assert.equal(N.exerciseKcal(8, 80, 30), 320);
  assert.equal(N.exerciseKcal(3.5, 70, 45), Math.round(3.5 * 70 * 0.75));
  assert.equal(N.exerciseKcal(8, 80, NaN), 0);
  assert.equal(N.exerciseKcal(8, 80, -5), 0);
});

test('day budget', () => {
  assert.deepEqual(N.dayBudget(2000, 300, 1800, true), { budget: 2300, eaten: 1800, exercise: 300, remaining: 500, over: false });
  const b = N.dayBudget(2000, 300, 2100, false);
  assert.equal(b.budget, 2000);
  assert.equal(b.remaining, -100);
  assert.equal(b.over, true);
});

const banana = { key: 'usda:1', name: 'Bananas, raw', source: 'usda', per100g: { kcal: 89, protein: 1.09, carbs: 22.84, fat: 0.33, fiber: null }, servings: [{ label: '1 medium', grams: 118 }] };

test('serving scaling: per = per100g x grams/100, total = per x qty', () => {
  const per = N.perForServing(banana, banana.servings[0]);
  near(per.kcal, 89 * 1.18);
  assert.equal(per.fiber, null, 'unknown stays null');
  const opts = N.servingOptions(banana);
  assert.deepEqual(opts.map((s) => s.label), ['1 medium', 'g', 'oz']);
  const oz = N.perForServing(banana, opts[2]);
  near(oz.kcal, 89 * 0.283495);
  const tot = N.entryTotal({ per, qty: 1.5 });
  near(tot.kcal, 89 * 1.18 * 1.5);
  assert.equal(Math.round(N.entryTotal({ per, qty: 1 }).kcal), 105);
  const grams = N.entryTotal({ per: N.perForServing(banana, opts[1]), qty: 150 });
  near(grams.kcal, 133.5);
});

test('servings with explicit per (grams null) and foods without per100g', () => {
  const f = { key: 'custom:x', name: 'Bar', per100g: null, servings: [{ label: '1 bar', grams: null, per: { kcal: 200, protein: 10 } }] };
  assert.equal(N.servingOptions(f).length, 1, 'no g/oz without per100g');
  assert.equal(N.perForServing(f, f.servings[0]).kcal, 200);
  assert.equal(N.perForServing(f, f.servings[0]).fat, null);
  assert.equal(N.perForServing({ key: 'x', servings: [] }, { label: 'x', grams: null }).kcal, null);
  const only = { key: 'y', per100g: { kcal: 100 }, servings: [] };
  assert.deepEqual(N.servingOptions(only).map((s) => s.label), ['100 g', 'g', 'oz']);
});

test('sums treat unknown as 0 but track it; never NaN', () => {
  const a = N.perForServing(banana, banana.servings[0]);
  const { total, unknown } = N.sumEntries([{ per: a, qty: 2 }, { per: { kcal: 100 }, qty: 1 }, { per: null, qty: 1 }]);
  near(total.kcal, 89 * 1.18 * 2 + 100);
  assert.equal(unknown.fiber, true);
  assert.equal(unknown.kcal, true, 'null per counts as unknown contributor');
  for (const k of N.NUTRIENTS) assert.ok(Number.isFinite(total[k]), k);
  const empty = N.sumNutrients([]);
  assert.equal(empty.total.kcal, 0);
  assert.equal(empty.unknown.kcal, false);
  assert.equal(N.scaleNutrients({ kcal: NaN, protein: 5 }, 2).kcal, null);
  assert.equal(N.scaleNutrients({ kcal: 10 }, NaN).kcal, null);
});

test('recipe per-serving and per-100g math', () => {
  const recipe = {
    id: 'r1', name: 'Oats + banana', servings: 2, cookedGrams: 500,
    ingredients: [
      { per: { kcal: 300, protein: 10, carbs: 54, fat: 5 }, qty: 1 },
      { per: { kcal: 100, protein: 1, carbs: 25, fat: 0 }, qty: 2 },
    ],
  };
  const r = N.recipeNutrition(recipe);
  assert.equal(r.total.kcal, 500);
  assert.equal(r.perServing.kcal, 250);
  assert.equal(r.perServing.protein, 6);
  assert.equal(r.per100g.kcal, 100);
  assert.equal(r.gramsPerServing, 250);
  const food = N.recipeAsFood(recipe);
  assert.equal(food.key, 'recipe:r1');
  assert.equal(food.servings[0].per.kcal, 250);
  const opts = N.servingOptions(food);
  assert.deepEqual(opts.map((s) => s.label), ['1 serving', 'g', 'oz']);
  assert.equal(N.perForServing(food, opts[0]).kcal, 250);
  near(N.perForServing(food, opts[1]).kcal, 1, 1e-9); // 1 g of a 100 kcal/100 g recipe
  const noWeight = N.recipeNutrition({ ...recipe, cookedGrams: null });
  assert.equal(noWeight.per100g, null);
  assert.equal(N.recipeAsFood({ ...recipe, id: 'r2', cookedGrams: null }).per100g, null);
  assert.equal(N.recipeNutrition({ ingredients: [], servings: 0 }).perServing.kcal, 0, 'servings 0 treated as 1');
});

test('trend weight EMA alpha 0.1 with carry-forward', () => {
  const s = N.trendSeries([{ date: '2026-01-01', kg: 80 }, { date: '2026-01-03', kg: 79 }]);
  assert.equal(s.length, 3);
  assert.equal(s[0].trend, 80);
  assert.equal(s[1].kg, null);
  near(s[1].trend, 80, 1e-12); // carried-forward 80 -> no change
  near(s[2].trend, 80 + 0.1 * (79 - 80));
  const gap = N.trendSeries([{ date: '2026-01-01', kg: 80 }, { date: '2026-01-02', kg: 78 }], { to: '2026-01-04' });
  assert.equal(gap.length, 4);
  near(gap[1].trend, 79.8);
  near(gap[2].trend, 79.8 + 0.1 * (78 - 79.8)); // 78 carried forward
  assert.deepEqual(N.trendSeries([]), []);
  const unsorted = N.trendSeries([{ date: '2026-01-02', kg: 78 }, { date: '2026-01-01', kg: 80 }]);
  assert.equal(unsorted[0].date, '2026-01-01');
});

test('BMI and category', () => {
  near(N.bmi(80, 180), 24.691358, 1e-5);
  assert.equal(N.bmi(80, 0), null);
  assert.equal(N.bmiCategory(24.7), 'Healthy range');
  assert.equal(N.bmiCategory(31), 'Obese');
  assert.equal(N.bmiCategory(null), '-');
});

test('goal projection only when moving toward goal', () => {
  const mk = (start, perDay, days) => N.trendSeries(Array.from({ length: days }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, kg: start + perDay * i })));
  const down = mk(90, -0.1, 28);
  const p = N.projectGoalDate(down, 80, '2026-09-28');
  assert.ok(p && p.days > 30 && p.date > '2026-09-28', JSON.stringify(p));
  assert.ok(p.slopeKgPerWeek < 0);
  assert.equal(N.projectGoalDate(down, 100, '2026-09-28'), null, 'moving away from a higher goal');
  assert.equal(N.projectGoalDate(mk(90, 0, 28), 80, '2026-09-28'), null, 'flat');
  assert.equal(N.projectGoalDate(mk(90, -0.1, 5), 80, '2026-09-05'), null, 'too little data');
  assert.equal(N.projectGoalDate(down, null, '2026-09-28'), null);
  const reached = N.projectGoalDate(down, 88, '2026-09-28');
  assert.ok(reached && reached.days >= 0);
});

test('servingText formats', () => {
  assert.equal(N.servingText({ qty: 1.5, serving: { label: '1 cup' } }, formatQty), '1.5 × 1 cup');
  assert.equal(N.servingText({ qty: 150, serving: { label: 'g' } }, formatQty), '150 g');
  assert.equal(N.servingText({ qty: 1, serving: null }, formatQty), '1 serving');
  assert.equal(N.servingText({ qty: 1, serving: { label: '1 medium (7" long)' } }, formatQty), '1 medium (7" long)');
  assert.equal(N.servingText({ qty: 2, serving: { label: 'bar' } }, formatQty), '2 × bar');
});
