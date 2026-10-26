// foods-db.js - lazy-loads data/foods.json + data/exercises.json and serves search / lookup.
// Pure conversions (parseFoodsDoc, rowToFood) are importable in Node; fetching only happens inside loaders.
import { buildIndex, searchIndex } from './foods-search.js';
import { NUTRIENTS, recipeAsFood, customAsFood } from './nutrition.js';
import { orderServings } from './default-serving.js';

/**
 * Convert one compact foods.json row into the internal Food shape. servings[0] is the default serving (see default-serving.js).
 * Row: [id, name, groupCode, common, [values per 100 g in doc.nutrients order], [[portionLabel, grams], ...]]
 * @param {Array} row
 * @param {string[]} order nutrient keys in the row's value order
 * @returns {Object} Food
 */
export function rowToFood(row, order) {
  const per100g = {};
  for (const k of NUTRIENTS) per100g[k] = null;
  order.forEach((k, i) => {
    const v = row[4][i];
    if (k in per100g && typeof v === 'number' && Number.isFinite(v)) per100g[k] = v;
  });
  const servings = orderServings({
    name: row[1],
    group: row[2],
    kcal100: per100g.kcal,
    servings: (row[5] || []).filter((p) => Array.isArray(p) && p[0] && Number.isFinite(p[1]) && p[1] > 0).map((p) => ({ label: String(p[0]), grams: p[1] })),
  });
  return { key: `usda:${row[0]}`, name: row[1], source: 'usda', per100g, servings };
}

/**
 * Build the in-memory search structures from a parsed foods.json.
 * @param {{nutrients:string[], groups:Object, foods:Array[]}} doc
 */
export function parseFoodsDoc(doc) {
  const order = doc.nutrients || NUTRIENTS;
  const items = doc.foods.map((row) => ({ name: row[1], group: row[2], common: row[3], slice: !!(row[5] && row[5][0] && /\bslice\b/i.test(row[5][0][0])), pkg: (row[5] || []).some((p) => /\bservings? per\b/i.test(p[0])), ref: row }));
  return { doc, order, index: buildIndex(items), byId: new Map(doc.foods.map((r) => [String(r[0]), r])), groups: doc.groups || {} };
}

let foodsPromise = null;
let foodsState = null;
let exPromise = null;
let exState = null;

/**
 * Load (once) and index data/foods.json.
 * @param {string} [url]
 * @param {typeof fetch} [fetchFn]
 */
export function loadFoods(url = './data/foods.json', fetchFn = globalThis.fetch) {
  if (!foodsPromise) {
    foodsPromise = fetchFn(url)
      .then((r) => {
        if (!r.ok) throw new Error(`foods.json ${r.status}`);
        return r.json();
      })
      .then((doc) => (foodsState = parseFoodsDoc(doc)))
      .catch((e) => {
        foodsPromise = null; // allow retry
        throw e;
      });
  }
  return foodsPromise;
}

/** Install a pre-parsed doc (tests). */
export function setFoodsDoc(doc) {
  foodsState = parseFoodsDoc(doc);
  foodsPromise = Promise.resolve(foodsState);
}

/** @returns {boolean} true once foods.json is loaded */
export const foodsReady = () => !!foodsState;

/**
 * Search the local USDA list.
 * @param {string} q
 * @param {number} [limit]
 * @returns {Promise<Object[]>} Foods, best first
 */
export async function searchLocal(q, limit = 40) {
  const st = await loadFoods();
  return searchIndex(st.index, q, { limit }).map((h) => rowToFood(h.ref, st.order));
}

/**
 * Look a USDA food up by key ("usda:173944").
 * @param {string} key
 * @returns {Promise<Object|null>}
 */
export async function getUsdaFood(key) {
  const st = await loadFoods();
  const row = st.byId.get(String(key).replace(/^usda:/, ''));
  return row ? rowToFood(row, st.order) : null;
}

/**
 * Load data/exercises.json.
 * @param {string} [url]
 */
export function loadExercises(url = './data/exercises.json', fetchFn = globalThis.fetch) {
  if (!exPromise) {
    exPromise = fetchFn(url)
      .then((r) => {
        if (!r.ok) throw new Error(`exercises.json ${r.status}`);
        return r.json();
      })
      .then((doc) => {
        const list = (doc.exercises || []).filter((x) => x && x.name && Number.isFinite(x.met));
        exState = { list, index: buildIndex(list.map((x) => ({ name: x.name, group: '', common: false, ref: x }))) };
        return exState;
      })
      .catch((e) => {
        exPromise = null;
        throw e;
      });
  }
  return exPromise;
}

/** Install exercises (tests). */
export function setExercisesDoc(doc) {
  const list = doc.exercises || [];
  exState = { list, index: buildIndex(list.map((x) => ({ name: x.name, group: '', common: false, ref: x }))) };
  exPromise = Promise.resolve(exState);
}

/**
 * Search exercises by name.
 * @param {string} q
 * @param {number} [limit]
 * @returns {Promise<Array<{id:*, name:string, met:number, cat:string}>>}
 */
export async function searchExercises(q, limit = 30) {
  const st = await loadExercises();
  if (!q.trim()) return st.list.slice(0, limit);
  return searchIndex(st.index, q, { limit }).map((h) => h.ref);
}

/**
 * Resolve a foodKey to a full Food using the freshest source available.
 * custom/recipe -> live records; others -> foodMeta snapshot, else the USDA list.
 * @param {string} key
 * @param {Object} store store API (getCustomFood, getRecipe, getFoodMeta)
 * @returns {Promise<Object|null>}
 */
export async function resolveFood(key, store) {
  if (!key || key === 'quick') return null;
  if (key.startsWith('custom:')) {
    const cf = await store.getCustomFood(key.slice(7));
    if (cf) return customAsFood(cf);
  }
  if (key.startsWith('recipe:')) {
    const r = await store.getRecipe(key.slice(7));
    if (r) return recipeAsFood(r);
  }
  const meta = await store.getFoodMeta(key);
  if (meta && meta.food) return meta.food;
  if (key.startsWith('usda:')) {
    try {
      return await getUsdaFood(key);
    } catch {
      return null;
    }
  }
  return null;
}

/** Name of a USDA food group code. */
export function groupName(code) {
  return (foodsState && foodsState.groups[code]) || '';
}
