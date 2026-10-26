// views/today.js - dashboard for the selected date: calorie ring, macros, meals, water, weight, streak, note.
import { h, icon, button, numInput, toast, emptyState, rafOnce } from '../ui.js';
import { bus } from '../bus.js';
import { store } from '../store.js';
import { getDate } from '../state.js';
import { loadDay } from '../day.js';
import { dateNav, card, notice, mealLabel } from '../components.js';
import { macroBars } from '../facts.js';
import { ring, sparkline } from '../charts.js';
import { trendSeries } from '../nutrition.js';
import { today, addDays, streak as calcStreak } from '../dates.js';
import { fmtInt, formatWeight, weightFromDisplay, weightToDisplay, formatWater, glassMl, LIMITS } from '../units.js';
import { openWaterSheet, openNoteSheet, openWeightSheet, onLongPress } from '../quick-sheets.js';

function ringCard(d) {
  const { budget, tgt } = d;
  const left = Math.abs(budget.remaining);
  const stats = h('dl', { class: 'ledger' },
    h('div', null, h('dt', null, 'Goal'), h('dd', { class: 'num' }, fmtInt(tgt.target))),
    h('div', null, h('dt', null, d.settings.addExerciseCalories ? 'Exercise' : 'Exercise (not counted)'), h('dd', { class: 'num' }, d.settings.addExerciseCalories ? `+${fmtInt(d.exKcal)}` : fmtInt(d.exKcal))),
    h('div', null, h('dt', null, 'Food'), h('dd', { class: 'num' }, fmtInt(d.eaten))),
  );
  return card(null, [
    h('div', { class: 'ring-card' },
      h('div', { class: 'ring-wrap' },
        ring({ value: d.eaten, max: budget.budget, over: budget.over, ariaLabel: `${fmtInt(d.eaten)} of ${fmtInt(budget.budget)} calories eaten` }),
        h('div', { class: `ring-center${budget.over ? ' over' : ''}` }, h('div', { class: 'ring-num num' }, fmtInt(left)), h('div', { class: 'ring-label' }, budget.over ? 'kcal over' : 'kcal left'))),
      stats),
    tgt.source === 'default' ? notice('Using a default 2,000 kcal budget.', 'info', h('a', { href: '#/more', class: 'link' }, 'Set your goal')) : null,
    tgt.clamped ? notice(`Your calculated budget was raised to the ${tgt.floor} kcal minimum. Going lower is not recommended without medical supervision.`, 'warn') : null,
  ], { cls: 'ring-section' });
}

function mealsCard(d) {
  return card('Meals', h('ul', { class: 'rows' }, d.byMeal.map((m) => {
    const kcal = Math.round(m.total.kcal);
    return h('li', null, h('a', { class: 'row-link', href: '#/diary' }, h('span', { class: 'row-name' }, mealLabel(d.settings, m.meal)), h('span', { class: `row-val num${kcal ? '' : ' faint'}` }, kcal ? `${fmtInt(kcal)} kcal` : 'Nothing yet'), icon('chevR', 16)));
  })));
}

