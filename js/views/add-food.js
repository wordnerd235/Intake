// views/add-food.js - the Add food sheet: search (yours + USDA + online), tabs, barcode, quick add, create food.
import { h, sheet, select, field, numInput, button, icon, iconButton, toast, spinner, debounce } from '../ui.js';
import { store } from '../store.js';
import { loadFoods, searchLocal, resolveFood } from '../foods-db.js';
import { buildIndex, searchIndex } from '../foods-search.js';
import { searchOFFWithRetry, searchFDC, barcodeOFF, barcodeFDC, describeError } from '../online-foods.js';
import { customForBarcode } from '../normalize.js';
import { servingOptions, perForServing, customAsFood, recipeAsFood, mealTotals, emptyNutrients, servingText } from '../nutrition.js';
import { mealLabel, notice } from '../components.js';
import { starIcon } from '../facts.js';
import { openFoodDetail } from './food-detail.js';
import { openFoodEditor } from './food-editor.js';
import { openBarcodeSheet } from '../barcode.js';
import { fmtInt, shortLabel, formatQty, cleanLabel, LIMITS } from '../units.js';
import { today } from '../dates.js';

/** Branded-food search results already fetched this session, by normalized query. Online sources are rate limited, so a repeat costs nothing. */
const onlineCache = new Map();
const normQ = (q) => q.trim().toLowerCase().replace(/\s+/g, ' ');

const TABS = [['all', 'All'], ['recent', 'Recent'], ['frequent', 'Frequent'], ['favorites', 'Favorites'], ['foods', 'My foods'], ['recipes', 'Recipes'], ['meals', 'Meals']];

const rank = (items, q, limit = 30) => {
  if (!q) return items.slice(0, limit);
  const idx = buildIndex(items.map((it) => ({ name: it.name, ref: it })));
  return searchIndex(idx, q, { limit }).map((h2) => h2.ref);
};

/** The serving + amount a one-tap add uses: last used for this food, else its default serving x 1. */
function defaultPick(food, meta) {
  const opts = servingOptions(food);
  if (meta && meta.lastServing && meta.lastServing.serving) {
    const s = opts.find((x) => cleanLabel(x.label) === cleanLabel(meta.lastServing.serving.label));
    if (s) return { serving: s, qty: meta.lastServing.qty || 1 };
  }
  return { serving: opts[0] || { label: '1 serving', grams: null, per: {} }, qty: 1 };
}

/** Quick Add sheet: a name and calories (+ optional P/C/F). */
export async function openQuickAdd({ date, meal, onDone }) {
  const settings = await store.getSettings();
  let m = meal;
  const name = h('input', { class: 'input', id: 'qa-name', maxlength: 80, placeholder: 'Quick add', autocomplete: 'off' });
  const kcal = numInput({ label: 'Calories', unit: 'kcal', allowZero: true, id: 'qa-kcal', dp: 0, max: LIMITS.kcal });
  const p = numInput({ label: 'Protein', unit: 'g', allowZero: true, id: 'qa-p', dp: 1, max: LIMITS.macroGrams });
  const c = numInput({ label: 'Carbs', unit: 'g', allowZero: true, id: 'qa-c', dp: 1, max: LIMITS.macroGrams });
  const f = numInput({ label: 'Fat', unit: 'g', allowZero: true, id: 'qa-f', dp: 1, max: LIMITS.macroGrams });
  const err = h('div', { class: 'field-error', role: 'alert' });
  const mealSel = select([0, 1, 2, 3].map((i) => ({ value: i, label: mealLabel(settings, i) })), m, (v) => { m = +v; }, { id: 'qa-meal' });
  const save = async () => {
    const k = kcal.get();
    if (k == null) { err.textContent = kcal.problem() || 'Enter the calories, for example 250.'; kcal.input.focus(); return; }
    for (const n of [p, c, f]) if (n.problem()) { err.textContent = n.problem(); n.input.focus(); return; }
    const per = { ...emptyNutrients(), kcal: k, protein: p.get(), carbs: c.get(), fat: f.get() };
    const rec = await store.addLog({ date, meal: m, foodKey: 'quick', name: name.value.trim() || 'Quick add', brand: '', serving: { label: 'serving', grams: null }, qty: 1, per });
    s.close();
    toast(`Added to ${mealLabel(settings, m)}`, { action: 'Undo', onAction: () => store.deleteLog(rec.id) });
    if (onDone) onDone(rec);
  };
  kcal.input.addEventListener('keydown', (e) => e.key === 'Enter' && save());
  const s = sheet({
    title: 'Quick add', size: 'sm',
    content: [field('Name (optional)', name), field('Calories *', kcal.el), h('div', { class: 'three-up' }, field('Protein', p.el), field('Carbs', c.el), field('Fat', f.el)), field('Meal', mealSel), err],
    footer: h('div', { class: 'btn-row' }, button(`Add`, save, { variant: 'primary', cls: 'grow' })),
  });
  return s;
}

