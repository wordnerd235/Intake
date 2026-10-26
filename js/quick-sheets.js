// quick-sheets.js - small sheets shared by Today and Diary: exact water, day note, weigh-in, long-press helper.
import { h, sheet, numInput, field, toast, button } from './ui.js';
import { store } from './store.js';
import { mlToOz, ozToMl, glassMl, formatWater, weightToDisplay, weightFromDisplay, formatWeight, LIMITS } from './units.js';
import { formatDate, today } from './dates.js';

/**
 * Long-press on an element runs `onLong`; a normal tap still fires its click handler.
 * @param {HTMLElement} el
 * @param {()=>void} onLong
 * @param {number} [ms]
 */
export function onLongPress(el, onLong, ms = 520) {
  let timer = null;
  let fired = false;
  const cancel = () => { clearTimeout(timer); timer = null; };
  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    fired = false;
    timer = setTimeout(() => { fired = true; onLong(); }, ms);
  });
  for (const t of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(t, cancel);
  el.addEventListener('click', (e) => { if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; } }, true);
  el.addEventListener('contextmenu', (e) => { if (timer || fired) e.preventDefault(); });
}

/** Set today's water exactly, in the user's unit. */
export async function openWaterSheet(date) {
  const st = await store.getSettings();
  const unit = st.units.water;
  const cur = await store.getWater(date);
  const val = unit === 'oz' ? mlToOz(cur) : cur;
  const inp = numInput({ value: Math.round(val), label: `Water in ${unit}`, name: 'Water', unit, allowZero: true, dp: 0, max: unit === 'oz' ? 2000 : 60000 });
  const err = h('div', { class: 'field-error', role: 'alert' });
  const save = async () => {
    const n = inp.get();
    if (n == null) { err.textContent = inp.problem() || 'Enter the total as a number.'; inp.input.focus(); return; }
    await store.setWater(date, unit === 'oz' ? ozToMl(n) : n);
    s.close();
    toast(`Water set to ${formatWater(unit === 'oz' ? ozToMl(n) : n, unit)}`);
  };
  inp.input.addEventListener('keydown', (e) => e.key === 'Enter' && save());
  const glass = Math.round(unit === 'oz' ? 8 : 250);
  const s = sheet({
    title: 'Water', size: 'sm',
    content: [h('p', { class: 'muted' }, `${formatDate(date, today())}. Goal ${formatWater(st.waterGoalMl, unit)}.`), field(`Total so far (${unit})`, inp.el), err,
      h('div', { class: 'chip-row' }, [1, 2, 4].map((n) => h('button', { type: 'button', class: 'chip', onclick: async () => { await store.addWater(date, glassMl(unit) * n); s.close(); } }, `+${glass * n} ${unit}`)))],
    footer: h('div', { class: 'btn-row' }, button('Save', save, { variant: 'primary' })),
  });
  inp.input.select();
}

/** Edit the note for a day. */
export async function openNoteSheet(date) {
  const cur = await store.getNote(date);
  const ta = h('textarea', { class: 'input', rows: 6, maxlength: 5000, 'aria-label': 'Note', placeholder: 'How did the day go? Hunger, energy, sleep, anything worth remembering.' });
  ta.value = cur;
  const s = sheet({
    title: 'Note', size: 'sm',
    content: [h('p', { class: 'muted' }, formatDate(date, today())), ta],
    footer: h('div', { class: 'btn-row' },
      cur ? button('Clear', async () => { await store.setNote(date, ''); s.close(); toast('Note cleared'); }, { variant: 'ghost' }) : null,
      button('Save', async () => { await store.setNote(date, ta.value); s.close(); toast('Note saved'); }, { variant: 'primary' })),
  });
}

/** Add / edit a weigh-in for a date. */
export async function openWeightSheet(date) {
  const st = await store.getSettings();
  const unit = st.units.weight;
  const cur = await store.getWeight(date);
  const inp = numInput({ value: cur == null ? null : weightToDisplay(cur, unit), label: `Weight in ${unit}`, name: 'Weight', unit, dp: 1, max: LIMITS.weight, placeholder: unit === 'lb' ? '175.0' : '80.0' });
  const err = h('div', { class: 'field-error', role: 'alert' });
  const save = async () => {
    const n = inp.get();
    if (n == null) { err.textContent = inp.problem() || 'Enter your weight as a number.'; inp.input.focus(); return; }
    const kg = weightFromDisplay(n, unit);
    if (kg < 20 || kg > 400) { err.textContent = 'That weight looks off. Check the number and unit.'; return; }
    await store.setWeight(date, kg);
    s.close();
    toast(`Weight saved: ${formatWeight(kg, unit)}`);
  };
  inp.input.addEventListener('keydown', (e) => e.key === 'Enter' && save());
  const s = sheet({
    title: cur == null ? 'Log weight' : 'Edit weight', size: 'sm',
    content: [h('p', { class: 'muted' }, formatDate(date, today())), field(`Weight (${unit})`, inp.el), err],
    footer: h('div', { class: 'btn-row' },
      cur != null ? button('Delete', async () => { await store.deleteWeight(date); s.close(); toast('Weigh-in deleted', { action: 'Undo', onAction: () => store.setWeight(date, cur) }); }, { variant: 'ghost', cls: 'danger-text' }) : null,
      button('Save', save, { variant: 'primary' })),
  });
}
