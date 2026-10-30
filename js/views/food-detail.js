// views/food-detail.js - amount / unit / meal picker with a live nutrition-facts panel.
// Modes: add (log a new entry), edit (change a diary entry), pick (return an ingredient to a recipe/meal editor).
import { h, sheet, select, numInput, field, button, icon, toast } from '../ui.js';
import { store } from '../store.js';
import { resolveFood } from '../foods-db.js';
import { servingOptions, perForServing, scaleNutrients, servingText, customAsFood } from '../nutrition.js';
import { barcodeOfFood } from '../normalize.js';
import { openFoodEditor } from './food-editor.js';
import { factsPanel } from '../facts.js';
import { starIcon } from '../facts.js';
import { mealLabel } from '../components.js';
import { formatQty, shortLabel, parseAmount, amountProblem, ambiguousNumber, cleanLabel } from '../units.js';
import { today, addDays, formatDate } from '../dates.js';

const CHIPS = [['¼', 0.25], ['⅓', 1 / 3], ['½', 0.5], ['⅔', 2 / 3], ['¾', 0.75], ['1', 1], ['2', 2]];

/** Synthesize a Food from a log entry when the original food can no longer be found. */
function foodFromEntry(e) {
  return { key: e.foodKey, name: e.name, brand: e.brand || '', source: 'custom', per100g: null, servings: [{ label: e.serving.label, grams: e.serving.grams, per: e.per }] };
}

/**
 * Open the detail sheet.
 * @param {{food?:Object, mode?:'add'|'edit'|'pick', date?:string, meal?:number, entry?:Object, onDone?:(r:Object)=>void, title?:string}} o
 */
