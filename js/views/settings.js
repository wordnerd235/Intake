// views/settings.js - More: profile & goal, calories & macros, units, display, sync, data, about.
import { h, icon, field, select, segmented, numInput, toast, mount as mountEl } from '../ui.js';
import { store } from '../store.js';
import { card, notice } from '../components.js';
import { calorieTarget, ACTIVITY_LABELS, KCAL_PER_KG } from '../nutrition.js';
import { lbToKg, kgToLb, cmToFtIn, ftInToCm, paceChoices, weightToDisplay, weightFromDisplay, ozToMl, mlToOz, fmtInt, formatWeight, LIMITS } from '../units.js';
import { macroSection, targetsSection } from './settings-targets.js';
import { dataSection, aboutSection } from './settings-data.js';
import { applyTheme } from '../theme.js';
import { cloud } from '../cloud.js';
import { birthYearRange } from '../dates.js';

/** @param {HTMLElement} root */
export async function mount(root) {
  let alive = true;
  const page = h('div', { class: 'page wide' });
  root.append(page);

  async function render() {
    let st = await store.getSettings();
    if (!alive) return;
    const weights = await store.allWeights();
    const kg = weights.length ? weights[weights.length - 1].kg : null;
    const u = st.units;
    const summary = h('div', { class: 'budget-box', 'aria-live': 'polite' });
    const drawSummary = async () => {
      const w = await store.allWeights();
      const t = calorieTarget(st, w.length ? w[w.length - 1].kg : null);
      const rows = [];
      if (t.source === 'default') rows.push(h('p', { class: 'muted' }, 'Add your sex, birth year and height, and log a weight, to calculate a personal budget. Until then Intake uses 2,000 kcal.'));
      else if (t.source === 'override') rows.push(h('p', null, 'Using your own daily budget.'));
      else {
        rows.push(h('dl', { class: 'ledger wide' },
          h('div', null, h('dt', null, 'Resting burn (BMR)'), h('dd', { class: 'num' }, `${fmtInt(t.bmr)} kcal`)),
          h('div', null, h('dt', null, 'With activity (TDEE)'), h('dd', { class: 'num' }, `${fmtInt(t.tdee)} kcal`)),
          h('div', null, h('dt', null, st.goalType === 'lose' ? 'Weight-loss deficit' : st.goalType === 'gain' ? 'Weight-gain surplus' : 'Goal adjustment'), h('dd', { class: 'num' }, `${t.adjust > 0 ? '+' : t.adjust < 0 ? '−' : ''}${fmtInt(Math.abs(t.adjust))} kcal`))));
        rows.push(h('p', { class: 'muted small' }, `BMR uses the Mifflin-St Jeor equation. ${st.goalType === 'maintain' ? 'Maintaining weight.' : `${fmtInt(KCAL_PER_KG)} kcal is about 1 kg of body weight.`}`));
      }
      if (t.clamped) rows.push(notice(`The calculated number (${fmtInt(t.raw)} kcal) is below the ${t.floor} kcal minimum, so Intake uses ${t.floor}. Choose a slower pace, or speak with a doctor before eating less.`, 'warn'));
      mountEl(summary, h('div', { class: 'budget-main' }, h('span', { class: 'muted' }, 'Daily calorie budget'), h('strong', { class: 'num' }, `${fmtInt(t.target)} kcal`)), rows);
      return t;
    };
    const save = async (patch) => { st = await store.saveSettings(patch); await drawSummary(); };

    // ---- profile & goal
    const birth = numInput({ value: st.birthYear, label: 'Birth year', allowZero: false, dp: 0, placeholder: 'e.g. 1990', id: 'pf-birth', inputmode: 'numeric' });
    birth.input.addEventListener('change', () => {
      const v = birth.get();
      const { min, max } = birthYearRange();
      if (v == null || v < min || v > max) { toast(`Enter a birth year between ${min} and ${max}.`); birth.set(st.birthYear ?? null); return; } // put the saved year back so the box shows what is used
      save({ birthYear: Math.round(v) });
    });
    const heightBox = (() => {
      if (u.height === 'cm') {
        const cm = numInput({ value: st.heightCm ? Math.round(st.heightCm) : null, label: 'Height in centimetres', unit: 'cm', dp: 0, id: 'pf-cm' });
        cm.input.addEventListener('change', () => { const v = cm.get(); if (v == null || v < 90 || v > 250) { toast('Enter a height between 90 and 250 cm.'); cm.set(st.heightCm ? Math.round(st.heightCm) : null); return; } save({ heightCm: v }); });
        return cm.el;
      }
      const fi = st.heightCm ? cmToFtIn(st.heightCm) : { ft: null, in: null };
      const ft = numInput({ value: fi.ft, label: 'Height, feet', unit: 'ft', dp: 0, id: 'pf-ft', inputmode: 'numeric' });
      const inch = numInput({ value: fi.in, label: 'Height, inches', unit: 'in', dp: 0, allowZero: true, id: 'pf-in', inputmode: 'numeric' });
      const apply = () => {
        const f = ft.get();
        const i = inch.get() ?? 0;
        if (f == null || f < 3 || f > 8 || i > 11) { toast('Enter feet (3 to 8) and inches (0 to 11).'); const back = st.heightCm ? cmToFtIn(st.heightCm) : { ft: null, in: null }; ft.set(back.ft); inch.set(back.in); return; }
        save({ heightCm: ftInToCm(f, i) });
      };
      ft.input.addEventListener('change', apply);
      inch.input.addEventListener('change', apply);
      return h('div', { class: 'two-up tight' }, ft.el, inch.el);
    })();
    const goalW = numInput({ value: st.goalWeightKg ? weightToDisplay(st.goalWeightKg, u.weight) : null, label: `Goal weight in ${u.weight}`, unit: u.weight, dp: 1, id: 'pf-goal' });
    goalW.input.addEventListener('change', () => {
      const v = goalW.get();
      const kg = v == null ? null : weightFromDisplay(v, u.weight);
      const back = () => goalW.set(st.goalWeightKg ? weightToDisplay(st.goalWeightKg, u.weight) : null);
      if (goalW.raw().trim() && v == null) { toast('Enter a goal weight above 0, or clear the box for no goal.'); back(); return; }
      if (kg != null && (kg < 20 || kg > 400)) { toast(`Enter a goal weight between ${Math.ceil(weightToDisplay(20, u.weight))} and ${Math.floor(weightToDisplay(400, u.weight))} ${u.weight}.`); back(); return; }
      save({ goalWeightKg: kg });
    });
    const paces = paceChoices(u.weight);
    const nearest = paces.reduce((b, p) => (Math.abs(p.kg - st.weeklyRateKg) < Math.abs(b.kg - st.weeklyRateKg) ? p : b), paces[0]);
    const paceSel = select(paces.map((p) => ({ value: p.kg, label: p.label })), nearest.kg, (v) => save({ weeklyRateKg: +v }), { id: 'pf-pace', disabled: st.goalType === 'maintain' });
    const goalSeg = segmented([{ value: 'lose', label: 'Lose' }, { value: 'maintain', label: 'Maintain' }, { value: 'gain', label: 'Gain' }], st.goalType, async (v) => { await save({ goalType: v }); paceSel.disabled = v === 'maintain'; }, 'Goal');
    const profile = card('Profile and goal', [
      field('Sex (used for the calorie formula)', segmented([{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }], st.sex, (v) => save({ sex: v }), 'Sex')),
      field('Birth year', birth.el),
      field('Height', heightBox),
      field('Current weight', h('div', { class: 'static-val' }, kg ? formatWeight(kg, u.weight) : 'Not logged yet', h('a', { href: '#/today', class: 'link small' }, '  Log on Today'))),
      field('Goal', goalSeg),
      h('div', { class: 'two-up' }, field('Goal weight', goalW.el), field('Weekly pace', paceSel)),
      field('Activity level', select(Object.entries(ACTIVITY_LABELS).map(([value, label]) => ({ value, label })), st.activity, (v) => save({ activity: v }), { id: 'pf-act' })),
    ]);

    // ---- calories & macros
    const ovr = LIMITS.calorieOverride;
    const override = numInput({ value: st.calorieOverride, label: 'Daily calories override', name: 'Daily calories', unit: 'kcal', dp: 0, id: 'pf-ovr', placeholder: 'Use calculated', min: ovr.min, max: ovr.max });
    let savedOverride = st.calorieOverride ?? null;
    override.input.addEventListener('change', () => {
      const v = override.get();
      if (override.raw().trim() && v == null) { // rejected: say why and put the value that is really in use back in the box
        toast(`${override.problem()} Or clear the box to use the calculated budget.`);
        override.set(savedOverride);
        return;
      }
      savedOverride = v == null ? null : Math.round(v);
      save({ calorieOverride: savedOverride });
    });
    const t0 = await drawSummary();
    const calories = card('Calories and macros', [
      summary,
      field('Set my own daily calories', override.el, 'Leave empty to use the calculated budget.'),
      h('div', { class: 'toggle-row' }, h('label', { for: 'pf-ex' }, h('strong', null, 'Add exercise calories to my budget'), h('div', { class: 'muted small' }, 'Burned calories raise the day\'s budget.')),
        h('input', { type: 'checkbox', role: 'switch', class: 'switch', id: 'pf-ex', checked: st.addExerciseCalories, onchange: (e) => save({ addExerciseCalories: e.target.checked }) })),
      h('h3', { class: 'sub-head' }, 'Macro split'), macroSection(st, t0.target, () => drawSummary()),
      targetsSection(st, t0.target),
    ]);

    // ---- units & display
    const names = st.mealNames.map((n, i) => {
      const inp = h('input', { class: 'input', id: `mn-${i}`, maxlength: 24, value: n, autocomplete: 'off' });
      inp.addEventListener('change', () => { const next = st.mealNames.slice(); next[i] = inp.value.trim() || ['Breakfast', 'Lunch', 'Dinner', 'Snacks'][i]; inp.value = next[i]; save({ mealNames: next }); });
      return field(`Meal ${i + 1}`, inp);
    });
    const goalNow = Math.round(u.water === 'oz' ? mlToOz(st.waterGoalMl) : st.waterGoalMl);
    const goalWater = numInput({ value: goalNow, label: `Daily water goal in ${u.water}`, name: 'Water goal', unit: u.water, dp: 0, id: 'pf-water', max: LIMITS.waterGoal[u.water] });
    let savedGoal = goalNow;
    goalWater.input.addEventListener('change', () => {
      const v = goalWater.get();
      if (v == null) { toast(goalWater.problem() || 'Enter a water goal as a number.'); goalWater.set(savedGoal); return; }
      savedGoal = Math.round(v);
      save({ waterGoalMl: Math.round(u.water === 'oz' ? ozToMl(v) : v) });
    });
    const unitChange = async (patch) => { await store.saveSettings({ units: patch }); if (alive) render(); };
    const fdc = h('input', { class: 'input', id: 'pf-fdc', value: st.fdcApiKey || '', autocomplete: 'off', spellcheck: 'false', placeholder: 'Optional' });
    fdc.addEventListener('change', () => { save({ fdcApiKey: fdc.value.trim() }); toast(fdc.value.trim() ? 'USDA key saved' : 'USDA key removed'); });
    const display = card('Units and display', [
      h('div', { class: 'two-up' }, field('Weight', segmented([{ value: 'lb', label: 'lb' }, { value: 'kg', label: 'kg' }], u.weight, (v) => unitChange({ weight: v }), 'Weight unit')), field('Water', segmented([{ value: 'oz', label: 'fl oz' }, { value: 'ml', label: 'ml' }], u.water, (v) => unitChange({ water: v }), 'Water unit'))),
      field('Height', segmented([{ value: 'ftin', label: 'ft / in' }, { value: 'cm', label: 'cm' }], u.height, (v) => unitChange({ height: v }), 'Height unit')),
      field('Theme', segmented([{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], st.theme, (v) => { applyTheme(v); save({ theme: v }); }, 'Theme')),
      field('Daily water goal', goalWater.el),
      h('details', { class: 'more' }, h('summary', null, 'Meal names'), h('div', { class: 'two-up' }, names)),
      field('USDA FoodData Central API key', fdc, h('span', null, 'Optional. Without a key, USDA branded search uses a shared demo key with a very low limit. ', h('a', { href: 'https://fdc.nal.usda.gov/api-key-signup', target: '_blank', rel: 'noopener noreferrer', class: 'link' }, 'Get a free key'), '.')),
    ]);

    const cs = cloud.status();
    const account = card(null, h('a', { class: 'row-link big', href: '#/account' }, icon('cloud', 22), h('span', { class: 'row-name' }, h('strong', null, 'Account and sync'), h('span', { class: 'muted small block' }, cs.text)), icon('chevR', 16)));

    page.replaceChildren(
      h('header', { class: 'page-head' }, h('h1', null, 'More')),
      h('div', { class: 'cols' }, h('div', { class: 'col' }, profile, calories), h('div', { class: 'col' }, account, display, card('Your data', dataSection()), card('About', aboutSection()))),
    );
  }
  await render();
  return () => { alive = false; };
}
