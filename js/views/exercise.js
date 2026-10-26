// views/exercise.js - Add / edit exercise: search the MET table, minutes -> live kcal (editable), or a custom entry.
import { h, sheet, field, numInput, button, icon, toast, spinner, debounce, mount } from '../ui.js';
import { store } from '../store.js';
import { searchExercises, loadExercises } from '../foods-db.js';
import { exerciseKcal } from '../nutrition.js';
import { notice } from '../components.js';
import { fmtInt, formatWeight, LIMITS } from '../units.js';
import { addDays, today } from '../dates.js';

const FALLBACK_KG = 70;

/**
 * @param {{date:string, entry?:Object, onDone?:()=>void}} o entry => edit mode
 */
export async function openExerciseSheet({ date, entry, onDone }) {
  const settings = await store.getSettings();
  const weights = await store.allWeights();
  const kg = weights.length ? weights[weights.length - 1].kg : settings.startWeightKg || null;
  const useKg = kg || FALLBACK_KG;
  let chosen = null; // {id,name,met} or {custom:true}
  let manual = false;

  const q = h('input', { type: 'search', class: 'input search', placeholder: 'Search exercises (walking, cycling, yoga…)', 'aria-label': 'Search exercises', autocomplete: 'off', id: 'ex-q' });
  const list = h('div', { class: 'results' });
  const listPane = h('div', null, h('div', { class: 'search-row' }, h('div', { class: 'search-box' }, icon('search', 18), q)), list);
  const formHost = h('div', { hidden: true });
  const minutes = numInput({ label: 'Minutes', unit: 'min', id: 'ex-min', dp: 1, max: LIMITS.exerciseMinutes, onChange: () => { manual = false; recalc(); } });
  const kcal = numInput({ label: 'Calories burned', name: 'Calories burned', unit: 'kcal', allowZero: true, id: 'ex-kcal', dp: 0, max: LIMITS.exerciseKcal, onChange: (v) => { manual = true; } });
  const nameIn = h('input', { class: 'input', id: 'ex-name', maxlength: 80, autocomplete: 'off' });
  const err = h('div', { class: 'field-error', role: 'alert' });
  const note = h('p', { class: 'muted small' });

  function recalc() {
    if (manual || !chosen || chosen.custom) return;
    const m = minutes.get();
    kcal.set(m ? exerciseKcal(chosen.met, useKg, m) : null);
  }
  function showForm(ex) {
    chosen = ex;
    manual = false;
    err.textContent = '';
    const custom = !!ex.custom;
    mount(formHost,
      h('div', { class: 'ex-chosen' }, h('strong', null, custom ? 'Custom exercise' : ex.name), custom ? null : h('span', { class: 'muted small' }, `MET ${ex.met}`)),
      custom ? field('Name', nameIn) : null,
      h('div', { class: 'two-up' }, field(custom ? 'Minutes (optional)' : 'Minutes', minutes.el), field('Calories burned', kcal.el, custom ? 'Enter the total.' : 'Edit to override the estimate.')),
      custom ? null : note, err);
    note.textContent = kg ? `Estimate: MET × ${formatWeight(kg, settings.units.weight)} × time.` : `No weight logged yet, so this uses ${FALLBACK_KG} kg. Log your weight for a better estimate.`;
    listPane.hidden = true;
    formHost.hidden = false;
    s.footer.hidden = false;
    saveBtn.textContent = entry ? 'Save changes' : 'Add exercise';
    (custom ? nameIn : minutes.input).focus();
  }

  const save = async () => {
    const k = kcal.get();
    const m = minutes.get();
    if (chosen.custom && !nameIn.value.trim()) { err.textContent = 'Give the exercise a name.'; nameIn.focus(); return; }
    if (minutes.problem() || (!chosen.custom && m == null)) { err.textContent = minutes.problem() || 'Enter how many minutes.'; minutes.input.focus(); return; }
    if (k == null) { err.textContent = kcal.problem() || 'Enter the calories burned.'; kcal.input.focus(); return; }
    const rec = { date, exerciseId: chosen.custom ? null : chosen.id, name: chosen.custom ? nameIn.value.trim() : chosen.name, minutes: m, kcal: k, met: chosen.custom ? null : chosen.met };
    if (entry) await store.updateExercise(entry.id, rec); else await store.addExercise(rec);
    s.close();
    toast(entry ? 'Exercise updated' : `Added ${fmtInt(k)} kcal burned`);
    if (onDone) onDone();
  };
  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary grow', onclick: save }, 'Add exercise');
  const del = entry ? button('Delete', async () => {
    const prev = await store.deleteExercise(entry.id);
    s.close();
    toast('Exercise deleted', { action: 'Undo', onAction: () => store.restoreExercise(prev) });
    if (onDone) onDone();
  }, { variant: 'ghost', cls: 'danger-text', ic: 'trash' }) : null;
  const back = entry ? null : button('Back', () => { formHost.hidden = true; listPane.hidden = false; s.footer.hidden = true; q.focus(); }, { variant: 'ghost' });
  const s = sheet({ title: entry ? 'Edit exercise' : 'Add exercise', size: 'md', content: [listPane, formHost], footer: h('div', { class: 'btn-row' }, del, back, saveBtn) });
  s.footer.hidden = true;

  const row = (ex) => h('div', { class: 'res-row' }, h('button', { type: 'button', class: 'res-main', onclick: () => showForm(ex) },
    h('span', { class: 'res-text' }, h('span', { class: 'res-name' }, ex.name), h('span', { class: 'res-sub' }, `${ex.cat || 'Exercise'} · MET ${ex.met}`)),
    h('span', { class: 'res-kcal num' }, fmtInt(exerciseKcal(ex.met, useKg, 30)), h('small', null, ' kcal/30 min'))));
  const customRow = h('div', { class: 'res-row' }, h('button', { type: 'button', class: 'res-main', onclick: () => showForm({ custom: true }) }, h('span', { class: 'res-text' }, h('span', { class: 'res-name' }, 'Custom exercise'), h('span', { class: 'res-sub' }, 'Enter a name and the calories yourself'))));

  let seq = 0;
  async function run() {
    const my = ++seq;
    const term = q.value.trim();
    list.replaceChildren(h('p', { class: 'muted res-hint' }, spinner('Loading'), ' Loading…'));
    try {
      const sections = [];
      if (!term) {
        const recent = await store.exerciseInRange(addDays(today(), -90), today());
        const seen = new Set();
        const rec = [];
        for (const e of recent.reverse()) {
          const k = e.exerciseId || e.name;
          if (seen.has(k) || !e.met || rec.length >= 6) continue;
          seen.add(k);
          rec.push({ id: e.exerciseId, name: e.name, met: e.met, cat: 'Recent' });
        }
        if (rec.length) sections.push(h('section', { class: 'res-sec' }, h('h3', null, 'Recent'), rec.map(row)));
      }
      const found = await searchExercises(term, term ? 30 : 12);
      if (my !== seq) return;
      sections.push(h('section', { class: 'res-sec' }, h('h3', null, term ? 'Exercises' : 'Popular'), found.length ? found.map(row) : h('p', { class: 'muted res-hint' }, `No exercise matches "${term}". Add it as a custom exercise.`)));
      sections.push(h('section', { class: 'res-sec' }, customRow));
      list.replaceChildren(...sections);
    } catch {
      if (my === seq) list.replaceChildren(notice("Couldn't load the exercise list. Connect once to download it, or add a custom exercise.", 'warn'), customRow);
    }
  }
  const deb = debounce(run, 150);
  q.addEventListener('input', deb);
  if (entry) {
    minutes.set(entry.minutes);
    kcal.set(entry.kcal);
    nameIn.value = entry.name;
    showForm(entry.exerciseId || entry.met ? { id: entry.exerciseId, name: entry.name, met: entry.met || 0 } : { custom: true });
    minutes.set(entry.minutes);
    kcal.set(entry.kcal);
    manual = true;
    if (chosen.custom) nameIn.value = entry.name;
  } else {
    loadExercises().catch(() => {});
    run();
  }
  return s;
}