export async function openFoodDetail(o) {
  const mode = o.mode || 'add';
  const settings = await store.getSettings();
  let food = o.food;
  if (mode === 'edit') food = (await resolveFood(o.entry.foodKey, store)) || foodFromEntry(o.entry);
  if (!food) return null;

  let options = servingOptions(food);
  if (!options.length) options = [{ label: '1 serving', grams: null, per: {} }];
  const meta = await store.getFoodMeta(food.key);
  let idx = 0;
  let qty = 1;
  if (mode === 'edit') {
    const e = o.entry;
    const i = options.findIndex((s) => cleanLabel(s.label) === cleanLabel(e.serving.label)); // an entry logged under an older spelling of the label still finds its row
    if (i >= 0) options[i] = { ...options[i], per: e.per };
    else options.unshift({ label: e.serving.label, grams: e.serving.grams, per: e.per });
    idx = Math.max(0, i);
    qty = e.qty;
  } else if (meta && meta.lastServing && meta.lastServing.serving) {
    const i = options.findIndex((s) => cleanLabel(s.label) === cleanLabel(meta.lastServing.serving.label));
    if (i >= 0) { idx = i; qty = meta.lastServing.qty || 1; }
  }
  let meal = mode === 'edit' ? o.entry.meal : (o.meal ?? 0);
  let date = mode === 'edit' ? o.entry.date : (o.date || today());
  let fav = !!(meta && meta.favorite);

  const facts = h('div', { class: 'facts-host' });
  const err = h('div', { class: 'field-error', role: 'alert' });
  const qtyIn = numInput({ value: qty, label: 'Amount', onChange: () => update(), id: 'fd-qty' });
  qtyIn.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !primary.disabled) { e.preventDefault(); submit(); } });
  const unitSel = select(options.map((s, i) => ({ value: i, label: shortLabel(s.label) })), idx, (v) => changeUnit(+v), { id: 'fd-unit', 'aria-label': 'Serving size' });
  unitSel.title = cleanLabel(options[idx].label);
  [...unitSel.options].forEach((op, i) => { op.title = cleanLabel(options[i].label); });
  const mealSel = select([0, 1, 2, 3].map((i) => ({ value: i, label: mealLabel(settings, i) })), meal, (v) => { meal = +v; update(); }, { id: 'fd-meal' });
  const dateIn = h('input', { type: 'date', class: 'input', id: 'fd-date', value: date, onchange: (e) => { if (e.target.value) { date = e.target.value; update(); } } });
  const primary = button('', () => submit(), { variant: 'primary', cls: 'grow' });
  const favBtn = h('button', { type: 'button', class: 'icon-btn fav-btn', 'aria-pressed': String(fav), 'aria-label': 'Favorite', onclick: async () => { fav = await store.toggleFavorite(food); drawFav(); toast(fav ? 'Added to favorites' : 'Removed from favorites'); } });
  const drawFav = () => { favBtn.replaceChildren(starIcon(fav)); favBtn.setAttribute('aria-pressed', String(fav)); favBtn.classList.toggle('on', fav); };
  drawFav();

  const step = (dir) => {
    const cur = qtyIn.get() ?? 1;
    const lbl = options[idx].label;
    const inc = lbl === 'g' ? 10 : cur < 1 || (dir < 0 && cur <= 1) ? 0.5 : 1;
    const next = Math.round((cur + dir * inc) * 100) / 100;
    if (next > 0) { qtyIn.set(next); update(); }
  };
  const chips = h('div', { class: 'chip-row frac', role: 'group', 'aria-label': 'Quick amounts' }, CHIPS.map(([t, v]) => h('button', {
    type: 'button', class: 'chip', onclick: () => {
      const cur = qtyIn.get();
      qtyIn.set(v < 1 && cur != null && cur >= 1 && Number.isInteger(cur) ? cur + v : v);
      update();
    },
  }, t)));

  function changeUnit(i) {
    const cur = qtyIn.get();
    const a = options[idx];
    const b = options[i];
    if (cur != null && a.grams && b.grams) {
      const q = (cur * a.grams) / b.grams;
      qtyIn.set(b.label === 'g' ? Math.round(q) || 1 : Math.round(q * 100) / 100 || 1);
    } else if (b.label === 'g' && (cur == null || cur <= 5)) qtyIn.set(100);
    idx = i;
    unitSel.title = b.label;
    update();
  }

  /** The amount as a usable number, or null with the reason in `problem`. Limits: 10,000 servings and 10,000 g per entry. */
  function readQty() {
    const raw = qtyIn.raw().trim();
    const n = parseAmount(raw);
    if (ambiguousNumber(raw)) return { q: null, problem: `"${raw}" is unclear. Use a point for decimals (1.5) and no commas for thousands (1200).` };
    if (n == null || n === 0) return { q: null, problem: raw ? 'Enter an amount above 0, like 1, 1.5 or 1 1/2.' : 'Enter an amount like 1, 1.5 or 1 1/2.' };
    const tooBig = amountProblem(n, options[idx]); // names the limit that was broken: servings, grams, or the grams the servings come to
    return tooBig ? { q: null, problem: tooBig } : { q: n, problem: '' };
  }

  function update() {
    const { q, problem } = readQty();
    const valid = q != null;
    err.textContent = problem;
    qtyIn.input.classList.toggle('invalid', !valid && qtyIn.raw().trim() !== '');
    const per = perForServing(food, options[idx]);
    facts.replaceChildren(
      h('p', { class: 'facts-cap' }, valid ? `${servingText({ qty: q, serving: options[idx] }, formatQty)}${options[idx].grams && q ? ` · ${Math.round(options[idx].grams * q)} g` : ''}` : 'Amount needed'),
      factsPanel(scaleNutrients(per, valid ? q : 0)),
    );
    primary.disabled = !valid;
    primary.lastChild.textContent = mode === 'edit' ? 'Save changes' : mode === 'pick' ? 'Add ingredient' : `Add to ${mealLabel(settings, meal)}`;
  }

  async function submit() {
    const { q } = readQty();
    if (q == null) return;
    const opt = options[idx];
    const per = perForServing(food, opt);
    const serving = { label: opt.label, grams: opt.grams ?? null };
    const item = { foodKey: food.key, name: food.name, brand: food.brand || '', serving, qty: q, per };
    if (mode === 'pick') {
      await store.touchFoodMeta(food, serving, q);
      s.close();
      if (o.onDone) o.onDone(item);
      return;
    }
    if (mode === 'edit') {
      await store.updateLog(o.entry.id, { qty: q, serving, per, meal, date });
      s.close();
      toast('Changes saved');
      if (o.onDone) o.onDone();
      return;
    }
    const rec = await store.addLog({ ...item, date, meal });
    await store.touchFoodMeta(food, serving, q);
    s.close();
    toast(`Added to ${mealLabel(settings, meal)}`, { action: 'Undo', onAction: () => store.deleteLog(rec.id) });
    if (o.onDone) o.onDone(rec);
  }

  /**
   * Numbers wrong? Save a corrected copy as the user's own food (kept with the product's barcode so the next scan
   * finds it), or edit the user's own food in place, then reopen this sheet on the corrected food.
   */
  async function fixNutrition() {
    const onSaved = async (rec) => {
      s.close();
      const fixed = customAsFood(rec);
      if (mode !== 'edit') { openFoodDetail({ ...o, food: fixed }); return; }
      const sv = fixed.servings[0];
      const e = o.entry;
      const sameUnit = cleanLabel(sv.label) === cleanLabel(e.serving.label);
      const qtyNow = !sameUnit && e.serving.grams && sv.grams ? Math.round(((e.qty * e.serving.grams) / sv.grams) * 100) / 100 : e.qty;
      const entry = await store.updateLog(e.id, { foodKey: fixed.key, name: fixed.name, brand: fixed.brand, serving: { label: sv.label, grams: sv.grams ?? null }, per: perForServing(fixed, sv), qty: qtyNow });
      toast('Entry updated');
      if (o.onDone) o.onDone();
      openFoodDetail({ ...o, entry });
    };
    const id = food.source === 'custom' && /^custom:/.test(food.key) ? food.key.slice(7) : null;
    const own = id ? await store.getCustomFood(id) : null;
    if (own) { openFoodEditor({ food: own, onSaved }); return; }
    const base = options.find((x) => x.label !== 'g' && x.label !== 'oz') || options[idx]; // the package serving, not "g"
    openFoodEditor({
      title: 'Fix nutrition', onSaved,
      prefill: { name: food.name, brand: food.brand || '', label: cleanLabel(base.label), grams: base.grams ?? null, per: perForServing(food, base), barcode: barcodeOfFood(food) },
    });
  }
  const fixBtn = food.source === 'recipe' ? null : button(food.source === 'custom' && /^custom:/.test(food.key) ? 'Edit this food' : 'Numbers wrong? Fix nutrition', () => fixNutrition(), { variant: 'ghost', cls: 'fix-btn', ic: 'edit' });

  /** Copy this entry, as saved, to another day and meal (default: the next day, or today for a past day). Undo removes the copy. */
  function copySheet() {
    const e = o.entry;
    let to = e.date < today() ? today() : addDays(e.date, 1);
    let toMeal = e.meal;
    const toDate = h('input', { type: 'date', class: 'input', id: 'ce-date', value: to, onchange: (ev) => { if (ev.target.value) to = ev.target.value; } });
    const toMealSel = select([0, 1, 2, 3].map((i) => ({ value: i, label: mealLabel(settings, i) })), toMeal, (v) => { toMeal = +v; }, { id: 'ce-meal' });
    const cs = sheet({
      title: 'Copy to another day', size: 'sm',
      content: [h('p', { class: 'muted' }, `${e.name}, ${servingText(e, formatQty)} from ${formatDate(e.date, today())}`), field('Copy to date', toDate), field('Into meal', toMealSel)],
      footer: h('div', { class: 'btn-row' }, button('Copy', async () => {
        const rec = await store.copyLog(e.id, to, toMeal);
        cs.close();
        s.close();
        toast(`Copied to ${mealLabel(settings, toMeal)}, ${formatDate(to, today())}`, { action: 'Undo', onAction: () => store.deleteLog(rec.id) });
        if (o.onDone) o.onDone();
      }, { variant: 'primary' })),
    });
  }

  const copy = mode === 'edit' ? button('Copy', () => copySheet(), { variant: 'ghost', ic: 'copy' }) : null;
  const del = mode === 'edit' ? button('Delete', async () => {
    const prev = await store.deleteLog(o.entry.id);
    s.close();
    toast('Entry deleted', { action: 'Undo', onAction: () => store.restoreLog(prev) });
    if (o.onDone) o.onDone();
  }, { variant: 'ghost', cls: 'danger-text', ic: 'trash' }) : null;

  const body = [
    h('div', { class: 'fd-head' }, h('div', null, food.brand ? h('div', { class: 'muted' }, food.brand) : null, h('div', { class: 'muted small' }, ({ usda: 'USDA SR Legacy', off: 'Open Food Facts', fdc: 'USDA FoodData Central', custom: 'Your food', recipe: 'Recipe' })[food.source] || '')), favBtn),
    h('div', { class: 'amount-row' },
      h('div', { class: 'field qty' }, h('label', { for: 'fd-qty' }, 'Amount'), h('div', { class: 'stepper' }, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Decrease amount', onclick: () => step(-1) }, icon('minus', 18)), qtyIn.el, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Increase amount', onclick: () => step(1) }, icon('plus', 18)))),
      h('div', { class: 'field unit' }, h('label', { for: 'fd-unit' }, 'Serving'), unitSel)),
    chips, err,
    mode === 'pick' ? null : h('div', { class: 'two-up' }, field('Meal', mealSel), field('Date', dateIn)),
    facts,
    fixBtn,
  ];
  const s = sheet({ title: o.title || food.name, size: 'md', content: body, footer: h('div', { class: 'btn-row' }, del, copy, primary) });
  update();
  requestAnimationFrame(() => qtyIn.input.select());
  return s;
}
