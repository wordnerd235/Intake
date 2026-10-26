// nutrition.js - nutrient math, goal math, recipe math. Pure (no DOM).
import { addDays, diffDays, ageFromBirthYear } from './dates.js';
import { cleanLabel } from './units.js';

export const NUTRIENTS = ['kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'satFat', 'transFat', 'cholesterol', 'sodium', 'potassium', 'calcium', 'iron', 'vitA', 'vitC', 'vitD'];

/** Display metadata per nutrient: label, unit, decimals shown. */
export const NUTRIENT_INFO = {
  kcal: { label: 'Calories', unit: 'kcal', dp: 0 },
  protein: { label: 'Protein', unit: 'g', dp: 1 },
  carbs: { label: 'Carbohydrates', unit: 'g', dp: 1 },
  fat: { label: 'Fat', unit: 'g', dp: 1 },
  fiber: { label: 'Fiber', unit: 'g', dp: 1 },
  sugar: { label: 'Sugars', unit: 'g', dp: 1 },
  satFat: { label: 'Saturated fat', unit: 'g', dp: 1 },
  transFat: { label: 'Trans fat', unit: 'g', dp: 1 },
  cholesterol: { label: 'Cholesterol', unit: 'mg', dp: 0 },
  sodium: { label: 'Sodium', unit: 'mg', dp: 0 },
  potassium: { label: 'Potassium', unit: 'mg', dp: 0 },
  calcium: { label: 'Calcium', unit: 'mg', dp: 0 },
  iron: { label: 'Iron', unit: 'mg', dp: 1 },
  vitA: { label: 'Vitamin A', unit: 'µg', dp: 0 },
  vitC: { label: 'Vitamin C', unit: 'mg', dp: 1 },
  vitD: { label: 'Vitamin D', unit: 'µg', dp: 1 },
};

export const ACTIVITY_FACTORS = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very: 1.9 };
export const ACTIVITY_LABELS = {
  sedentary: 'Sedentary (desk job, little exercise)',
  light: 'Lightly active (exercise 1-3 days/week)',
  moderate: 'Moderately active (3-5 days/week)',
  active: 'Very active (6-7 days/week)',
  very: 'Extra active (physical job + training)',
};
export const KCAL_PER_KG = 7700;
export const DEFAULT_KCAL = 2000;

/** Default profile (settings record id "profile"). */
export const DEFAULT_PROFILE = {
  units: { weight: 'lb', height: 'ftin', water: 'oz' },
  sex: 'male',
  birthYear: null,
  heightCm: null,
  activity: 'light',
  goalType: 'maintain',
  goalWeightKg: null,
  weeklyRateKg: 0.45,
  calorieOverride: null,
  macroPct: { protein: 25, carbs: 45, fat: 30 },
  nutrientTargets: {},
  waterGoalMl: 2000,
  mealNames: ['Breakfast', 'Lunch', 'Dinner', 'Snacks'],
  addExerciseCalories: true,
  theme: 'system',
  fdcApiKey: '',
  onboarded: false,
  startWeightKg: null,
  startDate: null,
};

