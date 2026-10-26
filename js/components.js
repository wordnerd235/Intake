// components.js - shared UI pieces: date navigator, log entry row, small cards.
import { h, icon, iconButton } from './ui.js';
import { bus } from './bus.js';
import { getDate, setDate } from './state.js';
import { today, addDays, formatDate, relativeLabel } from './dates.js';
import { entryTotal, servingText } from './nutrition.js';
import { formatQty, fmtInt, shortLabel } from './units.js';

/** Meal name from settings with a safe fallback. */
export const mealLabel = (settings, i) => (settings.mealNames && settings.mealNames[i]) || ['Breakfast', 'Lunch', 'Dinner', 'Snacks'][i] || `Meal ${i + 1}`;

/**
 * Shared date navigator: ‹ date › + Today + native picker. Keeps itself in sync with the selected date.
 * @returns {{el:HTMLElement, destroy:()=>void}}
 */
export function dateNav() {
  const label = h('span', { class: 'datenav-date' });
  const rel = h('span', { class: 'datenav-rel' });
  const picker = h('input', { type: 'date', class: 'datenav-input', 'aria-label': 'Choose a date', value: getDate() });
  const todayBtn = h('button', { type: 'button', class: 'chip', onclick: () => setDate(today()) }, 'Today');
  const el = h('div', { class: 'datenav' },
    iconButton('chevL', 'Previous day', () => setDate(addDays(getDate(), -1))),
    h('div', { class: 'datenav-mid' }, h('div', { class: 'datenav-text' }, label, rel), picker, icon('calendar', 16)),
    iconButton('chevR', 'Next day', () => setDate(addDays(getDate(), 1))),
    todayBtn,
  );
  const sync = () => {
    const d = getDate();
    const t = today();
    label.textContent = formatDate(d, t);
    rel.textContent = d === t ? 'Today' : relativeLabel(d, t) === formatDate(d, t) ? '' : relativeLabel(d, t);
    picker.value = d;
    todayBtn.hidden = d === t;
  };
  picker.addEventListener('change', () => picker.value && setDate(picker.value));
  sync();
  const off = bus.on('date:change', sync);
  return { el, destroy: off };
}

/**
 * One diary entry: name, brand + amount, kcal.
 * @param {Object} e foodLogs record
 * @param {{onClick?:()=>void}} [o]
 */
export function entryRow(e, o = {}) {
  const kcal = Math.round(entryTotal(e).kcal || 0);
  const amount = servingText(e, formatQty);
  const sub = [e.brand, amount].filter(Boolean).join(' · ');
  return h('button', { type: 'button', class: 'entry', onclick: o.onClick, title: `${e.name} - ${e.serving ? e.serving.label : ''}` },
    h('span', { class: 'entry-main' }, h('span', { class: 'entry-name' }, e.name), h('span', { class: 'entry-sub' }, sub.length > 90 ? shortLabel(sub, 90) : sub)),
    h('span', { class: 'entry-kcal num' }, fmtInt(kcal)),
  );
}

/** Card with an optional title row. */
export function card(title, children, { cls = '', right = null } = {}) {
  return h('section', { class: ['card', cls] }, title || right ? h('div', { class: 'card-head' }, title ? h('h2', null, title) : null, right) : null, children);
}

/** Inline notice (info / warn). */
export function notice(text, kind = 'info', action = null) {
  return h('div', { class: `notice ${kind}`, role: kind === 'warn' ? 'alert' : 'note' }, icon(kind === 'warn' ? 'alert' : 'info', 18), h('span', null, text), action);
}
