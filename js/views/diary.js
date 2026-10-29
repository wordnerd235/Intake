// views/diary.js - meals with entries, exercise, water + note, day totals and the Nutrients table.
import { h, icon, iconButton, button, sheet, field, select, toast, menu, confirm, choice, rafOnce } from '../ui.js';
import { bus } from '../bus.js';
import { store } from '../store.js';
import { getDate } from '../state.js';
import { loadDay } from '../day.js';
import { dateNav, card, entryRow, mealLabel, openNutrientsSheet } from '../components.js';
import { macroBars, nutrientsTable, fmtNutrient } from '../facts.js';
import { ring } from '../charts.js';
import { addDays, today, formatDate } from '../dates.js';
import { fmtInt, formatWater, glassMl } from '../units.js';
import { openAddFood } from './add-food.js';
import { openFoodDetail } from './food-detail.js';
import { openExerciseSheet } from './exercise.js';
import { openWaterSheet, openNoteSheet, onLongPress } from '../quick-sheets.js';

/** Copy a meal and offer Undo (deletes only the new rows). */
async function copyWithUndo(fromDate, fromMeal, toDate, toMeal, label) {
  const before = new Set((await store.logsForDate(toDate)).map((l) => l.id));
  const n = await store.copyMeal(fromDate, fromMeal, toDate, toMeal);
  if (!n) return toast(`Nothing to copy: ${label} was empty.`);
  const added = (await store.logsForDate(toDate)).filter((l) => !before.has(l.id));
  toast(`Copied ${n} ${n === 1 ? 'item' : 'items'}`, { action: 'Undo', onAction: () => Promise.all(added.map((l) => store.deleteLog(l.id))) });
}

/**
 * Copy every meal of a day into another day and offer Undo. When the target day already has entries, ask first:
 * add to them, or replace them. Undo removes the copied rows and brings back anything that was replaced.
 */
async function copyDayWithUndo(fromDate, toDate) {
  const src = await store.logsForDate(fromDate);
  if (!src.length) return toast(`Nothing to copy: ${formatDate(fromDate, today())} has no entries.`);
  const existing = await store.logsForDate(toDate);
  let replace = false;
  if (existing.length && fromDate !== toDate) {
    const items = `${existing.length} ${existing.length === 1 ? 'item' : 'items'}`;
    const mode = await choice({ title: `${formatDate(toDate, today())} already has ${items}`, message: `Add the ${src.length} copied ${src.length === 1 ? 'item' : 'items'} next to ${existing.length === 1 ? 'it' : 'them'}, or replace ${existing.length === 1 ? 'it' : 'them'}? Undo brings everything back.`, choices: [{ label: 'Replace', value: 'replace', danger: true }, { label: 'Add', value: 'add' }] });
    if (!mode) return;
    replace = mode === 'replace';
  }
  const before = new Set(existing.map((l) => l.id));
  const n = await store.copyDay(fromDate, toDate, { replace });
  const added = (await store.logsForDate(toDate)).filter((l) => !before.has(l.id));
  const where = formatDate(toDate, today());
  toast(replace ? `Replaced ${existing.length} with ${n} ${n === 1 ? 'item' : 'items'} on ${where}` : `Copied ${n} ${n === 1 ? 'item' : 'items'} to ${where}`, {
    action: 'Undo',
    onAction: () => Promise.all([...added.map((l) => store.deleteLog(l.id)), ...(replace ? existing.map((l) => store.restoreLog(l)) : [])]),
  });
}

function copyDaySheet(d) {
  const count = d.logs.length;
  let to = d.date < today() ? today() : addDays(d.date, 1);
  const dateIn = h('input', { type: 'date', class: 'input', id: 'cd-date', value: to, onchange: (e) => { if (e.target.value) to = e.target.value; } });
  const go = async () => {
    if (to === d.date && !(await confirm({ title: 'Copy onto the same day?', message: 'Every entry will appear twice on this day.', confirmLabel: 'Copy anyway' }))) return;
    s.close();
    await copyDayWithUndo(d.date, to);
  };
  const s = sheet({
    title: 'Copy whole day', size: 'sm',
    content: [h('p', { class: 'muted' }, `${count} ${count === 1 ? 'item' : 'items'} from ${formatDate(d.date, today())}, each in its own meal.`), field('Copy to date', dateIn)],
    footer: h('div', { class: 'btn-row' }, button('Copy day', go, { variant: 'primary' })),
  });
}

