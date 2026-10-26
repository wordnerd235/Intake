// views/recipe-editor.js - build a recipe from ingredients; live per-serving (and per-100 g) nutrition.
import { h, sheet, field, numInput, button, icon, toast, confirm, mount } from '../ui.js';
import { store } from '../store.js';
import { recipeNutrition, entryTotal } from '../nutrition.js';
import { factsPanel } from '../facts.js';
import { fmtInt, shortLabel, MAX_QTY, LIMITS } from '../units.js';
import { openAddFood } from './add-food.js';

/**
 * @param {{recipe?:Object|null, onSaved?:(r:Object)=>void}} o
 */
export function openRecipeEditor(o = {}) {
  const r = o.recipe || null;
  const items = r ? r.ingredients.map((i) => ({ ...i })) : [];
  const name = h('input', { class: 'input', id: 're-name', maxlength: 120, autocomplete: 'off', value: r ? r.name : '' });
  const servings = numInput({ value: r ? r.servings : 4, label: 'Servings', name: 'Servings', id: 're-serv', onChange: () => draw(), dp: 2, max: LIMITS.servings });
  const cooked = numInput({ value: r ? r.cookedGrams : null, label: 'Cooked weight in grams', name: 'Cooked weight', unit: 'g', id: 're-cooked', onChange: () => draw(), dp: 1, max: LIMITS.cookedGrams });
  const note = h('textarea', { class: 'input', id: 're-note', rows: 3, maxlength: 2000, placeholder: 'Method, tips, where it came from…' });
  note.value = r ? r.note || '' : '';
  const list = h('div', { class: 'ing-list' });
  const live = h('div', { class: 'facts-host' });
  const err = h('div', { class: 'field-error', role: 'alert' });
  let amountBoxes = []; // one numInput per ingredient row, in order; rebuilt by draw()

  function draw() {
    amountBoxes = [];
    mount(list, items.length ? items.map((it, i) => {
      const q = numInput({ value: it.qty, label: `Amount of ${it.name}`, max: MAX_QTY, onChange: (v) => { if (v != null) { it.qty = v; drawTotals(); } } });
      amountBoxes.push(q);
      return h('div', { class: 'ing' },
        h('div', { class: 'ing-main' }, h('div', { class: 'ing-name', title: it.name }, it.name), h('div', { class: 'muted small' }, `${it.brand ? `${it.brand} · ` : ''}${shortLabel(it.serving.label, 36)} · ${fmtInt(entryTotal(it).kcal || 0)} kcal`)),
        h('div', { class: 'ing-qty' }, q.el, h('span', { class: 'muted small' }, '×')),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove ${it.name}`, onclick: () => { items.splice(i, 1); draw(); } }, icon('x', 18)));
    }) : h('p', { class: 'muted res-hint' }, 'No ingredients yet. Add what goes into the pot; amounts can be fractions like 1/2.'));
    drawTotals();
  }
  function drawTotals() {
    const sv = servings.get();
    const n = recipeNutrition({ servings: sv || 1, cookedGrams: cooked.get(), ingredients: items });
    live.replaceChildren(
      h('h3', { class: 'sub-head' }, sv ? `Per serving (1 of ${sv})` : 'Per serving'),
      factsPanel(n.perServing, { unknown: n.unknown }),
      n.per100g ? h('p', { class: 'muted small' }, `Per 100 g: ${fmtInt(n.per100g.kcal)} kcal · each serving is about ${fmtInt(n.gramsPerServing)} g`) : h('p', { class: 'muted small' }, 'Add the cooked weight to also log this recipe by grams.'));
  }

  const save = async () => {
    err.textContent = '';
    if (!name.value.trim()) { err.textContent = 'Give the recipe a name.'; name.focus(); return; }
    if (servings.get() == null) { err.textContent = servings.problem() || 'Servings must be a number greater than zero.'; servings.input.focus(); return; }
    if (cooked.raw().trim() && cooked.get() == null) { err.textContent = cooked.problem() || 'Cooked weight must be a number of grams.'; cooked.input.focus(); return; }
    if (!items.length) { err.textContent = 'Add at least one ingredient.'; return; }
    // a bad amount keeps the old one in `items` while the box shows the new text: never save that mismatch
    const bad = amountBoxes.findIndex((q) => q.get() == null);
    if (bad >= 0) { err.textContent = `Not saved. ${amountBoxes[bad].problem() || `Amount of ${items[bad].name} must be a number above 0.`}`; amountBoxes[bad].input.focus(); return; }
    try {
      const rec = await store.saveRecipe({ ...(r ? { id: r.id } : {}), name: name.value, servings: servings.get(), cookedGrams: cooked.get(), ingredients: items, note: note.value });
      s.close();
      toast(r ? 'Recipe updated' : 'Recipe saved');
      if (o.onSaved) o.onSaved(rec);
    } catch (e) { err.textContent = e.message; }
  };
  const del = r ? button('Delete', async () => {
    if (!(await confirm({ title: 'Delete this recipe?', message: `"${r.name}" will be removed. Past diary entries keep their numbers.`, confirmLabel: 'Delete', danger: true }))) return;
    const prev = await store.deleteRecipe(r.id);
    s.close();
    toast('Recipe deleted', { action: 'Undo', onAction: () => store.restoreRecipe(prev) });
    if (o.onSaved) o.onSaved(null);
  }, { variant: 'ghost', cls: 'danger-text', ic: 'trash' }) : null;

  const s = sheet({
    title: r ? 'Edit recipe' : 'New recipe', size: 'lg',
    content: [
      field('Recipe name *', name),
      h('div', { class: 'two-up' }, field('Servings *', servings.el, 'How many portions it makes.'), field('Cooked weight (optional)', cooked.el, 'Total grams after cooking.')),
      h('div', { class: 'sect-head' }, h('h3', { class: 'sub-head' }, 'Ingredients'), button('Add ingredient', () => openAddFood({ mode: 'pick', excludeRecipeId: r && r.id, onPick: (item) => { items.push(item); draw(); } }), { variant: 'secondary', ic: 'plus' })),
      list, live, field('Notes', note), err,
    ],
    footer: h('div', { class: 'btn-row' }, del, button('Save recipe', save, { variant: 'primary', cls: 'grow' })),
  });
  draw();
  return s;
}
