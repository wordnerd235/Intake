// views/meal-photo.js - "Estimate a meal from a photo": a photo of a plate goes to Google Gemini (the person's own key),
// each food it lists is matched to the USDA list when the numbers agree, and the person checks the portions before
// everything is logged together. Pure logic: meal-photo-core.js; the network call: gemini.js.
import { h, sheet, button, iconButton, numInput, select, field, spinner, toast } from '../ui.js';
import { store } from '../store.js';
import { searchLocal } from '../foods-db.js';
import { mealLabel, notice } from '../components.js';
import { fmtInt } from '../units.js';
import { sumNutrients } from '../nutrition.js';
import { pickMatch, itemNutrients, itemEntry } from '../meal-photo-core.js';

const macroLine = (n) => `${fmtInt(Math.round(n.kcal || 0))} kcal · P ${fmtInt(Math.round(n.protein || 0))} g · C ${fmtInt(Math.round(n.carbs || 0))} g · F ${fmtInt(Math.round(n.fat || 0))} g`;

/**
 * Open the meal photo sheet.
 * @param {{date:string, meal:number, onDone?:()=>void}} o
 */
export async function openMealPhoto({ date, meal, onDone }) {
  let settings = await store.getSettings();
  let m = meal;
  let ctl = null;
  const body = h('div', { class: 'mp' });
  /** Replace the sheet's content; optional parts passed as null are skipped (replaceChildren would print "null"). */
  const show = (...parts) => body.replaceChildren(...parts.filter(Boolean));
  const s = sheet({ title: 'Estimate a meal from a photo', size: 'md', content: body, onClose: () => { if (ctl) ctl.abort(); } });
  const pick = h('input', { type: 'file', accept: 'image/*', id: 'mp-file', hidden: true });
  pick.addEventListener('change', () => { const f = pick.files && pick.files[0]; pick.value = ''; if (f) estimate(f); });
  const photoButton = (label = 'Take or choose a photo', variant = 'primary') => button(label, () => pick.click(), { variant, ic: 'camera' });

  /** No key yet: say what it is for and take it here. */
  function askKey() {
    const keyIn = h('input', { class: 'input', id: 'mp-key', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'Paste your key' });
    const err = h('div', { class: 'field-error', role: 'alert' });
    const save = async () => {
      const k = keyIn.value.replace(/\s+/g, '');
      // Google decides whether a key is valid (key formats change); this only catches a partial or garbled paste.
      if (!/^[\x21-\x7e]{20,}$/.test(k)) { err.textContent = 'That looks like only part of a key. Copy the whole key from Google and paste it again.'; keyIn.focus(); return; }
      settings = await store.saveSettings({ geminiApiKey: k });
      start();
    };
    keyIn.addEventListener('keydown', (e) => e.key === 'Enter' && save());
    show(
      h('p', null, 'Gemini, Google\'s AI, looks at the photo and lists each food with an estimated amount. You check the amounts, then log them all at once.'),
      h('p', { class: 'muted small' }, 'It needs your own Google API key, saved only on this device. The photo is sent to Google; on the free tier Google may use it to improve its products. ', h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener noreferrer', class: 'link' }, 'Get a free key'), '.'),
      field('Google Gemini API key', keyIn), err,
    );
    s.showFooter(h('div', { class: 'btn-row' }, button('Save key', save, { variant: 'primary', cls: 'grow' })));
    keyIn.focus();
  }

  function start(message) {
    show(
      message ? notice(message, 'warn') : null,
      h('p', null, 'Take a photo of the food, or choose one. Get the whole plate in, from a little above, with the fork or a hand nearby for scale.'),
      pick,
    );
    s.showFooter(h('div', { class: 'btn-row' }, photoButton()));
  }

  async function estimate(file) {
    const url = URL.createObjectURL(file);
    const status = h('span', null, ' Asking Gemini what\'s on the plate…');
    show(h('img', { class: 'mp-photo', src: url, alt: 'Your photo' }), h('p', { class: 'muted', role: 'status' }, spinner('Estimating'), status), pick);
    s.showFooter(null);
    ctl = new AbortController();
    let r;
    try {
      const { estimateMeal } = await import('../gemini.js');
      r = await estimateMeal(file, settings.geminiApiKey, { signal: ctl.signal, onStatus: (t) => { status.textContent = ` ${t}`; } });
    } catch (e) {
      if (e && e.message === 'Cancelled') return;
      return start((e && e.message) || "Couldn't get an estimate.");
    } finally { ctl = null; }
    if (!r.items.length) return start(r.blocked ? 'Gemini declined to look at that photo.' : r.note || 'Gemini didn\'t find any food in that photo.');
    const rows = [];
    for (const it of r.items) {
      let match = null;
      try {
        const found = await searchLocal(it.search, 8);
        match = pickMatch(it, found);
      } catch { /* USDA list unavailable: keep Gemini's numbers */ }
      rows.push({ it, match });
    }
    review(url, rows, r.note);
  }

  function review(url, rows, note) {
    const total = h('p', { class: 'mp-total' });
    const err = h('div', { class: 'field-error', role: 'alert' });
    const list = h('ul', { class: 'mp-list' });
    const live = rows.map((row, i) => {
      const grams = numInput({ value: row.it.grams, label: `Amount of ${row.it.name}`, name: 'Amount', unit: 'g', dp: 0, id: `mp-g${i}`, max: 5000 });
      const line = h('span', { class: 'muted small block mp-macros' });
      const li = h('li', { class: 'mp-item' },
        h('div', { class: 'mp-name' }, h('strong', null, row.it.name),
          h('span', { class: 'muted small block' }, row.match ? `USDA: ${row.match.name}` : 'Gemini estimate (no close USDA match)'), line),
        h('div', { class: 'mp-amt' }, grams.el),
        iconButton('trash', `Remove ${row.it.name}`, () => { li.remove(); row.removed = true; update(); }));
      Object.assign(row, { grams, line, li });
      grams.input.addEventListener('input', update);
      list.append(li);
      return row;
    });
    const mealSel = select([0, 1, 2, 3].map((i) => ({ value: i, label: mealLabel(settings, i) })), m, (v) => { m = +v; update(); }, { id: 'mp-meal' });
    const add = button('Add', () => addAll(), { variant: 'primary', cls: 'grow' });
    function update() {
      const kept = live.filter((r) => !r.removed);
      for (const r of kept) { const g = r.grams.get(); r.line.textContent = g ? macroLine(itemNutrients(r.it, r.match, g)) : 'Enter the amount in grams'; }
      total.textContent = `Total: ${macroLine(sumNutrients(kept.filter((r) => r.grams.get()).map((r) => itemNutrients(r.it, r.match, r.grams.get()))).total)}`;
      add.disabled = !kept.length;
      add.lastChild.textContent = `Add ${kept.length === 1 ? 'it' : `all ${kept.length}`} to ${mealLabel(settings, m)}`;
    }
    async function addAll() {
      const kept = live.filter((r) => !r.removed);
      const bad = kept.find((r) => !r.grams.get());
      if (bad) { err.textContent = bad.grams.problem() || `Enter how many grams of ${bad.it.name}.`; bad.grams.input.focus(); return; }
      add.disabled = true;
      const ids = [];
      for (const r of kept) ids.push((await store.addLog({ ...itemEntry(r.it, r.match, r.grams.get()), date, meal: m })).id);
      s.close();
      toast(`Added ${ids.length} ${ids.length === 1 ? 'item' : 'items'} to ${mealLabel(settings, m)}`, { action: 'Undo', onAction: async () => { for (const id of ids) await store.deleteLog(id); } });
      if (onDone) onDone();
    }
    show(
      h('img', { class: 'mp-photo', src: url, alt: 'Your photo' }),
      note ? notice(`Gemini: ${note}`, 'info') : null,
      h('p', { class: 'muted small' }, 'These are estimates from a photo. Check each amount (a kitchen scale beats any photo), then add.'),
      list, total, field('Meal', mealSel), err, pick,
    );
    s.showFooter(h('div', { class: 'btn-row' }, photoButton('Another photo', 'ghost'), add));
    update();
  }

  if (settings.geminiApiKey) start();
  else askKey();
  return s;
}
