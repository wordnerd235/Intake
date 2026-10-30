// store.js - domain API on top of a storage adapter. Stamps updatedAt, marks _dirty, emits bus events.
// createStore() builds an isolated instance (tests make one per "device"); `store` is the app singleton.
import { bus as defaultBus } from './bus.js';
import { COLLECTIONS, shouldApplyRemote, fromRemote } from './sync-core.js';
import { NUTRIENTS, DEFAULT_PROFILE } from './nutrition.js';
import { buildBackup, parseBackup } from './backup.js';
import { createFoodStore } from './store-foods.js';

/** @returns {string} RFC4122 v4 id (works on plain-http LAN origins too) */
export function uuid() {
  const c = globalThis.crypto;
  if (c && c.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && c.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Strip local-only fields before handing a record to the UI. */
export const clean = (r) => {
  if (!r) return r;
  const { _dirty, ...rest } = r;
  return rest;
};

/** Keep only the 16 known nutrient keys; anything non-finite becomes null. */
export function sanitizeNutrients(n) {
  const o = {};
  for (const k of NUTRIENTS) o[k] = n && typeof n[k] === 'number' && Number.isFinite(n[k]) ? n[k] : null;
  return o;
}

const str = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/** True when a settings record carries any personal profile data. */
const hasProfile = (s) => !!s && (s.birthYear != null || s.heightCm != null || s.goalWeightKg != null || s.startWeightKg != null);

/**
 * Build a store over `adapter`.
 * @param {{adapter:Object, bus?:Object, clock?:()=>number, uuid?:()=>string}} opts
 */
export function createStore({ adapter, bus = defaultBus, clock = Date.now, uuid: mkId = uuid }) {
  let chain = Promise.resolve();
  /** Serialise every read-modify-write so rapid taps cannot interleave. */
  const mutate = (fn) => {
    const p = chain.then(fn);
    chain = p.catch(() => {});
    return p;
  };
  const emit = (collection, id, source = 'local') => bus.emit(`change:${collection}`, { collection, id, source });

  /** Write a record: new updatedAt (strictly after any previous one), dirty. */
  async function write(collection, rec, prev, opts = {}) {
    const base = prev ? prev.updatedAt || 0 : 0;
    let t = clock();
    if (t <= base) t = base + 1;
    const out = { ...rec, updatedAt: t, deleted: !!rec.deleted, _dirty: 1 };
    await adapter.put(collection, out);
    if (!opts.silent) emit(collection, out.id);
    return clean(out);
  }
  const live = (list) => list.filter((r) => !r.deleted);
  const getLive = async (collection, id) => {
    const r = await adapter.get(collection, id);
    return r && !r.deleted ? clean(r) : null;
  };
  /** Tombstone a record; resolves to the previous live record (for Undo) or null. */
  const tombstone = (collection, id) =>
    mutate(async () => {
      const prev = await adapter.get(collection, id);
      if (!prev || prev.deleted) return null;
      await write(collection, { ...prev, deleted: true }, prev);
      return clean(prev);
    });

  const api = {
    adapter,
    bus,
    ready: () => adapter.open(),

    // ---- settings ----
    async getSettings() {
      const r = (await adapter.get('settings', 'profile')) || {};
      const { id, updatedAt, deleted, _dirty, ...rest } = r;
      return {
        ...DEFAULT_PROFILE,
        ...rest,
        units: { ...DEFAULT_PROFILE.units, ...(rest.units || {}) },
        macroPct: { ...DEFAULT_PROFILE.macroPct, ...(rest.macroPct || {}) },
        nutrientTargets: { ...(rest.nutrientTargets || {}) },
        mealNames: Array.isArray(rest.mealNames) && rest.mealNames.length === 4 ? rest.mealNames : DEFAULT_PROFILE.mealNames.slice(),
      };
    },
    saveSettings: (patch) =>
      mutate(async () => {
        const prev = await adapter.get('settings', 'profile');
        const cur = await api.getSettings();
        const next = { ...cur, ...patch };
        if (patch.units) next.units = { ...cur.units, ...patch.units };
        await write('settings', { ...next, id: 'profile' }, prev);
        return api.getSettings();
      }),

    // ---- food log ----
    async logsForDate(date) {
      const rows = live(await adapter.byIndex('foodLogs', 'date', date));
      return rows.sort((a, b) => a.createdAt - b.createdAt).map(clean);
    },
    async logsInRange(from, to) {
      return live(await adapter.range('foodLogs', 'date', from, to)).sort((a, b) => byDate(a, b) || a.createdAt - b.createdAt).map(clean);
    },
    addLog: (entry) =>
      mutate(async () => {
        const qty = Number(entry.qty);
        if (!(qty > 0) || !Number.isFinite(qty)) throw new Error('Amount must be greater than zero');
        if (!entry.date || !entry.name) throw new Error('Entry needs a date and a name');
        const rec = {
          id: entry.id || mkId(),
          date: entry.date,
          meal: Math.min(3, Math.max(0, entry.meal | 0)),
          foodKey: entry.foodKey || 'quick',
          name: str(entry.name),
          brand: str(entry.brand),
          serving: { label: str(entry.serving && entry.serving.label, 120) || 'serving', grams: entry.serving && Number.isFinite(entry.serving.grams) ? entry.serving.grams : null },
          qty,
          per: sanitizeNutrients(entry.per),
          createdAt: entry.createdAt || clock(),
        };
        return write('foodLogs', rec, await adapter.get('foodLogs', rec.id));
      }),
    updateLog: (id, patch) =>
      mutate(async () => {
        const prev = await adapter.get('foodLogs', id);
        if (!prev || prev.deleted) throw new Error('Entry not found');
        const next = { ...prev, ...patch, id };
        if (patch.per) next.per = sanitizeNutrients(patch.per);
        if (patch.meal != null) next.meal = Math.min(3, Math.max(0, patch.meal | 0));
        if ('qty' in patch && !(Number(patch.qty) > 0)) throw new Error('Amount must be greater than zero');
        return write('foodLogs', next, prev);
      }),
    deleteLog: (id) => tombstone('foodLogs', id),
    restoreLog: (rec) => mutate(async () => write('foodLogs', { ...rec, deleted: false }, await adapter.get('foodLogs', rec.id))),

    // ---- exercise ----
    async exerciseForDate(date) {
      return live(await adapter.byIndex('exerciseLogs', 'date', date)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).map(clean);
    },
    async exerciseInRange(from, to) {
      return live(await adapter.range('exerciseLogs', 'date', from, to)).sort(byDate).map(clean);
    },
    addExercise: (e) =>
      mutate(async () => {
        const rec = {
          id: e.id || mkId(),
          date: e.date,
          exerciseId: e.exerciseId == null ? null : e.exerciseId,
          name: str(e.name) || 'Exercise',
          minutes: Number.isFinite(e.minutes) ? e.minutes : null,
          kcal: Math.max(0, Math.round(Number(e.kcal) || 0)),
          met: Number.isFinite(e.met) ? e.met : null,
          createdAt: e.createdAt || clock(),
        };
        return write('exerciseLogs', rec, await adapter.get('exerciseLogs', rec.id));
      }),
    updateExercise: (id, patch) =>
      mutate(async () => {
        const prev = await adapter.get('exerciseLogs', id);
        if (!prev || prev.deleted) throw new Error('Exercise not found');
        const next = { ...prev, ...patch, id };
        if ('kcal' in patch) next.kcal = Math.max(0, Math.round(Number(patch.kcal) || 0));
        return write('exerciseLogs', next, prev);
      }),
    deleteExercise: (id) => tombstone('exerciseLogs', id),
    restoreExercise: (rec) => mutate(async () => write('exerciseLogs', { ...rec, deleted: false }, await adapter.get('exerciseLogs', rec.id))),

    // ---- weight / water / notes (id = date) ----
    async getWeight(date) {
      const r = await getLive('weights', date);
      return r ? r.kg : null;
    },
    setWeight: (date, kg) =>
      mutate(async () => {
        if (!(kg > 0) || !Number.isFinite(kg)) throw new Error('Weight must be a positive number');
        return write('weights', { id: date, date, kg }, await adapter.get('weights', date));
      }),
    async weightsInRange(from, to) {
      return live(await adapter.range('weights', null, from, to)).sort(byDate).map(clean);
    },
    async allWeights() {
      return live(await adapter.all('weights')).sort(byDate).map(clean);
    },
    deleteWeight: (date) => tombstone('weights', date),
    async getWater(date) {
      const r = await getLive('water', date);
      return r ? r.ml : 0;
    },
    setWater: (date, ml) =>
      mutate(async () => write('water', { id: date, date, ml: Math.max(0, Math.round(Number(ml) || 0)) }, await adapter.get('water', date))),
    addWater: (date, delta) =>
      mutate(async () => {
        const prev = await adapter.get('water', date);
        const cur = prev && !prev.deleted ? prev.ml : 0;
        return write('water', { id: date, date, ml: Math.max(0, Math.round(cur + delta)) }, prev);
      }),
    async waterInRange(from, to) {
      return live(await adapter.range('water', null, from, to)).sort(byDate).map(clean);
    },
    async getNote(date) {
      const r = await getLive('notes', date);
      return r ? r.text : '';
    },
    setNote: (date, text) =>
      mutate(async () => {
        const prev = await adapter.get('notes', date);
        const t = String(text || '').slice(0, 5000);
        if (!t.trim()) return prev && !prev.deleted ? write('notes', { ...prev, deleted: true }, prev) : null;
        return write('notes', { id: date, date, text: t }, prev);
      }),

    // ---- copy helpers ----
    /** Copy one diary entry to a date and meal as a new row. Returns the new entry. */
    copyLog: (id, toDate, toMeal) =>
      mutate(async () => {
        const src = await adapter.get('foodLogs', id);
        if (!src || src.deleted) throw new Error('Entry not found');
        const { createdAt, updatedAt, _dirty, ...rest } = src;
        return write('foodLogs', { ...rest, id: mkId(), date: toDate, meal: Math.min(3, Math.max(0, toMeal | 0)), createdAt: clock() }, null);
      }),
    copyMeal: (fromDate, meal, toDate, toMeal) =>
      mutate(async () => {
        const src = live(await adapter.byIndex('foodLogs', 'date', fromDate)).filter((r) => r.meal === meal).sort((a, b) => a.createdAt - b.createdAt);
        for (const r of src) {
          const { id, createdAt, updatedAt, _dirty, ...rest } = r;
          await write('foodLogs', { ...rest, id: mkId(), date: toDate, meal: toMeal, createdAt: clock() }, null, { silent: true });
        }
        if (src.length) emit('foodLogs', null);
        return src.length;
      }),
    /**
     * Copy every entry of one day into another. With `replace`, the entries already on the target day are deleted first
     * (the caller keeps them for Undo). Returns how many entries were copied.
     */
    copyDay: (fromDate, toDate, { replace = false } = {}) =>
      mutate(async () => {
        const src = live(await adapter.byIndex('foodLogs', 'date', fromDate)).sort((a, b) => a.meal - b.meal || a.createdAt - b.createdAt);
        if (replace && src.length && fromDate !== toDate) {
          for (const r of live(await adapter.byIndex('foodLogs', 'date', toDate))) await write('foodLogs', { ...r, deleted: true }, r, { silent: true });
        }
        for (const r of src) {
          const { id, createdAt, updatedAt, _dirty, ...rest } = r;
          await write('foodLogs', { ...rest, id: mkId(), date: toDate, createdAt: clock() }, null, { silent: true });
        }
        if (src.length) emit('foodLogs', null);
        return src.length;
      }),
    clearMeal: (date, meal) =>
      mutate(async () => {
        const rows = live(await adapter.byIndex('foodLogs', 'date', date)).filter((r) => r.meal === meal);
        for (const r of rows) await write('foodLogs', { ...r, deleted: true }, r, { silent: true });
        if (rows.length) emit('foodLogs', null);
        return rows.map(clean);
      }),
    /** Dates (YYYY-MM-DD) in [from,to] that have at least one food log. */
    async loggedDates(from, to) {
      return new Set((await api.logsInRange(from, to)).map((l) => l.date));
    },

    // ---- backup ----
    async exportAll() {
      const cols = {};
      for (const c of COLLECTIONS) cols[c] = await adapter.all(c);
      return buildBackup(cols, clock());
    },
    importAll: (json, { mode = 'merge' } = {}) =>
      mutate(async () => {
        const parsed = parseBackup(json);
        if (!parsed.ok) throw new Error(parsed.error);
        let imported = 0;
        let kept = 0;
        const incoming = new Set();
        for (const c of COLLECTIONS) for (const r of parsed.collections[c]) incoming.add(`${c}/${r.id}`);
        if (mode === 'replace') {
          for (const c of COLLECTIONS) {
            for (const r of live(await adapter.all(c))) {
              if (!incoming.has(`${c}/${r.id}`)) await write(c, { ...r, deleted: true }, r, { silent: true });
            }
          }
        }
        for (const c of COLLECTIONS) {
          for (const r of parsed.collections[c]) {
            const local = await adapter.get(c, r.id);
            // A profile left empty (Skip setup on a fresh install) must not shadow the profile in a backup.
            const fillsEmptyProfile = c === 'settings' && local && !hasProfile(local) && hasProfile(r);
            if (mode === 'merge' && local && local.updatedAt >= r.updatedAt && !fillsEmptyProfile) {
              kept++;
              continue;
            }
            if (mode === 'replace') await write(c, r, local, { silent: true });
            else await adapter.put(c, { ...r, updatedAt: fillsEmptyProfile ? Math.max(r.updatedAt, local.updatedAt + 1) : r.updatedAt, _dirty: 1 });
            imported++;
          }
        }
        for (const c of COLLECTIONS) emit(c, null);
        return { imported, kept, skipped: parsed.skipped };
      }),
    eraseAll: () =>
      mutate(async () => {
        for (const c of [...COLLECTIONS, 'meta']) await adapter.clear(c);
        bus.emit('store:erased', {});
        for (const c of COLLECTIONS) emit(c, null);
      }),

    // ---- sync support ----
    async dirtyRecords() {
      const out = [];
      for (const c of COLLECTIONS) for (const rec of await adapter.byIndex(c, '_dirty', 1)) out.push({ collection: c, rec });
      return out;
    },
    applyRemote: (collection, remote) =>
      mutate(async () => {
        const local = await adapter.get(collection, remote.id);
        if (!shouldApplyRemote(local, remote)) return false;
        await adapter.put(collection, fromRemote(remote));
        emit(collection, remote.id, 'remote');
        return true;
      }),
    clearDirty: (collection, id, updatedAt) =>
      mutate(async () => {
        const local = await adapter.get(collection, id);
        if (!local || local.updatedAt !== updatedAt || !local._dirty) return false;
        await adapter.put(collection, { ...local, _dirty: 0 });
        return true;
      }),
    markAllDirty: () =>
      mutate(async () => {
        for (const c of COLLECTIONS) {
          const rows = await adapter.all(c);
          await adapter.putMany(c, rows.map((r) => ({ ...r, _dirty: 1 })));
        }
      }),
    /** True when there is user data beyond settings (used before switching accounts). */
    async hasLocalData() {
      for (const c of COLLECTIONS) {
        if (c === 'settings' || c === 'foodMeta') continue;
        if (live(await adapter.all(c)).length) return true;
      }
      return false;
    },
    async getMeta(key) {
      const r = await adapter.get('meta', key);
      return r ? r.value : undefined;
    },
    setMeta: (key, value) => adapter.put('meta', { id: key, value }),
    deleteMeta: (key) => adapter.delete('meta', key),
  };

  Object.assign(api, createFoodStore({ adapter, mutate, write, tombstone, getLive, live, emit, clean, clock, mkId, sanitizeNutrients, str }));
  return api;
}

/** App singleton: main.js calls initStore() once the adapter is chosen. */
export const store = {};
/**
 * Fill the singleton with a real store.
 * @param {Object} adapter
 * @returns {Object} the store
 */
export function initStore(adapter) {
  return Object.assign(store, createStore({ adapter }));
}
