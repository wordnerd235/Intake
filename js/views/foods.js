// views/foods.js - My foods · Recipes · Meals · Favorites.
import { h, icon, button, sheet, field, toast, confirm, emptyState, rafOnce, mount as mountEl } from '../ui.js';
import { bus } from '../bus.js';
import { store } from '../store.js';
import { resolveFood } from '../foods-db.js';
import { customAsFood, recipeAsFood, recipeNutrition, mealTotals, servingOptions, perForServing } from '../nutrition.js';
import { notice, mealLabel } from '../components.js';
import { starIcon } from '../facts.js';
import { openFoodEditor } from './food-editor.js';
import { openRecipeEditor } from './recipe-editor.js';
import { openFoodDetail } from './food-detail.js';
import { fmtInt, shortLabel } from '../units.js';
import { getDate } from '../state.js';
import { mealForClock } from '../dates.js';

const TABS = [['foods', 'My foods'], ['recipes', 'Recipes'], ['meals', 'Meals'], ['favorites', 'Favorites']];

function openMealEditor(m) {
  let items = m.items.map((i) => ({ ...i }));
  const name = h('input', { class: 'input', id: 'me-name', maxlength: 80, value: m.name, autocomplete: 'off' });
  const list = h('div', { class: 'ing-list' });
  const draw = () => mountEl(list, items.length ? items.map((it, i) => h('div', { class: 'ing' },
    h('div', { class: 'ing-main' }, h('div', { class: 'ing-name' }, it.name), h('div', { class: 'muted small' }, `${it.qty} × ${shortLabel(it.serving.label, 36)}`)),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove ${it.name}`, onclick: () => { items.splice(i, 1); draw(); } }, icon('x', 18)))) : h('p', { class: 'muted res-hint' }, 'This meal has no items. Save it empty or delete it.'));
  draw();
  const s = sheet({
    title: 'Edit meal', size: 'md', content: [field('Name', name), h('h3', { class: 'sub-head' }, 'Items'), list],
    footer: h('div', { class: 'btn-row' },
      button('Delete', async () => { const prev = await store.deleteMeal(m.id); s.close(); toast('Meal deleted', { action: 'Undo', onAction: () => store.restoreMeal(prev) }); }, { variant: 'ghost', cls: 'danger-text', ic: 'trash' }),
      button('Save', async () => { if (!name.value.trim()) { name.focus(); return; } await store.saveMeal({ id: m.id, name: name.value, items }); s.close(); toast('Meal saved'); }, { variant: 'primary', cls: 'grow' })),
  });
}

async function logFood(food) {
  await openFoodDetail({ food, mode: 'add', date: getDate(), meal: mealForClock() });
}

const row = ({ name, sub, kcal, onOpen, action }) => h('div', { class: 'res-row' },
  h('button', { type: 'button', class: 'res-main', onclick: onOpen, title: name }, h('span', { class: 'res-text' }, h('span', { class: 'res-name' }, name), h('span', { class: 'res-sub' }, sub)), kcal != null ? h('span', { class: 'res-kcal num' }, fmtInt(kcal), h('small', null, ' kcal')) : null),
  action || null);

/** @param {HTMLElement} root @param {{params:string[]}} route */
export async function mount(root, route) {
  let alive = true;
  const tab = TABS.some(([k]) => k === route.params[0]) ? route.params[0] : 'foods';
  const body = h('div', { class: 'card list-card' });
  const tabsEl = h('div', { class: 'tabs-row', role: 'tablist', 'aria-label': 'Food lists' }, TABS.map(([k, label]) => h('a', { role: 'tab', href: `#/foods/${k}`, class: `chip${k === tab ? ' on' : ''}`, 'aria-selected': String(k === tab) }, label)));
  const actions = h('div', { class: 'btn-row left' },
    tab === 'recipes' ? button('New recipe', () => openRecipeEditor({}), { variant: 'primary', ic: 'plus' }) : null,
    tab === 'foods' ? button('New food', () => openFoodEditor({}), { variant: 'primary', ic: 'plus' }) : null,
    tab === 'meals' ? notice('Save a meal from the Diary: open the ⋯ menu on a meal and choose Save as meal.', 'info') : null);
  root.append(h('div', { class: 'page' }, h('header', { class: 'page-head' }, h('h1', null, 'Foods')), tabsEl, actions, body));

  const draw = async () => {
    let nodes = [];
    let empty = '';
    if (tab === 'foods') {
      const list = await store.listCustomFoods();
      nodes = list.map((c) => { const f = customAsFood(c); const sv = servingOptions(f)[0]; return row({ name: c.name, sub: [c.brand, sv && shortLabel(sv.label, 36)].filter(Boolean).join(' · ') || 'Custom food', kcal: sv ? perForServing(f, sv).kcal : null, onOpen: () => openFoodEditor({ food: c }), action: h('button', { type: 'button', class: 'icon-btn res-add', 'aria-label': `Log ${c.name}`, title: 'Log this food', onclick: () => logFood(f) }, icon('plus', 20)) }); });
      empty = ['No custom foods yet', 'Create foods that are not in the database: a family recipe snack, a protein bar, anything with a label.'];
    } else if (tab === 'recipes') {
      const list = await store.listRecipes();
      nodes = list.map((r) => row({ name: r.name, sub: `${r.servings} ${r.servings === 1 ? 'serving' : 'servings'} · ${r.ingredients.length} ingredients`, kcal: recipeNutrition(r).perServing.kcal, onOpen: () => openRecipeEditor({ recipe: r }), action: h('button', { type: 'button', class: 'icon-btn res-add', 'aria-label': `Log ${r.name}`, title: 'Log a serving', onclick: () => logFood(recipeAsFood(r)) }, icon('plus', 20)) }));
      empty = ['No recipes yet', 'Add ingredients once and get calories per serving every time you cook it.'];
    } else if (tab === 'meals') {
      const list = await store.listMeals();
      nodes = list.map((m) => row({ name: m.name, sub: `${m.items.length} ${m.items.length === 1 ? 'item' : 'items'}`, kcal: Math.round(mealTotals(m).total.kcal), onOpen: () => openMealEditor(m) }));
      empty = ['No saved meals yet', 'Save a usual breakfast or lunch from the Diary, then add it again with one tap.'];
    } else {
      const metas = await store.favorites();
      for (const m of metas) {
        const f = (await resolveFood(m.id, store)) || m.food;
        const sv = servingOptions(f)[0];
        nodes.push(row({ name: f.name, sub: [f.brand, sv && shortLabel(sv.label, 36)].filter(Boolean).join(' · '), kcal: sv ? perForServing(f, sv).kcal : null, onOpen: () => logFood(f), action: h('button', { type: 'button', class: 'icon-btn res-add on', 'aria-label': `Remove ${f.name} from favorites`, title: 'Remove from favorites', onclick: () => store.toggleFavorite(f) }, starIcon(true)) }));
      }
      empty = ['No favorites yet', 'Tap the star when you open a food and it will be kept here.'];
    }
    if (!alive) return;
    body.replaceChildren(nodes.length ? h('div', { class: 'res-sec' }, nodes) : emptyState(empty[0], empty[1]));
  };
  const redraw = rafOnce(draw);
  const off = bus.on('change:*', redraw);
  await draw();
  return () => { alive = false; off(); };
}
