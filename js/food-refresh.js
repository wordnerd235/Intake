// food-refresh.js - bring saved copies of commercial products up to date with added sugars, without rescanning.
// Saved copies: Recents/Favorites (foodMeta.food) and recipe ingredients, for Open Food Facts (off:) and USDA branded
// (fdc:) foods saved before the app read added sugars. Diary entries are never changed. No DOM and no network of its
// own: main.js passes the store and a fetchFood(key) that looks a product up again, so Node can test it.
import { impossibleAddedSugar } from './nutrition.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const COMMERCIAL = /^(off|fdc):/;
const r3 = (n) => Math.round(n * 1000) / 1000;

/** Local meta record (per device, not synced): the product keys already looked up again. */
export const REFRESH_META_KEY = 'refresh:addedSugar:v1';

/** @returns {boolean} the food (a fresh lookup) lists added sugars per 100 g */
export const listsAddedSugar = (food) => !!(food && food.per100g && isNum(food.per100g.addedSugar));

/**
 * Same product? Total sugars per 100 g agree within 0.5 g or 5%, so a product whose recipe changed since it was saved
 * doesn't get an added-sugar number that belongs to the new recipe.
 * @param {number} a
 * @param {number} b
 */
export function sugarMatches(a, b) {
  if (!isNum(a) || !isNum(b)) return false;
  return Math.abs(a - b) <= Math.max(0.5, 0.05 * Math.max(a, b));
}

/** @returns {boolean} a Recents/Favorites entry for a commercial product saved without added sugars */
export function metaNeedsRefresh(m) {
  return !!(m && !m.deleted && COMMERCIAL.test(m.id || '') && m.food && m.food.per100g && !isNum(m.food.per100g.addedSugar));
}

/**
 * A saved copy holding more added sugars than total sugars (stored before the readers refused that): looked up once
 * more and replaced, so it reads "not listed" instead of a wrong number.
 * @returns {boolean}
 */
export function metaHasImpossible(m) {
  return !!(m && !m.deleted && COMMERCIAL.test(m.id || '') && m.food && impossibleAddedSugar(m.food.per100g));
}

/** @returns {boolean} a recipe ingredient from a commercial product, measured by weight, without added sugars */
export function ingredientNeedsRefresh(i) {
  return !!(i && COMMERCIAL.test(i.foodKey || '') && i.per && !isNum(i.per.addedSugar) && i.serving && i.serving.grams > 0);
}

/**
 * Product keys to look up again: Recents/Favorites from the most recently used (what you log most is done within
 * seconds), then recipe ingredients; each once, skipping ones already looked up. A copy with an impossible added-sugar
 * number is looked up once more even if its product was checked before (marked "fix:<key>" when done).
 * @param {Object[]} metas live foodMeta records
 * @param {Object[]} recipes live recipes
 * @param {Set<string>} [checked]
 * @returns {string[]}
 */
export function pendingKeys(metas, recipes, checked = new Set()) {
  const out = new Set();
  const byRecent = (metas || []).slice().sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
  for (const m of byRecent) {
    if (metaHasImpossible(m) ? !checked.has(`fix:${m.id}`) : metaNeedsRefresh(m) && !checked.has(m.id)) out.add(m.id);
  }
  for (const r of recipes || []) for (const i of r.ingredients || []) if (ingredientNeedsRefresh(i) && !checked.has(i.foodKey)) out.add(i.foodKey);
  return [...out];
}

/**
 * A recipe ingredient with added sugars filled in from a fresh lookup of its product, scaled to the ingredient's weight;
 * null when it can't be filled safely: added sugars already known, no weight, the product doesn't list them (or lists
 * more added than total), or total sugars no longer match what was saved. Only added sugars change.
 * @param {{serving:{grams:number|null}, per:Object}} ing
 * @param {Object} fresh Food from a fresh lookup
 * @returns {Object|null}
 */
export function fillIngredientAddedSugar(ing, fresh) {
  if (!ingredientNeedsRefresh(ing) || !listsAddedSugar(fresh)) return null;
  const g = ing.serving.grams;
  const { sugar, addedSugar } = fresh.per100g;
  if (!isNum(sugar) || addedSugar > sugar) return null;
  if (!isNum(ing.per.sugar) || !sugarMatches((ing.per.sugar * 100) / g, sugar)) return null;
  return { ...ing, per: { ...ing.per, addedSugar: r3((addedSugar * g) / 100) } };
}

/**
 * Look saved commercial products up again (one at a time, `gapMs` apart: Open Food Facts allows about 100 product
 * lookups a minute, the shared USDA key far fewer) and fill in added sugars. A Recents/Favorites copy is replaced by
 * the fresh product, as a rescan would; a recipe only gains added sugars on matching ingredients. A product that is
 * gone or still lists no added sugars is not asked about again. When a service is busy it is skipped for this run;
 * when the connection fails the run stops. Either way the rest waits for the next start.
 * @param {{store:Object, fetchFood:(key:string)=>Promise<Object|null>, wait?:(ms:number)=>Promise<void>, gapMs?:number}} o
 * @returns {Promise<{foods:number, recipes:number, pending:number}>} saved foods and recipes updated; keys left
 */
export async function refreshSavedFoods({ store, fetchFood, wait = (ms) => new Promise((r) => setTimeout(r, ms)), gapMs = 1100 }) {
  const state = (await store.getMeta(REFRESH_META_KEY)) || {};
  const checked = new Set(Array.isArray(state.checked) ? state.checked : []);
  const [metas, recipes] = await Promise.all([store.listFoodMeta(), store.listRecipes()]);
  const keys = pendingKeys(metas, recipes, checked);
  const busy = new Set();
  const recipeIds = new Set();
  let foods = 0;
  let done = 0;
  let first = true;
  for (const key of keys) {
    const source = key.split(':')[0];
    if (busy.has(source)) continue;
    if (!first) await wait(gapMs);
    first = false;
    let fresh;
    try {
      fresh = await fetchFood(key);
    } catch (e) {
      if (e && e.kind === 'rate') { busy.add(source); continue; }
      break; // offline, timed out or broken: try the rest next time
    }
    const wrong = metas.some((m) => m.id === key && metaHasImpossible(m));
    if (wrong && fresh && fresh.key === key) await store.refreshSnapshots([fresh]); // today's reader leaves the bad number out
    if (listsAddedSugar(fresh) && fresh.key === key) {
      if (metas.some((m) => m.id === key && metaNeedsRefresh(m))) foods += await store.refreshSnapshots([fresh]);
      for (const r of recipes) {
        if ((r.ingredients || []).some((i) => i.foodKey === key) && (await store.fillRecipeAddedSugar(r.id, key, fresh))) recipeIds.add(r.id);
      }
    }
    checked.add(key);
    if (wrong) checked.add(`fix:${key}`);
    await store.setMeta(REFRESH_META_KEY, { checked: [...checked] });
    done++;
  }
  return { foods, recipes: recipeIds.size, pending: keys.length - done };
}

/**
 * What to tell the person after a run, or '' when nothing changed.
 * @param {{foods:number, recipes:number}} r
 */
export function refreshMessage(r) {
  const parts = [];
  if (r.foods) parts.push(`${r.foods} saved ${r.foods === 1 ? 'food' : 'foods'}`);
  if (r.recipes) parts.push(`${r.recipes} ${r.recipes === 1 ? 'recipe' : 'recipes'}`);
  return parts.length ? `Added sugars filled in for ${parts.join(' and ')}.` : '';
}