/** @returns {Record<string, number|null>} all 16 keys set to null */
export function emptyNutrients() {
  const o = {};
  for (const k of NUTRIENTS) o[k] = null;
  return o;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Multiply every known nutrient by factor; unknown (null/undefined/NaN) stays null.
 * @param {Object|null|undefined} n
 * @param {number} factor
 * @returns {Record<string, number|null>}
 */
export function scaleNutrients(n, factor) {
  const o = {};
  for (const k of NUTRIENTS) o[k] = n && isNum(n[k]) && isNum(factor) ? n[k] * factor : null;
  return o;
}

/**
 * Sum nutrient objects. Unknown counts as 0 but is tracked per key.
 * @param {Array<Object|null>} list
 * @returns {{total: Record<string, number>, unknown: Record<string, boolean>}}
 */
export function sumNutrients(list) {
  const total = {};
  const unknown = {};
  for (const k of NUTRIENTS) {
    total[k] = 0;
    unknown[k] = false;
  }
  for (const n of list) {
    for (const k of NUTRIENTS) {
      if (n && isNum(n[k])) total[k] += n[k];
      else unknown[k] = true;
    }
  }
  return { total, unknown };
}

/**
 * Nutrients for ONE serving unit of a food (the "per" stored on a log entry).
 * @param {Object} food Food shape
 * @param {{label:string, grams:number|null, per?:Object}} serving
 * @returns {Record<string, number|null>}
 */
export function perForServing(food, serving) {
  if (serving && serving.per) return scaleNutrients(serving.per, 1);
  if (food && food.per100g && serving && isNum(serving.grams)) return scaleNutrients(food.per100g, serving.grams / 100);
  return emptyNutrients();
}

/**
 * Servings the picker offers: the food's own, then g and oz when per100g exists.
 * @param {Object} food
 * @returns {Array<{label:string, grams:number|null, per?:Object}>}
 */
export function servingOptions(food) {
  const own = Array.isArray(food.servings) ? food.servings.filter((s) => s && s.label) : [];
  if (!food.per100g) return own;
  const out = own.slice();
  if (!out.length) out.push({ label: '100 g', grams: 100 });
  if (!out.some((s) => s.label === 'g')) out.push({ label: 'g', grams: 1 });
  if (!out.some((s) => s.label === 'oz')) out.push({ label: 'oz', grams: 28.3495 });
  return out;
}

/**
 * Log entry total = per x qty.
 * @param {{per:Object, qty:number}} entry
 * @returns {Record<string, number|null>}
 */
export function entryTotal(entry) {
  return scaleNutrients(entry.per, isNum(entry.qty) ? entry.qty : 0);
}

/**
 * Totals for a list of entries (foodLogs / meal items / ingredients).
 * @param {Array<{per:Object, qty:number}>} entries
 */
export function sumEntries(entries) {
  return sumNutrients(entries.map(entryTotal));
}

/**
 * Energy split of macros by calories (Atwater 4/4/9). Percentages sum to 100 (or all 0).
 * @param {{protein:number, carbs:number, fat:number}} n
 * @returns {{protein:number, carbs:number, fat:number}}
 */
export function macroPercents(n) {
  const p = (n.protein || 0) * 4;
  const c = (n.carbs || 0) * 4;
  const f = (n.fat || 0) * 9;
  const t = p + c + f;
  if (t <= 0) return { protein: 0, carbs: 0, fat: 0 };
  return { protein: (p / t) * 100, carbs: (c / t) * 100, fat: (f / t) * 100 };
}

/**
 * Daily macro gram targets from a calorie target and percentages.
 * @param {number} kcal
 * @param {{protein:number, carbs:number, fat:number}} pct
 */
export function macroTargets(kcal, pct) {
  return { protein: (kcal * pct.protein) / 100 / 4, carbs: (kcal * pct.carbs) / 100 / 4, fat: (kcal * pct.fat) / 100 / 9 };
}

/**
 * Mifflin-St Jeor basal metabolic rate.
 * @param {{sex:string, birthYear:number, heightCm:number}} p
 * @param {number} kg
 * @param {Date} [now]
 * @returns {number}
 */
export function bmr(p, kg, now = new Date()) {
  const age = ageFromBirthYear(p.birthYear, now);
  return 10 * kg + 6.25 * p.heightCm - 5 * age + (p.sex === 'male' ? 5 : -161);
}

/** @returns {boolean} true when profile has what BMR needs */
export function isProfileComplete(p) {
  return !!(p && isNum(p.birthYear) && isNum(p.heightCm) && p.heightCm > 0 && (p.sex === 'male' || p.sex === 'female'));
}

/**
 * Daily calorie target with breakdown.
 * @param {Object} profile settings.profile
 * @param {number|null} kg latest weight (falls back to profile.startWeightKg)
 * @param {Date} [now]
 * @returns {{target:number, source:'override'|'calc'|'default', bmr:number|null, tdee:number|null, adjust:number, raw:number|null, floor:number, clamped:boolean}}
 */
export function calorieTarget(profile, kg, now = new Date()) {
  const floor = profile.sex === 'female' ? 1200 : 1500;
  if (isNum(profile.calorieOverride) && profile.calorieOverride > 0) {
    return { target: Math.round(profile.calorieOverride), source: 'override', bmr: null, tdee: null, adjust: 0, raw: null, floor, clamped: false };
  }
  const w = isNum(kg) ? kg : profile.startWeightKg;
  if (!isProfileComplete(profile) || !isNum(w) || w <= 0) {
    return { target: DEFAULT_KCAL, source: 'default', bmr: null, tdee: null, adjust: 0, raw: null, floor, clamped: false };
  }
  const b = bmr(profile, w, now);
  const tdee = b * (ACTIVITY_FACTORS[profile.activity] || ACTIVITY_FACTORS.light);
  const rate = Math.max(0, profile.weeklyRateKg || 0);
  const adjust = (profile.goalType === 'lose' ? -(rate * KCAL_PER_KG) / 7 : profile.goalType === 'gain' ? (rate * KCAL_PER_KG) / 7 : 0) || 0;
  const raw = tdee + adjust;
  const clamped = raw < floor;
  return { target: Math.round(clamped ? floor : raw), source: 'calc', bmr: b, tdee, adjust, raw, floor, clamped };
}

/** Kinds: 'limit' (over = warning), 'goal' (aim to reach), null (informational). */
const LIMIT_KEYS = new Set(['satFat', 'sodium', 'cholesterol', 'sugar', 'transFat']);

/**
 * Per-nutrient targets for the day: { key: {value:number|null, kind:'limit'|'goal'|null} }.
 * @param {Object} profile
 * @param {number} kcal calorie target (not budget)
 */
export function resolveTargets(profile, kcal) {
  const male = profile.sex !== 'female';
  const macros = macroTargets(kcal, profile.macroPct || DEFAULT_PROFILE.macroPct);
  const base = {
    kcal: [kcal, 'goal'],
    protein: [macros.protein, 'goal'],
    carbs: [macros.carbs, 'goal'],
    fat: [macros.fat, 'goal'],
    fiber: [(14 * kcal) / 1000, 'goal'],
    sugar: [null, null],
    satFat: [(0.1 * kcal) / 9, 'limit'],
    transFat: [null, null],
    cholesterol: [300, 'limit'],
    sodium: [2300, 'limit'],
    potassium: [male ? 3400 : 2600, 'goal'],
    calcium: [1000, 'goal'],
    iron: [male ? 8 : 18, 'goal'],
    vitA: [male ? 900 : 700, 'goal'],
    vitC: [male ? 90 : 75, 'goal'],
    vitD: [15, 'goal'],
  };
  const over = profile.nutrientTargets || {};
  const out = {};
  for (const k of NUTRIENTS) {
    let [value, kind] = base[k];
    if (isNum(over[k]) && over[k] > 0) {
      value = over[k];
      kind = LIMIT_KEYS.has(k) ? 'limit' : 'goal';
    }
    out[k] = { value, kind };
  }
  return out;
}

/**
 * Exercise calories = MET x kg x minutes / 60, rounded.
 * @param {number} met
 * @param {number} kg
 * @param {number} minutes
 * @returns {number}
 */
export function exerciseKcal(met, kg, minutes) {
  if (![met, kg, minutes].every(isNum)) return 0;
  return Math.max(0, Math.round((met * kg * minutes) / 60));
}

/**
 * Daily budget summary.
 * @param {number} target calorie target
 * @param {number} exercise kcal burned
 * @param {number} eaten kcal eaten
 * @param {boolean} addExercise profile.addExerciseCalories
 */
export function dayBudget(target, exercise, eaten, addExercise) {
  const budget = target + (addExercise ? exercise : 0);
  return { budget, eaten, exercise, remaining: budget - eaten, over: eaten > budget };
}

/**
 * Daily EMA trend over weigh-ins. Gaps are filled by carrying the last weigh-in forward,
 * so each calendar day contributes one input. First weigh-in seeds the trend.
 * @param {Array<{date:string, kg:number}>} weights any order
 * @param {{alpha?:number, to?:string}} [opts]
 * @returns {Array<{date:string, kg:number|null, trend:number}>}
 */
export function trendSeries(weights, { alpha = 0.1, to } = {}) {
  const ws = weights.filter((w) => w && isNum(w.kg)).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!ws.length) return [];
  const byDate = new Map(ws.map((w) => [w.date, w.kg]));
  const end = to && to > ws[ws.length - 1].date ? to : ws[ws.length - 1].date;
  const out = [];
  let trend = ws[0].kg;
  let last = ws[0].kg;
  const n = diffDays(ws[0].date, end);
  for (let i = 0; i <= n; i++) {
    const d = addDays(ws[0].date, i);
    const actual = byDate.has(d) ? byDate.get(d) : null;
    if (actual != null) last = actual;
    if (i > 0) trend += alpha * (last - trend);
    out.push({ date: d, kg: actual, trend });
  }
  return out;
}

