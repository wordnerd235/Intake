// store-foods.js - custom foods, recipes, saved meals and foodMeta (favorites/recents). Mixed into the store.

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/**
 * @param {Object} c helpers from createStore (adapter, mutate, write, tombstone, ...)
 * @returns {Object} methods to merge into the store API
 */
export function createFoodStore(c) {
  const { adapter, mutate, write, tombstone, getLive, live, clean, clock, mkId, sanitizeNutrients, str } = c;

  const cleanServing = (s) => ({
    label: str(s.label, 120) || 'serving',
    grams: Number.isFinite(s.grams) && s.grams > 0 ? s.grams : null,
    ...(s.per ? { per: sanitizeNutrients(s.per) } : {}),
  });
  const cleanItem = (i) => ({
    foodKey: i.foodKey || 'quick',
    name: str(i.name),
    brand: str(i.brand),
    serving: { label: str(i.serving && i.serving.label, 120) || 'serving', grams: i.serving && Number.isFinite(i.serving.grams) ? i.serving.grams : null },
    qty: Number(i.qty) > 0 ? Number(i.qty) : 1,
    per: sanitizeNutrients(i.per),
  });
  /** Minimal Food snapshot kept in foodMeta so recents/favorites work offline. */
  const snapshot = (food) => ({
    key: food.key,
    name: food.name,
    brand: food.brand || '',
    source: food.source,
    per100g: food.per100g ? sanitizeNutrients(food.per100g) : null,
    servings: (food.servings || []).slice(0, 8).map(cleanServing),
  });

  const api = {
    // ---- custom foods ----
    async listCustomFoods() {
      return live(await adapter.all('customFoods')).map(clean).sort(byName);
    },
    getCustomFood: (id) => getLive('customFoods', id),
    saveCustomFood: (food) =>
      mutate(async () => {
        const name = str(food.name);
        if (!name) throw new Error('Name is required');
        const servings = (food.servings || []).map(cleanServing);
        if (!servings.length && !food.per100g) throw new Error('Add at least one serving');
        const id = food.id || mkId();
        const rec = { id, name, brand: str(food.brand), per100g: food.per100g ? sanitizeNutrients(food.per100g) : null, servings };
        const out = await write('customFoods', rec, await adapter.get('customFoods', id));
        await refreshSnapshot(`custom:${id}`, { key: `custom:${id}`, name, brand: rec.brand, source: 'custom', per100g: rec.per100g, servings });
        return out;
      }),
    deleteCustomFood: (id) =>
      mutate(async () => {
        const prev = await adapter.get('customFoods', id);
        if (!prev || prev.deleted) return null;
        await write('customFoods', { ...prev, deleted: true }, prev);
        await dropMeta(`custom:${id}`);
        return clean(prev);
      }),
    restoreCustomFood: (rec) => mutate(async () => write('customFoods', { ...rec, deleted: false }, await adapter.get('customFoods', rec.id))),

    // ---- recipes ----
    async listRecipes() {
      return live(await adapter.all('recipes')).map(clean).sort(byName);
    },
    getRecipe: (id) => getLive('recipes', id),
    saveRecipe: (r) =>
      mutate(async () => {
        const name = str(r.name);
        if (!name) throw new Error('Name is required');
        const servings = Number(r.servings);
        if (!(servings > 0)) throw new Error('Servings must be greater than zero');
        const id = r.id || mkId();
        const rec = {
          id,
          name,
          servings,
          cookedGrams: Number(r.cookedGrams) > 0 ? Number(r.cookedGrams) : null,
          ingredients: (r.ingredients || []).map(cleanItem),
          note: str(r.note, 2000),
        };
        return write('recipes', rec, await adapter.get('recipes', id));
      }),
    deleteRecipe: (id) =>
      mutate(async () => {
        const prev = await adapter.get('recipes', id);
        if (!prev || prev.deleted) return null;
        await write('recipes', { ...prev, deleted: true }, prev);
        await dropMeta(`recipe:${id}`);
        return clean(prev);
      }),
    restoreRecipe: (rec) => mutate(async () => write('recipes', { ...rec, deleted: false }, await adapter.get('recipes', rec.id))),

    // ---- saved meals ----
    async listMeals() {
      return live(await adapter.all('meals')).map(clean).sort(byName);
    },
    getMeal: (id) => getLive('meals', id),
    saveMeal: (m) =>
      mutate(async () => {
        const name = str(m.name);
        if (!name) throw new Error('Name is required');
        const id = m.id || mkId();
        return write('meals', { id, name, items: (m.items || []).map(cleanItem) }, await adapter.get('meals', id));
      }),
    deleteMeal: (id) => tombstone('meals', id),
    restoreMeal: (rec) => mutate(async () => write('meals', { ...rec, deleted: false }, await adapter.get('meals', rec.id))),

    // ---- foodMeta: favorites / recents / frequent ----
    getFoodMeta: (key) => getLive('foodMeta', key),
    touchFoodMeta: (food, serving, qty) =>
      mutate(async () => {
        if (!food || !food.key || food.key === 'quick') return null;
        const prev = await adapter.get('foodMeta', food.key);
        const base = prev && !prev.deleted ? prev : { favorite: false, useCount: 0 };
        const rec = {
          id: food.key,
          favorite: !!base.favorite,
          useCount: (base.useCount || 0) + 1,
          lastUsed: clock(),
          lastServing: { serving: cleanServing(serving || {}), qty: Number(qty) > 0 ? Number(qty) : 1 },
          food: snapshot(food),
        };
        return write('foodMeta', rec, prev);
      }),
    async recentFoods(n = 30) {
      return live(await adapter.all('foodMeta')).filter((m) => m.lastUsed).sort((a, b) => b.lastUsed - a.lastUsed).slice(0, n).map(clean);
    },
    async frequentFoods(n = 30) {
      return live(await adapter.all('foodMeta')).filter((m) => m.useCount > 0).sort((a, b) => b.useCount - a.useCount || b.lastUsed - a.lastUsed).slice(0, n).map(clean);
    },
    async favorites() {
      return live(await adapter.all('foodMeta')).filter((m) => m.favorite && m.food).map(clean).sort((a, b) => byName(a.food, b.food));
    },
    toggleFavorite: (food) =>
      mutate(async () => {
        if (!food || !food.key || food.key === 'quick') return false;
        const prev = await adapter.get('foodMeta', food.key);
        const base = prev && !prev.deleted ? prev : { useCount: 0, lastUsed: 0, lastServing: null };
        const favorite = !(prev && !prev.deleted && prev.favorite);
        await write('foodMeta', { ...base, id: food.key, favorite, food: snapshot(food) }, prev);
        return favorite;
      }),
  };

  async function refreshSnapshot(key, food) {
    const prev = await adapter.get('foodMeta', key);
    if (prev && !prev.deleted) await write('foodMeta', { ...prev, food: snapshot(food) }, prev);
  }
  async function dropMeta(key) {
    const prev = await adapter.get('foodMeta', key);
    if (prev && !prev.deleted) await write('foodMeta', { ...prev, deleted: true }, prev);
  }
  return api;
}
