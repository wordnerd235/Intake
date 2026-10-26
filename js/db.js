// db.js - storage adapters. The browser uses IndexedDB (schema v1); Node tests use the in-memory adapter.
// Every store has keyPath "id". `meta` holds {id, value} pairs (sync cursors, last uid).
import { COLLECTIONS } from './sync-core.js';

export const DB_NAME = 'intake';
export const DB_VERSION = 1;
export const STORES = [...COLLECTIONS, 'meta'];
/** Secondary indexes. `_dirty` exists on every synced collection. */
export const INDEXES = { foodLogs: ['date'], exerciseLogs: ['date'] };

const clone = (v) => (v === undefined ? v : structuredClone(v));

/**
 * In-memory adapter with the same contract as the IndexedDB one.
 * @returns {Object} adapter
 */
export function createMemoryAdapter() {
  const data = new Map(STORES.map((s) => [s, new Map()]));
  const st = (s) => {
    if (!data.has(s)) throw new Error(`Unknown store ${s}`);
    return data.get(s);
  };
  return {
    kind: 'memory',
    async open() {},
    async get(store, id) {
      return clone(st(store).get(id));
    },
    async put(store, rec) {
      st(store).set(rec.id, clone(rec));
    },
    async putMany(store, recs) {
      for (const r of recs) st(store).set(r.id, clone(r));
    },
    async delete(store, id) {
      st(store).delete(id);
    },
    async all(store) {
      return [...st(store).values()].map(clone);
    },
    async byIndex(store, index, value) {
      return [...st(store).values()].filter((r) => r[index] === value).map(clone);
    },
    /** Records whose `index` field (or id when index is null) lies in [lo, hi]. */
    async range(store, index, lo, hi) {
      const key = index || 'id';
      return [...st(store).values()].filter((r) => r[key] >= lo && r[key] <= hi).map(clone);
    },
    async clear(store) {
      st(store).clear();
    },
    async count(store) {
      return st(store).size;
    },
  };
}

/**
 * IndexedDB adapter.
 * @param {IDBFactory} [idb]
 * @param {string} [name]
 * @returns {Object} adapter
 */
export function createIdbAdapter(idb = globalThis.indexedDB, name = DB_NAME) {
  /** @type {IDBDatabase|null} */
  let db = null;
  const req = (r) =>
    new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  const run = async (store, mode, fn) => {
    const tx = db.transaction(store, mode);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
    const out = await fn(tx.objectStore(store));
    await done;
    return out;
  };
  return {
    kind: 'indexeddb',
    open() {
      return new Promise((resolve, reject) => {
        if (!idb) return reject(new Error('IndexedDB is not available'));
        const r = idb.open(name, DB_VERSION);
        r.onupgradeneeded = () => {
          const d = r.result;
          for (const s of STORES) {
            if (d.objectStoreNames.contains(s)) continue;
            const os = d.createObjectStore(s, { keyPath: 'id' });
            if (s !== 'meta') os.createIndex('_dirty', '_dirty');
            for (const ix of INDEXES[s] || []) os.createIndex(ix, ix);
          }
        };
        r.onsuccess = () => {
          db = r.result;
          db.onversionchange = () => db.close();
          resolve();
        };
        r.onerror = () => reject(r.error);
        r.onblocked = () => reject(new Error('Database upgrade blocked by another tab'));
      });
    },
    get: (store, id) => run(store, 'readonly', (os) => req(os.get(id))),
    put: (store, rec) => run(store, 'readwrite', (os) => req(os.put(rec))).then(() => undefined),
    putMany: (store, recs) =>
      run(store, 'readwrite', async (os) => {
        for (const r of recs) os.put(r);
      }),
    delete: (store, id) => run(store, 'readwrite', (os) => req(os.delete(id))).then(() => undefined),
    all: (store) => run(store, 'readonly', (os) => req(os.getAll())),
    byIndex: (store, index, value) => run(store, 'readonly', (os) => req(os.index(index).getAll(IDBKeyRange.only(value)))),
    range: (store, index, lo, hi) =>
      run(store, 'readonly', (os) => req((index ? os.index(index) : os).getAll(IDBKeyRange.bound(lo, hi)))),
    clear: (store) => run(store, 'readwrite', (os) => req(os.clear())).then(() => undefined),
    count: (store) => run(store, 'readonly', (os) => req(os.count())),
  };
}