function copyToSheet(d, m) {
  let to = addDays(d.date, 1);
  let toMeal = m.meal;
  const dateIn = h('input', { type: 'date', class: 'input', id: 'ct-date', value: to, onchange: (e) => { if (e.target.value) to = e.target.value; } });
  const mealSel = select([0, 1, 2, 3].map((i) => ({ value: i, label: mealLabel(d.settings, i) })), toMeal, (v) => { toMeal = +v; }, { id: 'ct-meal' });
  const s = sheet({
    title: `Copy ${mealLabel(d.settings, m.meal)}`, size: 'sm',
    content: [h('p', { class: 'muted' }, `${m.logs.length} ${m.logs.length === 1 ? 'item' : 'items'} from ${formatDate(d.date, today())}`), field('Copy to date', dateIn), field('Into meal', mealSel)],
    footer: h('div', { class: 'btn-row' }, button('Copy', async () => { s.close(); await copyWithUndo(d.date, m.meal, to, toMeal, mealLabel(d.settings, m.meal)); }, { variant: 'primary' })),
  });
}

function saveMealSheet(d, m) {
  const name = h('input', { class: 'input', id: 'sm-name', maxlength: 80, value: mealLabel(d.settings, m.meal), autocomplete: 'off' });
  const go = async () => {
    if (!name.value.trim()) { name.focus(); return; }
    await store.saveMeal({ name: name.value.trim(), items: m.logs.map((l) => ({ foodKey: l.foodKey, name: l.name, brand: l.brand, serving: l.serving, qty: l.qty, per: l.per })) });
    s.close();
    toast('Meal saved. Find it under Foods > Meals.');
  };
  name.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  const s = sheet({ title: 'Save as meal', size: 'sm', content: [h('p', { class: 'muted' }, 'Reuse these items later with one tap from the Add food sheet.'), field('Meal name', name)], footer: h('div', { class: 'btn-row' }, button('Save meal', go, { variant: 'primary' })) });
  name.select();
}

function mealCard(d, m) {
  const name = mealLabel(d.settings, m.meal);
  const kcal = Math.round(m.total.kcal);
  const more = h('button', { type: 'button', class: 'icon-btn', 'aria-label': `${name} options`, 'aria-haspopup': 'menu' }, icon('more', 20));
  more.addEventListener('click', () => menu(more, [
    { label: 'Copy from yesterday', onClick: () => copyWithUndo(addDays(d.date, -1), m.meal, d.date, m.meal, `${name} yesterday`) },
    { label: 'Copy to date…', onClick: () => copyToSheet(d, m), disabled: !m.logs.length },
    { label: 'Save as meal…', onClick: () => saveMealSheet(d, m), disabled: !m.logs.length },
    '-',
    { label: `Clear ${name}`, danger: true, disabled: !m.logs.length, onClick: async () => {
      if (!(await confirm({ title: `Clear ${name}?`, message: `Remove ${m.logs.length} ${m.logs.length === 1 ? 'entry' : 'entries'} from ${formatDate(d.date, today())}.`, confirmLabel: 'Clear', danger: true }))) return;
      const prev = await store.clearMeal(d.date, m.meal);
      toast(`${name} cleared`, { action: 'Undo', onAction: () => Promise.all(prev.map((r) => store.restoreLog(r))) });
    } },
  ]));
  const sub = m.logs.length ? `P ${fmtNutrient('protein', m.total.protein)} · C ${fmtNutrient('carbs', m.total.carbs)} · F ${fmtNutrient('fat', m.total.fat)} g` : '';
  return h('section', { class: 'card meal', 'aria-label': name },
    h('div', { class: 'meal-head' }, h('div', null, h('h2', null, name), sub ? h('div', { class: 'meal-sub num' }, sub) : null), h('div', { class: 'meal-total num' }, m.logs.length ? `${fmtInt(kcal)} kcal` : ''), more),
    m.logs.length ? h('div', { class: 'entries' }, m.logs.map((e) => entryRow(e, { onClick: () => openFoodDetail({ mode: 'edit', entry: e }) }))) : null,
    h('button', { type: 'button', class: 'add-row', onclick: () => openAddFood({ date: d.date, meal: m.meal }) }, icon('plus', 18), h('span', null, 'Add food')));
}

function exerciseCard(d) {
  return card('Exercise', [
    d.exercise.length ? h('div', { class: 'entries' }, d.exercise.map((e) => h('button', { type: 'button', class: 'entry', onclick: () => openExerciseSheet({ date: d.date, entry: e }) },
      h('span', { class: 'entry-main' }, h('span', { class: 'entry-name' }, e.name), h('span', { class: 'entry-sub' }, e.minutes ? `${fmtInt(e.minutes)} min` : 'Custom')), h('span', { class: 'entry-kcal num' }, `+${fmtInt(e.kcal)}`)))) : null,
    h('button', { type: 'button', class: 'add-row', onclick: () => openExerciseSheet({ date: d.date }) }, icon('plus', 18), h('span', null, 'Add exercise'))], { cls: 'meal' });
}

