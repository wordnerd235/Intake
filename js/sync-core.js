// sync-core.js - PURE merge/cursor/batch logic shared by SyncEngine and its tests.

/** Every synced collection (also the IndexedDB object stores, besides `meta`). */
export const COLLECTIONS = ['settings', 'foodLogs', 'exerciseLogs', 'weights', 'water', 'notes', 'customFoods', 'recipes', 'meals', 'foodMeta'];

export const MAX_BATCH = 400;

/**
 * Last-write-wins on the client clock: remote wins only if strictly newer.
 * A local record that is newer (or equal) is kept; if it is dirty it will be pushed.
 * @param {{updatedAt:number}|null|undefined} local
 * @param {{updatedAt:number}} remote
 * @returns {boolean}
 */
export function shouldApplyRemote(local, remote) {
  if (!remote || typeof remote.updatedAt !== 'number') return false;
  if (!local) return true;
  return remote.updatedAt > (local.updatedAt || 0);
}

/**
 * Advance a pull cursor (ms, max serverUpdatedAt seen).
 * @param {number} cursor
 * @param {Array<{serverUpdatedAt?:number}>} docs
 * @returns {number}
 */
export function nextCursor(cursor, docs) {
  let c = Number.isFinite(cursor) ? cursor : 0;
  for (const d of docs) {
    if (d && Number.isFinite(d.serverUpdatedAt) && d.serverUpdatedAt > c) c = d.serverUpdatedAt;
  }
  return c;
}

/**
 * Split an array into chunks of at most `size`.
 * @template T
 * @param {T[]} arr
 * @param {number} [size]
 * @returns {T[][]}
 */
export function batch(arr, size = MAX_BATCH) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Copy of a record safe to send to the cloud: no local-only fields.
 * @param {Object} rec
 * @returns {Object}
 */
export function toRemote(rec) {
  const o = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k.startsWith('_') || k === 'serverUpdatedAt') continue;
    o[k] = v === undefined ? null : v;
  }
  return o;
}

/**
 * Local record from a remote doc: drops serverUpdatedAt and sets _dirty 0.
 * @param {Object} doc
 * @returns {Object}
 */
export function fromRemote(doc) {
  const o = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k === 'serverUpdatedAt' || k.startsWith('_')) continue;
    o[k] = v;
  }
  o.deleted = !!o.deleted;
  o._dirty = 0;
  return o;
}

/**
 * Exponential backoff delay in ms (1s, 2s, 4s ... capped at 60s).
 * @param {number} attempt 0-based
 * @returns {number}
 */
export function backoffDelay(attempt) {
  return Math.min(60000, 1000 * 2 ** Math.max(0, attempt));
}

/**
 * Meta-store key holding the pull cursor for one user + collection.
 * @param {string} uid
 * @param {string} collection
 * @returns {string}
 */
export function cursorKey(uid, collection) {
  return `cursor:${uid}:${collection}`;
}

/**
 * Does signing in as `uid` need a "merge or erase" decision?
 * True when a different account previously synced on this device and local data exists.
 * @param {string|null} lastUid
 * @param {string} uid
 * @param {boolean} hasLocalData
 * @returns {boolean}
 */
export function needsAccountDecision(lastUid, uid, hasLocalData) {
  return !!lastUid && lastUid !== uid && hasLocalData;
}

/**
 * Human status line for the UI.
 * @param {{configured:boolean, signedIn:boolean, state:string, pending:number, lastSynced:number|null, error?:string, online:boolean}} s
 * @param {(ms:number)=>string} [fmtTime]
 * @returns {string}
 */
export function statusText(s, fmtTime = (ms) => new Date(ms).toLocaleTimeString()) {
  if (!s.configured) return 'Off';
  if (!s.signedIn) return 'Signed out';
  if (s.state === 'error') return `Error${s.error ? `: ${s.error}` : ''}`;
  if (!s.online) return `Offline (${s.pending} pending)`;
  if (s.state === 'syncing') return 'Syncing…';
  if (s.pending > 0) return `Offline (${s.pending} pending)`;
  return s.lastSynced ? `Synced (${fmtTime(s.lastSynced)})` : 'Synced';
}