/** @returns {number|null} kg / m^2 */
export function bmi(kg, cm) {
  if (!isNum(kg) || !isNum(cm) || cm <= 0) return null;
  const m = cm / 100;
  return kg / (m * m);
}

/** @param {number|null} v @returns {string} */
export function bmiCategory(v) {
  if (v == null) return '-';
  return v < 18.5 ? 'Underweight' : v < 25 ? 'Healthy range' : v < 30 ? 'Overweight' : 'Obese';
}

/**
 * Projected goal date from the trend slope over the last 4 weeks.
 * Only when the trend is moving toward the goal; otherwise null.
 * @param {Array<{date:string, trend:number}>} series from trendSeries
 * @param {number|null} goalKg
 * @param {string} todayStr
 * @returns {{date:string, days:number, slopeKgPerWeek:number}|null}
 */
export function projectGoalDate(series, goalKg, todayStr) {
  if (!isNum(goalKg) || series.length < 8) return null;
  const last = series[series.length - 1];
  const from = addDays(last.date, -28);
  const win = series.filter((p) => p.date >= from);
  if (win.length < 8) return null;
  const first = win[0];
  const span = diffDays(first.date, last.date);
  if (span < 7) return null;
  const slope = (last.trend - first.trend) / span; // kg per day
  const gap = goalKg - last.trend;
  if (Math.abs(gap) < 0.05) return { date: todayStr, days: 0, slopeKgPerWeek: slope * 7 };
  if (slope === 0 || Math.sign(slope) !== Math.sign(gap)) return null;
  const days = Math.ceil(gap / slope);
  if (!(days >= 0) || days > 365 * 5) return null;
  return { date: addDays(todayStr, days), days, slopeKgPerWeek: slope * 7 };
}