function waterNoteCard(d) {
  const unit = d.settings.units.water;
  const add = button(`+${unit === 'oz' ? 8 : 250} ${unit}`, () => store.addWater(d.date, glassMl(unit)), { variant: 'secondary', ic: 'drop' });
  onLongPress(add, () => openWaterSheet(d.date));
  return card('Water and note', [
    h('div', { class: 'water-row' }, h('div', null, h('strong', { class: 'num' }, formatWater(d.water, unit)), h('span', { class: 'muted' }, ` of ${formatWater(d.settings.waterGoalMl, unit)}`)), h('div', { class: 'btn-row tight' }, add, button('Set', () => openWaterSheet(d.date), { variant: 'ghost' }))),
    h('button', { type: 'button', class: 'note-prev', onclick: () => openNoteSheet(d.date) }, d.note ? h('span', null, d.note) : h('span', { class: 'muted' }, icon('edit', 16), ' Add a note for this day')),
  ]);
}

function summary(d) {
  const b = d.budget;
  return [
    card(null, h('div', { class: 'sum-row' },
      h('div', { class: 'ring-wrap small' }, ring({ value: d.eaten, max: b.budget, over: b.over, size: 112, ariaLabel: `${fmtInt(d.eaten)} of ${fmtInt(b.budget)} calories` }), h('div', { class: `ring-center${b.over ? ' over' : ''}` }, h('div', { class: 'ring-num sm num' }, fmtInt(Math.abs(b.remaining))), h('div', { class: 'ring-label' }, b.over ? 'over' : 'left'))),
      h('dl', { class: 'ledger' },
        h('div', null, h('dt', null, 'Budget'), h('dd', { class: 'num' }, fmtInt(b.budget))),
        h('div', null, h('dt', null, 'Food'), h('dd', { class: 'num' }, fmtInt(d.eaten))),
        h('div', null, h('dt', null, d.settings.addExerciseCalories ? 'Exercise' : 'Exercise (not counted)'), h('dd', { class: 'num' }, d.settings.addExerciseCalories ? `+${fmtInt(d.exKcal)}` : fmtInt(d.exKcal))))), { cls: 'sum' }),
    card('Macros', macroBars(d.total, d.targets)),
  ];
}

/** @param {HTMLElement} root */
export async function mount(root) {
  let alive = true;
  const nav = dateNav();
  const cols = h('div', { class: 'cols diary-cols' });
  let current = null; // the day on screen, for the header menu
  const more = h('button', { type: 'button', class: 'icon-btn bordered', 'aria-label': 'Diary options', 'aria-haspopup': 'menu' }, icon('more', 20));
  more.addEventListener('click', () => menu(more, [
    { label: 'Copy whole day to…', onClick: () => copyDaySheet(current), disabled: !current || !current.logs.length },
    { label: 'Copy yesterday into this day', onClick: () => copyDayWithUndo(addDays(getDate(), -1), getDate()) },
  ]));
  root.append(h('div', { class: 'page wide' }, h('header', { class: 'page-head' }, h('div', { class: 'head-row' }, h('h1', null, 'Diary'), more), nav.el), cols));
  const draw = async () => {
    const date = getDate();
    const d = await loadDay(date);
    if (!alive || date !== getDate()) return;
    current = d;
    const totals = card(null, [
      h('div', { class: 'totals' }, h('div', null, h('div', { class: 'muted small' }, 'Day total'), h('div', { class: 'big-val' }, h('span', { class: 'num' }, fmtInt(d.eaten)), h('span', { class: 'big-of' }, ` of ${fmtInt(d.budget.budget)} kcal`))), h('div', { class: `rem num${d.budget.over ? ' over' : ''}` }, d.budget.over ? `${fmtInt(-d.budget.remaining)} over` : `${fmtInt(d.budget.remaining)} left`)),
      h('p', { class: 'muted small num' }, `P ${fmtNutrient('protein', d.total.protein)} g · C ${fmtNutrient('carbs', d.total.carbs)} g · F ${fmtNutrient('fat', d.total.fat)} g`),
      button('Nutrients', () => openNutrientsSheet(d), { variant: 'secondary', ic: 'list', cls: 'only-narrow' }),
    ], { cls: 'totals-card' });
    cols.replaceChildren(
      h('div', { class: 'col' }, d.byMeal.map((m) => mealCard(d, m)), exerciseCard(d), waterNoteCard(d), totals),
      h('div', { class: 'col side-col' }, summary(d), card('Nutrients', nutrientsTable(d.total, d.unknown, d.targets), { cls: 'only-wide' })),
    );
  };
  const redraw = rafOnce(draw);
  const offs = [bus.on('change:*', redraw), bus.on('date:change', redraw)];
  await draw();
  return () => { alive = false; offs.forEach((o) => o()); nav.destroy(); };
}
