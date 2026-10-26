// views/settings-targets.js - macro split (three linked sliders summing to 100) and per-nutrient target overrides.
import { h, field, numInput, toast } from '../ui.js';
import { store } from '../store.js';
import { NUTRIENTS, NUTRIENT_INFO, resolveTargets, calorieTarget, rebalance } from '../nutrition.js';
import { fmtNutrient } from '../facts.js';
import { fmtInt } from '../units.js';

/** Macro percentage card body. */
export function macroSection(settings, kcal, onSaved) {
  let pct = { ...settings.macroPct };
  const rows = {};
  const total = h('div', { class: 'macro-total num' });
  const labels = { protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };
  const fac = { protein: 4, carbs: 4, fat: 9 };
  const draw = () => {
    for (const k of Object.keys(labels)) {
      rows[k].input.value = String(pct[k]);
      rows[k].out.textContent = `${pct[k]}% · ${fmtInt((kcal * pct[k]) / 100 / fac[k])} g`;
      rows[k].input.style.setProperty('--fill', `${pct[k]}%`);
    }
    total.textContent = `Total ${pct.protein + pct.carbs + pct.fat}%`;
  };
  const el = h('div', { class: 'macro-sliders' }, Object.entries(labels).map(([k, label]) => {
    const input = h('input', { type: 'range', min: 0, max: 100, step: 1, id: `mp-${k}`, class: `slider s-${k}`, 'aria-label': `${label} percent of calories` });
    const out = h('span', { class: 'num slider-out' });
    rows[k] = { input, out };
    input.addEventListener('input', () => { pct = rebalance(pct, k, +input.value); draw(); });
    input.addEventListener('change', async () => { await store.saveSettings({ macroPct: pct }); if (onSaved) onSaved(); });
    return h('div', { class: 'slider-row' }, h('label', { for: `mp-${k}` }, label), input, out);
  }), total);
  draw();
  return el;
}

/** Nutrient target overrides table. */
export function targetsSection(settings, kcal) {
  const defaults = resolveTargets({ ...settings, nutrientTargets: {} }, kcal);
  const keys = NUTRIENTS.filter((k) => !['kcal', 'protein', 'carbs', 'fat'].includes(k));
  const inputs = {};
  const rows = keys.map((k) => {
    const info = NUTRIENT_INFO[k];
    const d = defaults[k];
    const cur = settings.nutrientTargets[k];
    const inp = numInput({ value: cur ?? null, label: `${info.label} target`, unit: info.unit, placeholder: d.value ? fmtNutrient(k, d.value) : 'none', id: `nt-${k}`, dp: 1, max: 100000 });
    inputs[k] = inp;
    inp.input.addEventListener('change', async () => {
      const raw = inp.raw().trim();
      const v = inp.get();
      const saved = (await store.getSettings()).nutrientTargets;
      if (raw && v == null) {
        toast(`${info.label} target: enter a number above 0, or clear the box to use the default.`);
        inp.set(saved[k] ?? null); // show what is actually in use
        return;
      }
      const next = { ...saved };
      if (v == null) delete next[k]; else next[k] = v;
      await store.saveSettings({ nutrientTargets: next });
    });
    const kind = (d.kind || (k === 'sugar' || k === 'transFat' ? 'limit' : 'goal')) === 'limit' ? 'limit (stay under)' : 'goal (reach)';
    return h('div', { class: 'target-row' }, h('label', { for: `nt-${k}` }, info.label, h('small', null, ` ${kind}`)), inp.el);
  });
  return h('details', { class: 'more' }, h('summary', null, 'Nutrient targets'), h('p', { class: 'muted small' }, 'Leave a box empty to use the default shown in grey. Limits turn red when exceeded; goals turn green when reached.'), h('div', { class: 'target-grid' }, rows));
}
