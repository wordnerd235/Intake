// views/onboarding.js - first-run setup in four short steps: units, about you, goal, daily budget.
// Everything is skippable; finishing (or skipping) sets settings.onboarded so the gate lets the app open.
import { h, icon, field, segmented, select, numInput, button } from '../ui.js';
import { store } from '../store.js';
import { go } from '../router.js';
import { cloud } from '../cloud.js';
import { today, birthYearRange } from '../dates.js';
import { appFlags } from '../state.js';
import { backupPicker } from '../import-file.js';
import { calorieTarget, ACTIVITY_LABELS, DEFAULT_PROFILE, macroTargets } from '../nutrition.js';
import { cmToFtIn, ftInToCm, weightToDisplay, weightFromDisplay, paceChoices, fmtInt, formatWeight } from '../units.js';

const STEPS = ['Units', 'About you', 'Your goal', 'Daily budget'];

/** @param {HTMLElement} root */
export async function mount(root) {
  const base = await store.getSettings();
  // No sex is pre-selected: the calorie formula depends on it, so the person has to choose.
  const p = { ...base, units: { ...base.units }, weightKg: null, sex: base.birthYear ? base.sex : null };
  const page = h('div', { class: 'page onboarding' });
  root.append(page);
  let step = 0;

  const error = () => h('div', { class: 'field-error', role: 'alert', 'aria-live': 'assertive' });

  async function finish(skip) {
    const patch = { onboarded: true, units: p.units };
    if (!skip) {
      Object.assign(patch, { sex: p.sex, birthYear: p.birthYear, heightCm: p.heightCm, activity: p.activity, goalType: p.goalType, goalWeightKg: p.goalType === 'maintain' ? null : p.goalWeightKg, weeklyRateKg: p.weeklyRateKg });
      if (p.weightKg) Object.assign(patch, { startWeightKg: p.weightKg, startDate: today() });
    }
    const saved = await store.saveSettings(patch);
    appFlags.onboarded = !!saved.onboarded;
    if (!skip && p.weightKg) await store.setWeight(today(), p.weightKg);
    go('#/today');
  }

  const frame = (body, nav) => {
    const dots = h('ol', { class: 'steps', 'aria-label': `Step ${step + 1} of ${STEPS.length}` },
      STEPS.map((s, i) => h('li', { class: i === step ? 'on' : i < step ? 'done' : '', 'aria-current': i === step ? 'step' : null }, h('span', { class: 'sr-only' }, s))));
    page.replaceChildren(h('section', { class: 'card onb-card' },
      h('div', { class: 'onb-top' }, h('span', { class: 'brand-mark' }, 'Intake'), dots),
      body, nav));
    // Only auto-focus where a keyboard will not cover the form (mouse / trackpad).
    if (matchMedia('(pointer: fine)').matches) {
      const f = page.querySelector('input, select');
      if (f) f.focus({ preventScroll: true });
    }
  };
  const navRow = (back, next, nextLabel = 'Continue') =>
    h('div', { class: 'btn-row split onb-nav' }, back ? button('Back', back, { variant: 'ghost' }) : h('span'), button(nextLabel, next, { variant: 'primary' }));

  // ---- 0: units
  function stepUnits() {
    const skip = button('Skip setup, I will do this later', () => finish(true), { variant: 'ghost', cls: 'block' });
    const restore = backupPicker(async () => {
      const st = await store.getSettings();
      if (!st.onboarded) await store.saveSettings({ onboarded: true });
      appFlags.onboarded = true;
      go('#/today');
    });
    frame([
      h('h1', null, 'Welcome to Intake'),
      h('p', { class: 'lead' }, 'Log what you eat, see where you stand against your daily budget, and watch your weight trend. Your diary lives on this device, and it works without an account or a connection.'),
      h('div', { class: 'stack' },
        field('Weight', segmented([{ value: 'lb', label: 'Pounds' }, { value: 'kg', label: 'Kilograms' }], p.units.weight, (v) => { p.units.weight = v; }, 'Weight unit')),
        field('Height', segmented([{ value: 'ftin', label: 'Feet and inches' }, { value: 'cm', label: 'Centimetres' }], p.units.height, (v) => { p.units.height = v; }, 'Height unit')),
        field('Water', segmented([{ value: 'oz', label: 'Fluid ounces' }, { value: 'ml', label: 'Millilitres' }], p.units.water, (v) => { p.units.water = v; }, 'Water unit'))),
    ], h('div', null, navRow(null, () => { step = 1; draw(); }, 'Get started'), skip, button('Restore from a backup file', restore.open, { variant: 'ghost', cls: 'block', ic: 'upload' }), restore.input));
  }

  // ---- 1: about you
  function stepAbout() {
    const u = p.units;
    const err = error();
    const birth = numInput({ value: p.birthYear, label: 'Birth year', dp: 0, placeholder: 'e.g. 1990', inputmode: 'numeric', id: 'ob-birth' });
    let heightGet;
    let heightEl;
    if (u.height === 'cm') {
      const cm = numInput({ value: p.heightCm ? Math.round(p.heightCm) : null, label: 'Height in centimetres', unit: 'cm', dp: 0, id: 'ob-cm', inputmode: 'numeric' });
      heightEl = cm.el;
      heightGet = () => ({ cm: cm.get() });
    } else {
      const fi = p.heightCm ? cmToFtIn(p.heightCm) : { ft: null, in: null };
      const ft = numInput({ value: fi.ft, label: 'Height, feet', unit: 'ft', dp: 0, id: 'ob-ft', inputmode: 'numeric' });
      const inch = numInput({ value: fi.in, label: 'Height, inches', unit: 'in', dp: 0, allowZero: true, id: 'ob-in', inputmode: 'numeric' });
      heightEl = h('div', { class: 'two-up tight' }, ft.el, inch.el);
      heightGet = () => ({ cm: ft.get() == null ? null : ftInToCm(ft.get(), inch.get() ?? 0), bad: (inch.get() ?? 0) > 11 });
    }
    const wt = numInput({ value: p.weightKg ? weightToDisplay(p.weightKg, u.weight) : null, label: `Current weight in ${u.weight}`, unit: u.weight, dp: 1, id: 'ob-weight' });
    const next = () => {
      err.textContent = '';
      const by = birth.get();
      const ht = heightGet();
      const w = wt.get();
      const kg = w == null ? null : weightFromDisplay(w, u.weight);
      const yr = birthYearRange();
      const wMin = Math.ceil(weightToDisplay(20, u.weight));
      const wMax = Math.floor(weightToDisplay(400, u.weight));
      if (!p.sex) { err.textContent = 'Choose male or female. The calorie formula needs it.'; return; }
      if (by == null || by < yr.min || by > yr.max) { err.textContent = `Enter a birth year between ${yr.min} and ${yr.max}.`; birth.input.focus(); return; }
      if (ht.cm == null || ht.bad || ht.cm < 90 || ht.cm > 250) { err.textContent = u.height === 'cm' ? 'Enter a height between 90 and 250 cm.' : 'Enter feet (3 to 8) and inches (0 to 11).'; return; }
      if (kg == null) { err.textContent = 'Enter your current weight. It becomes the first entry in your weight log.'; wt.input.focus(); return; }
      if (kg < 20 || kg > 400) { err.textContent = `Enter a weight between ${wMin} and ${wMax} ${u.weight}.`; wt.input.focus(); return; }
      Object.assign(p, { birthYear: Math.round(by), heightCm: ht.cm, weightKg: kg });
      step = 2; draw();
    };
    frame([
      h('h1', null, 'About you'),
      h('p', { class: 'muted' }, 'These feed the calorie formula and stay on your device unless you turn on sync.'),
      h('div', { class: 'stack' },
        field('Sex (used by the formula)', segmented([{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }], p.sex, (v) => { p.sex = v; }, 'Sex')),
        field('Birth year', birth.el),
        field('Height', heightEl),
        field('Current weight', wt.el), err),
    ], navRow(() => { step = 0; draw(); }, next));
  }

  // ---- 2: goal
  function stepGoal() {
    const u = p.units;
    const err = error();
    const paces = paceChoices(u.weight);
    const nearest = paces.reduce((b, c) => (Math.abs(c.kg - p.weeklyRateKg) < Math.abs(b.kg - p.weeklyRateKg) ? c : b), paces[0]);
    const goalW = numInput({ value: p.goalWeightKg ? weightToDisplay(p.goalWeightKg, u.weight) : null, label: `Goal weight in ${u.weight}`, unit: u.weight, dp: 1, id: 'ob-goal' });
    const paceSel = select(paces.map((c) => ({ value: c.kg, label: c.label })), nearest.kg, (v) => { p.weeklyRateKg = +v; }, { id: 'ob-pace' });
    p.weeklyRateKg = +paceSel.value;
    const goalBlock = h('div', { class: 'two-up' }, field('Goal weight', goalW.el), field('Weekly pace', paceSel));
    const sync = () => { goalBlock.hidden = p.goalType === 'maintain'; };
    const seg = segmented([{ value: 'lose', label: 'Lose weight' }, { value: 'maintain', label: 'Maintain' }, { value: 'gain', label: 'Gain weight' }], p.goalType, (v) => { p.goalType = v; sync(); }, 'Goal');
    sync();
    const act = select(Object.entries(ACTIVITY_LABELS).map(([value, label]) => ({ value, label })), p.activity, (v) => { p.activity = v; }, { id: 'ob-act' });
    const next = () => {
      err.textContent = '';
      let g = null;
      if (p.goalType !== 'maintain') {
        if (goalW.raw().trim() && goalW.get() == null) { err.textContent = 'Goal weight must be a number, or leave it empty.'; goalW.input.focus(); return; }
        g = goalW.get() == null ? null : weightFromDisplay(goalW.get(), u.weight);
        if (g != null && (g < 20 || g > 400)) { err.textContent = `Enter a goal weight between ${Math.ceil(weightToDisplay(20, u.weight))} and ${Math.floor(weightToDisplay(400, u.weight))} ${u.weight}.`; return; }
        if (g != null && p.goalType === 'lose' && g >= p.weightKg) { err.textContent = `To lose weight, your goal must be below your current ${formatWeight(p.weightKg, u.weight)}.`; return; }
        if (g != null && p.goalType === 'gain' && g <= p.weightKg) { err.textContent = `To gain weight, your goal must be above your current ${formatWeight(p.weightKg, u.weight)}.`; return; }
      }
      p.goalWeightKg = g;
      step = 3; draw();
    };
    frame([
      h('h1', null, 'Your goal'),
      h('div', { class: 'stack' }, field('What do you want to do?', seg), goalBlock, field('Activity level', act, 'Pick what a typical week looks like, not your best week.'), err),
    ], navRow(() => { step = 1; draw(); }, next));
  }

  // ---- 3: budget
  function stepBudget() {
    const t = calorieTarget({ ...DEFAULT_PROFILE, ...p }, p.weightKg);
    const m = macroTargets(t.target, p.macroPct);
    const adj = Math.round(t.adjust);
    const why = t.source !== 'calc' ? 'Add your details to calculate a personal budget.'
      : p.goalType === 'maintain' ? `Your body burns about ${fmtInt(t.tdee)} kcal a day, so that is your budget for holding steady.`
        : `Your body burns about ${fmtInt(t.tdee)} kcal a day. ${p.goalType === 'lose' ? 'Subtracting' : 'Adding'} ${fmtInt(Math.abs(adj))} kcal a day for your pace gives this budget.`;
    frame([
      h('h1', null, 'Your daily budget'),
      h('div', { class: 'onb-budget' }, h('div', { class: 'big-num num' }, fmtInt(t.target)), h('div', { class: 'muted' }, 'calories a day')),
      h('p', null, why),
      t.clamped ? h('div', { class: 'notice warn', role: 'alert' }, icon('alert', 18), h('span', null, `The calculated number (${fmtInt(t.raw)} kcal) is under the ${t.floor} kcal minimum, so Intake uses ${t.floor}. Choose a slower pace, or speak with a doctor before eating less.`)) : null,
      h('dl', { class: 'ledger wide' },
        h('div', null, h('dt', null, 'Protein'), h('dd', { class: 'num' }, `${fmtInt(m.protein)} g`)),
        h('div', null, h('dt', null, 'Carbs'), h('dd', { class: 'num' }, `${fmtInt(m.carbs)} g`)),
        h('div', null, h('dt', null, 'Fat'), h('dd', { class: 'num' }, `${fmtInt(m.fat)} g`))),
      h('p', { class: 'muted small' }, 'You can change any of this later in More. Intake is a tracking tool, not medical advice.'),
      cloud.configured ? h('p', { class: 'small' }, 'Already use Intake on another device? ', h('a', { href: '#/account', class: 'link' }, 'Sign in to sync'), '.') : null,
    ], navRow(() => { step = 2; draw(); }, () => finish(false), 'Start tracking'));
  }

  function draw() {
    [stepUnits, stepAbout, stepGoal, stepBudget][step]();
    window.scrollTo(0, 0);
  }
  draw();
}
