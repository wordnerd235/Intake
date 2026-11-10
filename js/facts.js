// facts.js - nutrient formatting + nutrition-facts / daily-nutrients tables + macro bars.
import { h, icon } from './ui.js';
import { NUTRIENTS, NUTRIENT_INFO } from './nutrition.js';
import { nutrientRow } from './nutrient-rows.js';
import { fmtInt, trimNum } from './units.js';

/**
 * Format a nutrient amount for display. Unknown stays "—"; sums with unknown parts show "≥".
 * @param {string} key
 * @param {number|null|undefined} v
 * @param {boolean} [partial] some contributors had no data
 * @param {boolean} [withUnit]
 */
export function fmtNutrient(key, v, partial = false, withUnit = false) {
  const info = NUTRIENT_INFO[key];
  if (v == null || !Number.isFinite(v)) return '—';
  if (partial && v === 0) return '—';
  const n = info.dp === 0 ? fmtInt(v) : v >= 1000 ? fmtInt(v) : trimNum(v, v < 10 ? Math.max(info.dp, 1) : info.dp);
  return `${partial ? '≥ ' : ''}${n}${withUnit ? ` ${info.unit}` : ''}`;
}

const MACRO_KEYS = [['protein', 'Protein'], ['carbs', 'Carbs'], ['fat', 'Fat']];

/**
 * Macro progress bars (grams vs target).
 * @param {Record<string,number>} total
 * @param {Object} targets from resolveTargets
 */
export function macroBars(total, targets) {
  return h('div', { class: 'macros' }, MACRO_KEYS.map(([k, label]) => {
    const v = total[k] || 0;
    const t = targets[k] && targets[k].value;
    const pct = t ? Math.min(100, (v / t) * 100) : 0;
    return h('div', { class: `macro m-${k}` },
      h('div', { class: 'macro-top' }, h('span', { class: 'macro-name' }, label), h('span', { class: 'macro-val num' }, `${fmtNutrient(k, v)}`, h('span', { class: 'macro-of' }, t ? ` / ${fmtInt(t)} g` : ' g'))),
      h('div', { class: 'bar', role: 'progressbar', 'aria-label': `${label} progress`, 'aria-valuemin': 0, 'aria-valuemax': t ? Math.round(t) : 0, 'aria-valuenow': Math.round(v) }, h('span', { style: { width: `${pct}%` } })),
    );
  }));
}

const ORDER_MAIN = ['protein', 'carbs', 'fat'];
const SUB = { fiber: 'carbs', sugar: 'carbs', addedSugar: 'carbs', satFat: 'fat', transFat: 'fat' };

/**
 * Nutrition-facts panel for one food/serving or a recipe: kcal, P/C/F, then the rest. Added sugars read like a US label
 * (indented under Total sugars), and "not listed" when the food (or any recipe ingredient) lacks them.
 * @param {Record<string, number|null>} n nutrient totals (null = unknown)
 * @param {{unknown?:Record<string,boolean>}} [o]
 */
export function factsPanel(n, o = {}) {
  const u = o.unknown || {};
  const row = (k, cls = '') => {
    if (k === 'addedSugar' && (n[k] == null || !Number.isFinite(n[k]) || u[k])) {
      return h('div', { class: 'fact sub sub2' }, h('span', { class: 'fact-name' }, NUTRIENT_INFO[k].label), h('span', { class: 'fact-val not-listed' }, 'not listed'));
    }
    if (k === 'addedSugar') cls = 'sub sub2';
    return h('div', { class: `fact ${cls}` }, h('span', { class: 'fact-name' }, NUTRIENT_INFO[k].label), h('span', { class: 'fact-val num' }, fmtNutrient(k, n[k], !!u[k], true)));
  };
  return h('div', { class: 'facts', 'aria-label': 'Nutrition facts' },
    h('div', { class: 'facts-kcal' }, h('span', null, 'Calories'), h('strong', { class: 'num' }, fmtNutrient('kcal', n.kcal, !!u.kcal))),
    ...ORDER_MAIN.flatMap((k) => [row(k, 'main'), ...NUTRIENTS.filter((s) => SUB[s] === k).map((s) => row(s, 'sub'))]),
    h('div', { class: 'facts-rule' }),
    ...['cholesterol', 'sodium', 'potassium', 'calcium', 'iron', 'vitA', 'vitC', 'vitD'].map((k) => row(k)),
  );
}

/**
 * Daily nutrient table: amount, target, % bar, limit/goal styling (see nutrientRow in nutrient-rows.js).
 * @param {Record<string,number>} total
 * @param {Record<string,boolean>} unknown
 * @param {Object} targets
 * @param {{missing?:Record<string,number>, count?:number}} [o] how many foods lacked each nutrient, out of `count`
 */
export function nutrientsTable(total, unknown, targets, o = {}) {
  const sum = { total, unknown, missing: o.missing || {}, count: o.count || 0 };
  const table = h('div', { class: 'ntable', role: 'table', 'aria-label': 'Daily nutrients' },
    h('div', { class: 'nrow nhead', role: 'row' }, h('span', { role: 'columnheader' }, 'Nutrient'), h('span', { role: 'columnheader', class: 'r' }, 'Amount'), h('span', { role: 'columnheader', class: 'r' }, 'Target'), h('span', { role: 'columnheader' }, '')),
    NUTRIENTS.map((k) => {
      const t = targets[k] || { value: null, kind: null };
      const v = total[k] || 0;
      const r = nutrientRow(k, sum, targets);
      const plain = r.bar != null && !t.value; // total sugars: a neutral bar with no target
      return h('div', { class: `nrow n-${k}${r.status === 'over' ? ' is-over' : ''}${r.status === 'under' || r.status === 'met' ? ' is-met' : ''}`, role: 'row' },
        h('span', { class: 'nname', role: 'cell' }, NUTRIENT_INFO[k].label, t.kind === 'limit' ? h('small', null, ' limit') : null),
        h('span', { class: 'nval num r', role: 'cell' }, fmtNutrient(k, v, !!unknown[k], true)),
        h('span', { class: 'ntgt num r', role: 'cell' }, t.value ? `${t.kind === 'limit' ? '≤ ' : ''}${fmtNutrient(k, t.value)}` : '—'),
        h('span', { class: 'npct', role: 'cell' }, r.bar != null
          ? h('span', { class: `bar thin${plain ? ' plain' : ''}` }, h('span', { style: { width: `${r.bar}%` } }), h('span', { class: 'bar-text num' }, r.text))
          : h('span', { class: 'bar-text' }, r.text)),
        r.note ? h('span', { class: 'nnote muted small', role: 'cell' }, r.note) : null,
      );
    }),
  );
  return h('div', { class: 'ntable-wrap' }, table, h('p', { class: 'muted small ntable-legend' }, '≥ means some logged foods have no data for that nutrient'));
}

/** Small circled star toggle used on food rows and the detail sheet. */
export function starIcon(on) {
  return icon(on ? 'starFill' : 'star', 20);
}