function waterCard(d) {
  const unit = d.settings.units.water;
  const goal = d.settings.waterGoalMl;
  const pct = goal ? Math.min(100, (d.water / goal) * 100) : 0;
  const gl = glassMl(unit);
  const add = button(`+${unit === 'oz' ? 8 : 250} ${unit}`, () => store.addWater(d.date, gl), { variant: 'primary', ic: 'drop', cls: 'grow' });
  add.setAttribute('aria-label', `Add ${unit === 'oz' ? 8 : 250} ${unit} of water`);
  add.title = 'Tap to add a glass. Press and hold to set an exact amount.';
  onLongPress(add, () => openWaterSheet(d.date));
  return card('Water', [
    h('div', { class: 'big-val' }, h('span', { class: 'num' }, formatWater(d.water, unit).replace(` ${unit}`, '')), h('span', { class: 'big-of' }, ` / ${formatWater(goal, unit)}`)),
    h('div', { class: 'bar water', role: 'progressbar', 'aria-label': 'Water progress', 'aria-valuemin': 0, 'aria-valuemax': goal, 'aria-valuenow': Math.round(d.water) }, h('span', { style: { width: `${pct}%` } })),
    h('div', { class: 'btn-row tight' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove ${unit === 'oz' ? 8 : 250} ${unit}`, title: 'Remove a glass', onclick: () => store.addWater(d.date, -gl), disabled: d.water <= 0 }, icon('minus', 18)),
      add,
      button('Set', () => openWaterSheet(d.date), { variant: 'ghost' })),
  ], { cls: 'water-card' });
}

function weightCard(d) {
  const unit = d.settings.units.weight;
  const todays = d.weights.find((w) => w.date === d.date);
  // The trend belongs to the day on screen: weigh-ins after it are ignored, so a past day shows that day's trend.
  const series = trendSeries(d.weights.filter((w) => w.date <= d.date).map((w) => ({ date: w.date, kg: w.kg })), { to: d.date });
  const trendNow = series.length ? series[series.length - 1].trend : null;
  const wk = series.length > 7 ? series[series.length - 8].trend : null;
  const change = trendNow != null && wk != null ? weightToDisplay(trendNow, unit) - weightToDisplay(wk, unit) : null;
  const last30 = series.slice(-30).map((p) => p.trend);
  let body;
  if (todays) {
    body = h('div', { class: 'big-val' }, h('span', { class: 'num' }, formatWeight(todays.kg, unit)), button('Edit', () => openWeightSheet(d.date), { variant: 'ghost' }));
  } else {
    const inp = numInput({ label: `Weight in ${unit}`, name: 'Weight', unit, dp: 1, max: LIMITS.weight, placeholder: unit === 'lb' ? 'e.g. 175.5' : 'e.g. 79.5' });
    const save = async () => {
      const n = inp.get();
      if (n == null) { inp.input.focus(); toast(inp.problem() || 'Enter your weight as a number.'); return; }
      const kg = weightFromDisplay(n, unit);
      if (kg < 20 || kg > 400) { toast('That weight looks off. Check the number and unit.'); return; }
      await store.setWeight(d.date, kg);
      toast(`Weight saved: ${formatWeight(kg, unit)}`);
    };
    inp.input.addEventListener('keydown', (e) => e.key === 'Enter' && save());
    body = h('div', { class: 'inline-form' }, inp.el, button('Save', save, { variant: 'primary' }));
  }
  const last = d.weights.length ? d.weights[d.weights.length - 1] : null;
  return card('Weight', [
    body,
    trendNow != null
      ? h('div', { class: 'trend-row' }, h('div', null, h('div', { class: 'trend-val num' }, formatWeight(trendNow, unit)), h('div', { class: 'muted small' }, change == null ? (d.date === today() ? 'Trend weight' : 'Trend weight on this day') : `Trend${d.date === today() ? '' : ' on this day'} · ${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change).toFixed(1)} ${unit} in 7 days`)), sparkline(last30, { label: 'Trend weight, last 30 days' }))
      : h('p', { class: 'muted small' }, last ? '' : 'Weigh in to start your trend line. It smooths daily ups and downs.'),
  ], { cls: 'weight-card' });
}

function noteCard(d) {
  const open = () => openNoteSheet(d.date);
  return card('Note', d.note
    ? h('button', { type: 'button', class: 'note-prev', onclick: open }, h('span', null, d.note))
    : h('button', { type: 'button', class: 'btn btn-ghost', onclick: open }, icon('edit', 18), h('span', null, 'Add a note')));
}

/** @param {HTMLElement} root */
export async function mount(root) {
  let alive = true;
  const nav = dateNav();
  const cols = h('div', { class: 'cols' });
  root.append(h('div', { class: 'page wide' }, h('header', { class: 'page-head' }, h('h1', null, 'Today'), nav.el), cols));
  const draw = async () => {
    const date = getDate();
    const d = await loadDay(date);
    if (!alive || date !== getDate()) return;
    const logged = await store.loggedDates(addDays(today(), -400), today());
    const n = calcStreak(logged, today());
    const streakCard = card(null, h('div', { class: 'streak' }, icon('flame', 22), h('div', null, h('strong', { class: 'num' }, `${n} ${n === 1 ? 'day' : 'days'} logged`), h('div', { class: 'muted small' }, n ? 'in a row' : 'Log a meal today to start a streak'))), { cls: 'streak-card' });
    cols.replaceChildren(
      h('div', { class: 'col' }, ringCard(d), card('Macros', macroBars(d.total, d.targets)), mealsCard(d)),
      h('div', { class: 'col' }, waterCard(d), weightCard(d), streakCard, noteCard(d)),
    );
  };
  const redraw = rafOnce(draw);
  const offs = [bus.on('change:*', redraw), bus.on('date:change', redraw)];
  await draw();
  return () => { alive = false; offs.forEach((o) => o()); nav.destroy(); };
}
