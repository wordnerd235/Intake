// day.js - loads everything a Today/Diary screen needs for one date and does the day math in one place.
import { store } from './store.js';
import { calorieTarget, dayBudget, resolveTargets, sumEntries, sumNutrients, entryTotal } from './nutrition.js';

/**
 * @param {string} date YYYY-MM-DD
 * @returns {Promise<Object>} day summary
 */
export async function loadDay(date) {
  const [settings, logs, exercise, water, note, weights] = await Promise.all([
    store.getSettings(), store.logsForDate(date), store.exerciseForDate(date), store.getWater(date), store.getNote(date), store.allWeights(),
  ]);
  const kg = weights.length ? weights[weights.length - 1].kg : null;
  const tgt = calorieTarget(settings, kg);
  const sum = sumEntries(logs);
  const byMeal = [0, 1, 2, 3].map((meal) => {
    const rows = logs.filter((l) => l.meal === meal);
    const s = sumEntries(rows);
    return { meal, logs: rows, total: s.total, unknown: s.unknown };
  });
  const exKcal = exercise.reduce((a, e) => a + (e.kcal || 0), 0);
  const eaten = Math.round(sum.total.kcal);
  const budget = dayBudget(tgt.target, exKcal, eaten, settings.addExerciseCalories);
  return {
    date, settings, logs, exercise, water, note, weights, kg, tgt, total: sum.total, unknown: sum.unknown, byMeal, exKcal, eaten, budget,
    targets: resolveTargets(settings, tgt.target),
  };
}

/**
 * Totals for a list of entries, with the kcal rounded for display.
 * @param {Array<{per:Object, qty:number}>} entries
 */
export function totalsOf(entries) {
  const s = sumEntries(entries);
  return { ...s, kcal: Math.round(s.total.kcal) };
}

export { sumNutrients, entryTotal };
