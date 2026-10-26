// sync.js - SyncEngine (backend-agnostic) + MemoryBackend (tests). FirebaseBackend lives in firebase-backend.js.
// Backend interface:
//   push(collection, records[])                      -> Promise<void>   (records already stripped of local fields)
//   subscribe(collection, sinceCursor, onDocs, onErr) -> unsubscribe fn  (docs carry serverUpdatedAt in ms; first call is the initial snapshot, possibly empty)
//   unsubscribeAll()
import { COLLECTIONS, MAX_BATCH, batch, toRemote, nextCursor, cursorKey, backoffDelay, needsAccountDecision } from './sync-core.js';

export { FirebaseBackend } from './firebase-backend.js';

/** Error thrown by attach() when a different account signs in and local data exists. */
export class AccountDecisionNeeded extends Error {
  constructor() {
    super('A different account was used on this device before.');
    this.code = 'needs-decision';
  }
}

/** Shared in-memory "cloud" for tests: users/{uid}/{collection}/{id} with a server clock. */
export class MemoryCloud {
  constructor() {
    this.users = new Map();
    this.tick = 1000;
    this.listeners = new Set();
  }
  docs(uid, collection) {
    if (!this.users.has(uid)) this.users.set(uid, new Map());
    const u = this.users.get(uid);
    if (!u.has(collection)) u.set(collection, new Map());
    return u.get(collection);
  }
  /** Conditional write mirroring FirebaseBackend: a copy that is already as new (or newer) is kept. */
  write(uid, collection, rec) {
    const cur = this.docs(uid, collection).get(rec.id);
    if (cur && typeof cur.updatedAt === 'number' && cur.updatedAt >= rec.updatedAt) return false;
    const doc = { ...structuredClone(rec), serverUpdatedAt: ++this.tick };
    this.docs(uid, collection).set(rec.id, doc);
    for (const l of [...this.listeners]) {
      if (l.uid === uid && l.collection === collection && l.active) queueMicrotask(() => l.active && l.cb([structuredClone(doc)]));
    }
    return true;
  }
}

/** Backend over a MemoryCloud. `online=false` makes push() reject like a dead network. */
export class MemoryBackend {
  constructor(cloud, uid) {
    this.cloud = cloud;
    this.uid = uid;
    this.online = true;
    this.pushes = 0;
    this.mine = new Set();
  }
  async push(collection, records) {
    if (!this.online) throw new Error('network offline');
    if (records.length > MAX_BATCH) throw new Error('batch too large');
    this.pushes++;
    for (const r of records) this.cloud.write(this.uid, collection, r);
  }
  subscribe(collection, since, onDocs) {
    const l = { uid: this.uid, collection, cb: onDocs, active: true };
    this.cloud.listeners.add(l);
    this.mine.add(l);
    const initial = [...this.cloud.docs(this.uid, collection).values()].filter((d) => d.serverUpdatedAt >= since).map((d) => structuredClone(d));
    queueMicrotask(() => l.active && onDocs(initial));
    return () => {
      l.active = false;
      this.cloud.listeners.delete(l);
    };
  }
  unsubscribeAll() {
    for (const l of this.mine) {
      l.active = false;
      this.cloud.listeners.delete(l);
    }
    this.mine.clear();
  }
}

const defer = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

/** Keeps a store and a backend in sync: debounced push of dirty records, realtime pull with LWW. */
export class SyncEngine {
  /**
   * @param {{store:Object, backend:Object, bus?:Object, isOnline?:()=>boolean, debounceMs?:number, now?:()=>number, setTimer?:Function, clearTimer?:Function}} o
   */
  constructor({ store, backend, bus, isOnline = () => globalThis.navigator?.onLine !== false, debounceMs = 1000, now = () => Date.now(), setTimer = (...a) => setTimeout(...a), clearTimer = (...a) => clearTimeout(...a) }) {
    // Arrow wrappers: browsers throw "Illegal invocation" when setTimeout is called with the engine as `this`.
    Object.assign(this, { store, backend, bus: bus || store.bus, isOnline, debounceMs, now, setTimer, clearTimer });
    this.uid = null;
    this.gen = 0;
    this.state = 'idle';
    this.error = null;
    this.pending = 0;
    this.lastSynced = null;
    this.attempt = 0;
    this.timer = null;
    this.retryTimer = null;
    this.pushing = null;
    this.again = false;
    this.cursors = {};
    this.chain = Promise.resolve();
    this.offs = [];
  }

  /** @returns {Object} status snapshot for the UI */
  status() {
    return { configured: true, signedIn: !!this.uid, state: this.state, pending: this.pending, lastSynced: this.lastSynced, error: this.error, online: this.isOnline() };
  }
  _emit() {
    this.bus.emit('sync:status', this.status());
  }
  async _refreshPending() {
    this.pending = (await this.store.dirtyRecords()).length;
  }