/**
 * Recipe nutrition: totals, per serving, and per 100 g when cookedGrams is set.
 * @param {{servings:number, cookedGrams?:number|null, ingredients:Array<{per:Object, qty:number}>}} recipe
 */
export function recipeNutrition(recipe) {
  const { total, unknown } = sumEntries(recipe.ingredients || []);
  const servings = isNum(recipe.servings) && recipe.servings > 0 ? recipe.servings : 1;
  const per = scaleNutrients(total, 1 / servings);
  const cooked = isNum(recipe.cookedGrams) && recipe.cookedGrams > 0 ? recipe.cookedGrams : null;
  const per100g = cooked ? scaleNutrients(total, 100 / cooked) : null;
  return { total, unknown, servings, perServing: per, per100g, gramsPerServing: cooked ? cooked / servings : null };
}

/**
 * Recipe as a loggable Food.
 * @param {Object} recipe recipes record
 * @returns {Object} Food
 */
export function recipeAsFood(recipe) {
  const r = recipeNutrition(recipe);
  const label = '1 serving';
  const food = {
    key: `recipe:${recipe.id}`,
    name: recipe.name,
    brand: 'Recipe',
    source: 'recipe',
    per100g: r.per100g,
    servings: [{ label, grams: r.gramsPerServing, per: r.perServing }],
  };
  return food;
}

/**
 * Custom food record as a Food (adds key and source).
 * @param {Object} cf customFoods record
 */
export function customAsFood(cf) {
  return {
    key: `custom:${cf.id}`,
    name: cf.name,
    brand: cf.brand || '',
    source: 'custom',
    per100g: cf.per100g || null,
    servings: cf.servings && cf.servings.length ? cf.servings : [],
  };
}

/**
 * Totals of a saved meal's items.
 * @param {{items:Array<{per:Object, qty:number}>}} meal
 */
export function mealTotals(meal) {
  return sumEntries(meal.items || []);
}

/**
 * Human text for a log entry's amount: "1 medium", "1.5 × 1 cup", "150 g".
 * @param {{qty:number, serving:{label:string}}} e
 * @param {(n:number)=>string} fq quantity formatter
 */
export function servingText(e, fq) {
  const label = cleanLabel((e.serving && e.serving.label) || 'serving'); // entries logged before a label was tidied are shown tidy too
  const q = fq(e.qty);
  if (label === 'g' || label === 'oz') return `${q} ${label}`;
  if (e.qty === 1) return /^\d/.test(label) ? label : `1 ${label}`;
  return `${q} × ${label}`;
}

/**
 * Rebalance after one macro changes: the others share what is left, in proportion to their old values.
 * @param {{protein:number,carbs:number,fat:number}} pct
 * @param {'protein'|'carbs'|'fat'} key changed key
 * @param {number} value new value for key (0-100)
 */
export function rebalance(pct, key, value) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
  const others = ['protein', 'carbs', 'fat'].filter((k) => k !== key);
  const rest = 100 - v;
  const sum = others.reduce((a, k) => a + pct[k], 0);
  const out = { [key]: v };
  if (sum <= 0) {
    out[others[0]] = Math.round(rest / 2);
    out[others[1]] = rest - out[others[0]];
  } else {
    out[others[0]] = Math.round((pct[others[0]] / sum) * rest);
    out[others[1]] = rest - out[others[0]];
  }
  return { protein: out.protein, carbs: out.carbs, fat: out.fat };
}

/**
 * Build the stored custom-food shape from form values.
 * @param {{name:string, brand:string, label:string, grams:number|null, per:Object}} v
 */
export function buildCustomFood(v) {
  const per = { ...emptyNutrients(), ...v.per };
  const grams = v.grams && v.grams > 0 ? v.grams : null;
  return {
    name: v.name.trim(),
    brand: v.brand.trim(),
    per100g: grams ? scaleNutrients(per, 100 / grams) : null,
    servings: [{ label: v.label.trim() || '1 serving', grams, per }],
  };
}