/**
 * Open the Add food sheet.
 * @param {{date?:string, meal?:number, mode?:'log'|'pick', onPick?:(item:Object)=>void, excludeRecipeId?:string}} o
 */
export async function openAddFood(o = {}) {
  const mode = o.mode || 'log';
  loadFoods().catch(() => {}); // warm the USDA list while the sheet opens
  const settings = await store.getSettings();
  const date = o.date || today();
  let meal = o.meal ?? 0;
  let tab = 'all';
  let seq = 0;
  let onlineCtl = null;
  let autoTimer = 0;
  let forceOnline = false; // Enter was pressed: search online for this query
  const autoTried = new Set(); // queries that already had their one automatic online search
  const tabs = TABS.filter(([k]) => !(mode === 'pick' && k === 'meals'));

  const input = h('input', { type: 'search', class: 'input search', id: 'af-q', placeholder: 'Search foods', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search', 'aria-label': 'Search foods', autofocus: true });
  const results = h('div', { class: 'results', 'aria-live': 'polite' });
  const tabRow = h('div', { class: 'tabs-row', role: 'tablist', 'aria-label': 'Food lists' });
  const mealSel = mode === 'log' ? select([0, 1, 2, 3].map((i) => ({ value: i, label: mealLabel(settings, i) })), meal, (v) => { meal = +v; }, { 'aria-label': 'Meal', class: 'input meal-pick' }) : null;

  const drawTabs = () => tabRow.replaceChildren(...tabs.map(([k, label]) => h('button', { type: 'button', role: 'tab', class: `chip${k === tab ? ' on' : ''}`, 'aria-selected': String(k === tab), onclick: () => { tab = k; drawTabs(); run(); } }, label)));
  const afterAdd = () => { input.value = ''; run(); input.focus(); };

  async function openDetail(food) {
    await openFoodDetail({ food, mode: mode === 'log' ? 'add' : 'pick', date, meal, onDone: (r) => { if (mode === 'pick') { toast(`Added ${food.name}`); if (o.onPick) o.onPick(r); } afterAdd(); } });
  }
  async function quickLog(food, meta) {
    const { serving, qty } = defaultPick(food, meta);
    const per = perForServing(food, serving);
    const item = { foodKey: food.key, name: food.name, brand: food.brand || '', serving: { label: serving.label, grams: serving.grams ?? null }, qty, per };
    if (mode === 'pick') { await store.touchFoodMeta(food, item.serving, qty); toast(`Added ${food.name}`); if (o.onPick) o.onPick(item); afterAdd(); return; }
    const rec = await store.addLog({ ...item, date, meal });
    await store.touchFoodMeta(food, item.serving, qty);
    toast(`Added ${servingText({ qty, serving: item.serving }, formatQty)} to ${mealLabel(settings, meal)}`, { action: 'Undo', onAction: () => store.deleteLog(rec.id) });
    afterAdd();
  }
  async function addMeal(m) {
    const ids = [];
    for (const it of m.items) ids.push((await store.addLog({ ...it, date, meal })).id);
    toast(`Added ${ids.length} ${ids.length === 1 ? 'item' : 'items'} to ${mealLabel(settings, meal)}`, { action: 'Undo', onAction: () => Promise.all(ids.map((id) => store.deleteLog(id))) });
    afterAdd();
  }

  function foodRow(food, meta) {
    const { serving, qty } = defaultPick(food, meta);
    const kcal = perForServing(food, serving).kcal;
    const label = shortLabel(serving.label, 40);
    const sub = [food.brand, qty !== 1 ? servingText({ qty, serving: { label } }, formatQty) : label].filter(Boolean).join(' · ');
    return h('div', { class: 'res-row' },
      h('button', { type: 'button', class: 'res-main', onclick: () => openDetail(food), title: food.name },
        h('span', { class: 'res-text' }, h('span', { class: 'res-name' }, food.name), h('span', { class: 'res-sub' }, sub)),
        h('span', { class: 'res-kcal num' }, kcal == null ? '—' : fmtInt(kcal * qty), h('small', null, ' kcal')),
        meta && meta.favorite ? h('span', { class: 'res-star', 'aria-label': 'Favorite' }, starIcon(true)) : null),
      h('button', { type: 'button', class: 'icon-btn res-add', 'aria-label': `Add ${food.name}`, title: 'Add now', onclick: () => quickLog(food, meta) }, icon('plus', 20)));
  }
  function mealRow(m) {
    const kcal = Math.round(mealTotals(m).total.kcal);
    return h('div', { class: 'res-row' },
      h('button', { type: 'button', class: 'res-main', onclick: () => addMeal(m) },
        h('span', { class: 'res-text' }, h('span', { class: 'res-name' }, m.name), h('span', { class: 'res-sub' }, `Saved meal · ${m.items.length} ${m.items.length === 1 ? 'item' : 'items'}`)),
        h('span', { class: 'res-kcal num' }, fmtInt(kcal), h('small', null, ' kcal'))),
      h('button', { type: 'button', class: 'icon-btn res-add', 'aria-label': `Add all of ${m.name}`, title: 'Add all items', onclick: () => addMeal(m) }, icon('plus', 20)));
  }
  const section = (title, children, cls = '') => h('section', { class: `res-sec ${cls}` }, title ? h('h3', null, title) : null, children);
  const hint = (t) => h('p', { class: 'muted res-hint' }, t);

  async function foodsFromMetas(metas) {
    const out = [];
    for (const m of metas) {
      const food = (await resolveFood(m.id, store)) || m.food;
      if (food) out.push({ food, meta: m });
    }
    return out;
  }
  async function yourFoods(q) {
    const [customs, recipes, meals, recents, favs] = await Promise.all([store.listCustomFoods(), store.listRecipes(), store.listMeals(), store.recentFoods(120), store.favorites()]);
    const cand = new Map();
    const metaOf = new Map([...recents, ...favs].map((m) => [m.id, m]));
    for (const m of [...favs, ...recents]) if (m.food) cand.set(m.id, { name: m.food.name, kind: 'food', food: m.food, meta: m });
    for (const c of customs) cand.set(`custom:${c.id}`, { name: c.name, kind: 'food', food: customAsFood(c), meta: metaOf.get(`custom:${c.id}`) });
    for (const r of recipes) if (r.id !== o.excludeRecipeId) cand.set(`recipe:${r.id}`, { name: r.name, kind: 'food', food: recipeAsFood(r), meta: metaOf.get(`recipe:${r.id}`) });
    if (mode === 'log') for (const m of meals) cand.set(`meal:${m.id}`, { name: m.name, kind: 'meal', meal: m });
    return rank([...cand.values()], q, 8);
  }

  async function run() {
    const my = ++seq;
    clearTimeout(autoTimer);
    if (onlineCtl) onlineCtl.abort();
    const wantOnline = forceOnline;
    forceOnline = false;
    const q = input.value.trim();
    const paint = (...secs) => { if (my === seq) results.replaceChildren(...secs.filter(Boolean)); };
    if (tab !== 'all') {
      let rows = [];
      if (tab === 'recent') rows = await foodsFromMetas(await store.recentFoods(60));
      else if (tab === 'frequent') rows = await foodsFromMetas(await store.frequentFoods(60));
      else if (tab === 'favorites') rows = await foodsFromMetas(await store.favorites());
      else if (tab === 'foods') rows = (await store.listCustomFoods()).map((c) => ({ food: customAsFood(c) }));
      else if (tab === 'recipes') rows = (await store.listRecipes()).filter((r) => r.id !== o.excludeRecipeId).map((r) => ({ food: recipeAsFood(r) }));
      let list = rows.map((r) => ({ name: r.food.name, ...r }));
      let meals = tab === 'meals' ? await store.listMeals() : [];
      if (q) { list = rank(list, q, 60); meals = rank(meals, q, 60); }
      const empty = { recent: 'Foods you log show up here.', frequent: 'Your most-used foods show up here.', favorites: 'Tap the star on a food to keep it here.', foods: 'Foods you create show up here. Use Create food below.', recipes: 'Recipes you create in Foods show up here.', meals: 'Save a meal from the Diary menu (⋯ on a meal) to reuse it here.' }[tab];
      const nodes = [...list.map((r) => foodRow(r.food, r.meta)), ...meals.map(mealRow)];
      return paint(nodes.length ? section(null, nodes) : section(null, hint(q ? `Nothing in this list matches "${q}".` : empty)));
    }
    if (!q) {
      const recents = await foodsFromMetas(await store.recentFoods(10));
      return paint(recents.length ? section('Recent', recents.map((r) => foodRow(r.food, r.meta))) : null, section(null, hint('Search more than 7,000 foods, scan a barcode, or use Quick add for a number you already know.'), 'intro'));
    }
    const mine = await yourFoods(q);
    const mineSec = mine.length ? section('Your foods', mine.map((r) => (r.kind === 'meal' ? mealRow(r.meal) : foodRow(r.food, r.meta)))) : null;
    const usdaHost = section('USDA', [h('p', { class: 'muted res-hint' }, spinner('Searching'), ' Searching…')], 'usda');
    const onlineHost = section('Online (branded)', null, 'online');
    paint(mineSec, usdaHost, onlineHost);
    let localCount = mine.length;
    try {
      await loadFoods();
      const local = await searchLocal(q, 25);
      if (my !== seq) return;
      localCount += local.length;
      usdaHost.replaceChildren(h('h3', null, 'USDA'), ...(local.length ? local.map((f) => foodRow(f, null)) : [hint(`No USDA match for "${q}".`)]));
    } catch {
      if (my !== seq) return;
      usdaHost.replaceChildren(h('h3', null, 'USDA'), notice("Couldn't load the USDA food list. Connect once to download it; after that it works offline.", 'warn', button('Retry', () => run(), { variant: 'ghost' })));
      localCount = -1; // the list is missing, not empty: no automatic online search
    }
    showOnline(my, q, onlineHost, localCount === 0, wantOnline);
  }

  /**
   * The online (branded) section. Online sources limit requests, so nothing is fetched while typing: the search runs when the person
   * asks (tap the row, or Enter), or once automatically when nothing local matches and typing has paused for a second.
   */
  function showOnline(my, q, host, noLocal, asked) {
    const head = h('h3', null, 'Online (branded)');
    const nq = normQ(q);
    if (q.length < 3) { host.replaceChildren(head); if (asked || noLocal) host.append(hint('Type at least 3 letters to search branded foods online.')); return; }
    if (onlineCache.has(nq)) return renderOnline(my, q, host, onlineCache.get(nq), null);
    const go = () => searchOnline(my, q, host);
    host.replaceChildren(head, h('div', { class: 'res-row online-row' }, h('button', { type: 'button', class: 'res-main', onclick: go },
      h('span', { class: 'res-text' }, h('span', { class: 'res-name' }, 'Search branded foods online'), h('span', { class: 'res-sub' }, 'USDA branded foods · or press Enter')), icon('search', 18))));
    if (asked) go();
    else if (noLocal && !autoTried.has(nq)) {
      autoTimer = setTimeout(() => { if (my === seq) { autoTried.add(nq); go(); } }, 1000);
    }
  }

  /** USDA branded search: the default online source (fast and reliable with the person's own key). */
  async function searchOnline(my, q, host) {
    clearTimeout(autoTimer);
    if (onlineCtl) onlineCtl.abort();
    host.replaceChildren(h('h3', null, 'Online (branded)'), h('p', { class: 'muted res-hint load' }, spinner('Searching online'), ' Searching USDA…'));
    onlineCtl = new AbortController();
    let foods = null;
    let error = null;
    try {
      foods = await searchFDC(q, settings.fdcApiKey, { signal: onlineCtl.signal });
    } catch (e) {
      if (e.kind === 'aborted') return;
      error = e;
    }
    if (my !== seq) return;
    if (!error) {
      onlineCache.set(normQ(q), foods);
      if (onlineCache.size > 40) onlineCache.delete(onlineCache.keys().next().value);
    }
    renderOnline(my, q, host, foods, error);
  }

  function renderOnline(my, q, host, foods, error) {
    host.replaceChildren(h('h3', null, 'Online (branded)'));
    if (error) {
      const tip = settings.fdcApiKey ? '' : ' A free key from fdc.nal.usda.gov/api-key-signup removes the shared limit; add it in More.';
      host.append(notice(`${describeError(error, 'USDA')}${tip}`, 'warn', button('Retry', () => searchOnline(my, q, host), { variant: 'ghost' })));
    } else {
      host.append(...(foods.length ? foods.map((f) => foodRow(f, null)) : [hint(`No USDA branded results for "${q}".`)]), h('p', { class: 'credit' }, 'Data: USDA FoodData Central (public domain)'));
    }
    host.append(button('Search Open Food Facts too', (e) => searchOFFInto(my, q, e.currentTarget), { variant: 'secondary', cls: 'off-btn' }));
  }

  /** Open Food Facts, only on request: slower and often busy, so it gets one automatic retry before showing an error. */
  async function searchOFFInto(my, q, btn) {
    const box = h('div', { class: 'off-results' }, h('p', { class: 'muted res-hint load' }, spinner('Searching Open Food Facts'), ' Searching Open Food Facts…'));
    btn.replaceWith(box);
    try {
      const foods = await searchOFFWithRetry(q, { signal: onlineCtl ? onlineCtl.signal : undefined });
      if (my !== seq) return;
      box.replaceChildren(...(foods.length ? foods.map((f) => foodRow(f, null)) : [hint(`No Open Food Facts results for "${q}".`)]), h('p', { class: 'credit' }, 'Data: Open Food Facts (ODbL)'));
    } catch (e) {
      if (my !== seq || e.kind === 'aborted') return;
      box.replaceChildren(notice(describeError(e, 'Open Food Facts'), 'warn', button('Retry', (ev) => searchOFFInto(my, q, ev.currentTarget.closest('.off-results')), { variant: 'ghost' })));
    }
  }

  async function lookup(code) {
    results.replaceChildren(section(null, h('p', { class: 'muted res-hint' }, spinner('Looking up'), ` Looking up ${code}…`)));
    const mine = customForBarcode(await store.listCustomFoods(), code); // a copy the user corrected wins over the databases
    if (mine) { run(); return openDetail(customAsFood(mine)); }
    let found = null;
    let reason = 'not-found';
    let name = '';
    let failure = null;
    try {
      const r = await barcodeOFF(code);
      if (r.food) found = r.food; else { reason = r.reason; name = r.name || ''; }
    } catch (e) { failure = e; }
    if (!found) {
      try {
        const r = await barcodeFDC(code, settings.fdcApiKey);
        if (r.food) found = r.food;
      } catch (e) { failure = failure || e; }
    }
    if (found) { run(); return openDetail(found); }
    const msg = failure && !name ? `${describeError(failure, 'Barcode lookup')}` : reason === 'no-nutrition' ? `"${name || code}" is in the database but has no nutrition data. You can create it yourself.` : `No product found for ${code}. Try searching by name, or create the food yourself.`;
    results.replaceChildren(section(null, [notice(msg, 'warn'), h('div', { class: 'btn-row left' }, button('Create food', () => openFoodEditor({ prefill: { name }, onSaved: (rec) => openDetail(customAsFood(rec)) }), { variant: 'primary' }), button('Back to search', () => run(), { variant: 'ghost' }))]));
  }

  const debRun = debounce(run, 150);
  input.addEventListener('input', () => { debRun(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); debRun.cancel(); forceOnline = true; run(); } });
  const searchRow = h('div', { class: 'search-row' }, h('div', { class: 'search-box' }, icon('search', 18), input), iconButton('barcode', 'Scan a barcode', () => openBarcodeSheet({ onCode: lookup }), 'bordered'));
  const footer = h('div', { class: 'btn-row split' },
    mode === 'log' ? button('Quick add', () => openQuickAdd({ date, meal, onDone: afterAdd }), { variant: 'secondary', ic: 'bolt' }) : null,
    button('Create food', () => openFoodEditor({ prefill: { name: input.value.trim() }, onSaved: (rec) => { openDetail(customAsFood(rec)); } }), { variant: 'secondary', ic: 'plus' }));
  const s = sheet({
    title: mode === 'pick' ? 'Add ingredient' : 'Add food', size: 'lg', headerExtra: mealSel,
    content: [searchRow, tabRow, results], footer, onClose: () => { if (onlineCtl) onlineCtl.abort(); clearTimeout(autoTimer); debRun.cancel(); seq++; },
  });
  s.el.classList.add('add-food');
  drawTabs();
  run();
  return s;
}