  /**
   * Start syncing for a signed-in user.
   * @param {string} uid
   * @param {{strategy?:'merge'|'erase'}} [opts] required when a different account signs in over local data
   */
  async attach(uid, { strategy } = {}) {
    if (this.uid === uid) return;
    this.detach();
    const lastUid = (await this.store.getMeta('lastUid')) || null;
    if (needsAccountDecision(lastUid, uid, await this.store.hasLocalData())) {
      if (!strategy) throw new AccountDecisionNeeded();
      if (strategy === 'erase') await this.store.eraseAll();
      else await this.store.markAllDirty();
    }
    await this.store.setMeta('lastUid', uid);
    this.uid = uid;
    const gen = ++this.gen;
    this.error = null;
    this.state = 'syncing';
    await this._refreshPending();
    this._emit();
    this.offs.push(
      this.bus.on('change:*', (p) => {
        if (p && p.source === 'local') this._schedule();
      }),
      this.bus.on('store:erased', () => this._resubscribe()),
    );
    await this._subscribeAll(gen);
    await this.flush();
  }

  /** Stop syncing (sign-out). Local data is untouched. */
  detach() {
    this.gen++;
    this.uid = null;
    for (const off of this.offs.splice(0)) off();
    this.backend.unsubscribeAll();
    if (this.timer) this.clearTimer(this.timer);
    if (this.retryTimer) this.clearTimer(this.retryTimer);
    this.timer = this.retryTimer = null;
    this.cursors = {};
    this.state = 'idle';
    this.error = null;
    this._emit();
  }

  async _subscribeAll(gen) {
    const initial = [];
    for (const c of COLLECTIONS) {
      const first = defer();
      initial.push(first.promise);
      const since = (await this.store.getMeta(cursorKey(this.uid, c))) || 0;
      this.cursors[c] = since;
      let seen = false;
      this.backend.subscribe(
        c,
        since,
        (docs) => {
          if (gen !== this.gen) return;
          this._onDocs(c, docs, gen, () => {
            if (!seen) {
              seen = true;
              first.resolve();
            }
          });
        },
        (err) => {
          if (gen !== this.gen) return;
          this._fail(err);
          first.resolve();
        },
      );
    }
    let t;
    await Promise.race([Promise.all(initial), new Promise((r) => (t = this.setTimer(r, 8000)))]);
    this.clearTimer(t);
  }

  async _resubscribe() {
    if (!this.uid) return;
    const uid = this.uid;
    this.backend.unsubscribeAll();
    const gen = ++this.gen;
    this.cursors = {};
    await this.store.setMeta('lastUid', uid);
    await this._subscribeAll(gen);
  }

  _onDocs(collection, docs, gen, done) {
    this.chain = this.chain
      .then(async () => {
        if (gen !== this.gen) return;
        for (const d of docs) await this.store.applyRemote(collection, d);
        const prev = this.cursors[collection] || 0;
        const next = nextCursor(prev, docs);
        if (next !== prev) {
          this.cursors[collection] = next;
          await this.store.setMeta(cursorKey(this.uid, collection), next);
        }
        this.lastSynced = this.now();
        await this._refreshPending();
        this._emit();
      })
      .catch((e) => this._fail(e))
      .then(done);
  }

  _fail(err) {
    this.state = 'error';
    this.error = (err && err.message) || String(err);
    this._emit();
  }

  _schedule() {
    this._refreshPending().then(() => this._emit());
    if (this.timer) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.flush();
    }, this.debounceMs);
  }

  /** Browser online/offline hook. */
  onlineChange(online) {
    this._emit();
    if (online && this.uid) {
      this.attempt = 0;
      this.flush();
    }
  }

  /** Push everything dirty now. Resolves when the queue is empty or a failure was scheduled for retry. */
  flush() {
    if (!this.uid) return Promise.resolve();
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (this.pushing) {
      this.again = true;
      return this.pushing;
    }
    this.pushing = this._pushLoop().finally(() => {
      this.pushing = null;
    });
    return this.pushing;
  }

  async _pushLoop() {
    const gen = this.gen;
    do {
      this.again = false;
      const dirty = await this.store.dirtyRecords();
      this.pending = dirty.length;
      if (!dirty.length) {
        this.state = 'idle';
        this.error = null;
        this._emit();
        return;
      }
      if (!this.isOnline()) {
        this.state = 'idle';
        this._emit();
        return;
      }
      this.state = 'syncing';
      this._emit();
      try {
        for (const c of COLLECTIONS) {
          const rows = dirty.filter((d) => d.collection === c).map((d) => d.rec);
          for (const part of batch(rows)) {
            await this.backend.push(c, part.map(toRemote));
            if (gen !== this.gen) return;
            for (const r of part) await this.store.clearDirty(c, r.id, r.updatedAt);
          }
        }
        this.attempt = 0;
        this.lastSynced = this.now();
        await this._refreshPending();
        this.state = this.pending ? 'syncing' : 'idle';
        this.error = null;
        this._emit();
      } catch (e) {
        await this._refreshPending();
        this._fail(e);
        const delay = backoffDelay(this.attempt++);
        if (this.retryTimer) this.clearTimer(this.retryTimer);
        this.retryTimer = this.setTimer(() => {
          this.retryTimer = null;
          this.flush();
        }, delay);
        return;
      }
    } while (this.again && gen === this.gen);
  }

  /** Wait until pulled docs have been applied and no push is running (tests). */
  async settle() {
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 0));
      await this.chain;
      if (this.pushing) await this.pushing;
    }
  }
}
