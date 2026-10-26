// views/food-editor.js - create / edit a custom food (nutrients per serving; kcal required).
import { h, sheet, field, numInput, button, toast, confirm } from '../ui.js';
import { store } from '../store.js';
import { NUTRIENTS, NUTRIENT_INFO, scaleNutrients, buildCustomFood } from '../nutrition.js';
import { MAX_GRAMS, maxForUnit } from '../units.js';

const MAIN = ['kcal', 'protein', 'carbs', 'fat'];
const MORE = NUTRIENTS.filter((k) => !MAIN.includes(k));

/**
 * @param {{food?:Object|null, prefill?:{name?:string}, onSaved?:(rec:Object)=>void, onDeleted?:()=>void}} o
 */
export function openFoodEditor(o = {}) {
  const f = o.food || null;
  const sv = f && f.servings && f.servings[0];
  const startPer = sv ? (sv.per || (f.per100g && sv.grams ? scaleNutrients(f.per100g, sv.grams / 100) : {})) : {};
  const name = h('input', { class: 'input', id: 'fe-name', maxlength: 120, autocomplete: 'off', value: f ? f.name : (o.prefill && o.prefill.name) || '', 'aria-required': 'true' });
  const brand = h('input', { class: 'input', id: 'fe-brand', maxlength: 80, autocomplete: 'off', value: f ? f.brand || '' : '' });
  const label = h('input', { class: 'input', id: 'fe-label', maxlength: 80, autocomplete: 'off', value: sv ? sv.label : '1 serving' });
  const grams = numInput({ value: sv ? sv.grams : null, label: 'Serving weight in grams', name: 'Serving weight', unit: 'g', id: 'fe-grams', dp: 1, max: MAX_GRAMS });
  const nums = {};
  for (const k of NUTRIENTS) nums[k] = numInput({ value: startPer[k] ?? null, label: NUTRIENT_INFO[k].label, unit: NUTRIENT_INFO[k].unit, allowZero: true, dp: 2, id: `fe-${k}`, max: maxForUnit(NUTRIENT_INFO[k].unit) });
  const err = h('div', { class: 'field-error', role: 'alert' });

  const save = async () => {
    err.textContent = '';
    if (!name.value.trim()) { err.textContent = 'Give the food a name.'; name.focus(); return; }
    const per = {};
    for (const k of NUTRIENTS) {
      const raw = nums[k].raw().trim();
      const v = nums[k].get();
      if (raw && v == null) { err.textContent = nums[k].problem() || `${NUTRIENT_INFO[k].label} must be a number.`; nums[k].input.focus(); return; }
      per[k] = v;
    }
    if (per.kcal == null) { err.textContent = 'Calories are required (use 0 if there are none).'; nums.kcal.input.focus(); return; }
    if (grams.raw().trim() && grams.get() == null) { err.textContent = grams.problem() || 'Serving weight must be a number of grams.'; grams.input.focus(); return; }
    try {
      const rec = await store.saveCustomFood({ ...(f ? { id: f.id } : {}), ...buildCustomFood({ name: name.value, brand: brand.value, label: label.value, grams: grams.get(), per }) });
      s.close();
      toast(f ? 'Food updated' : 'Food saved');
      if (o.onSaved) o.onSaved(rec);
    } catch (e) {
      err.textContent = e.message;
    }
  };
  const del = f ? button('Delete', async () => {
    if (!(await confirm({ title: 'Delete this food?', message: `"${f.name}" will be removed from My foods. Past diary entries keep their numbers.`, confirmLabel: 'Delete', danger: true }))) return;
    const prev = await store.deleteCustomFood(f.id);
    s.close();
    toast('Food deleted', { action: 'Undo', onAction: () => store.restoreCustomFood(prev) });
    if (o.onDeleted) o.onDeleted();
  }, { variant: 'ghost', cls: 'danger-text', ic: 'trash' }) : null;

  const grid = (keys) => h('div', { class: 'grid-fields' }, keys.map((k) => field(`${NUTRIENT_INFO[k].label}${k === 'kcal' ? ' *' : ''}`, nums[k].el)));
  const s = sheet({
    title: f ? 'Edit food' : 'Create food', size: 'md',
    content: [
      field('Name *', name), field('Brand (optional)', brand),
      h('div', { class: 'two-up' }, field('Serving name', label, 'e.g. 1 bar, 1 cup, 2 slices'), field('Serving weight (optional)', grams.el, 'Grams. Lets you log by g or oz.')),
      h('h3', { class: 'sub-head' }, 'Nutrition per serving'), grid(MAIN),
      h('details', { class: 'more' }, h('summary', null, 'More nutrients'), grid(MORE)),
      err,
    ],
    footer: h('div', { class: 'btn-row' }, del, button('Save food', save, { variant: 'primary', cls: 'grow' })),
  });
  return s;
}
