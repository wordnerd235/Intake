import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../js/store.js';
import { createMemoryAdapter } from '../../js/db.js';
import { createBus } from '../../js/bus.js';
import { SyncEngine, MemoryCloud, MemoryBackend, AccountDecisionNeeded } from '../../js/sync.js';

let wall = 2_000_000; // one shared wall clock so "later" means later across devices
let ids = 0;

/** A simulated device: own store + bus + engine, all talking to the shared cloud. */
function device(cloud, uid = 'u1', extra = {}) {
  const bus = createBus();
  const store = createStore({ adapter: extra.adapter || createMemoryAdapter(), bus, clock: () => ++wall, uuid: () => `d${++ids}` });
  const backend = new MemoryBackend(cloud, uid);
  const state = { online: true };
  const engine = new SyncEngine({ store, backend, bus, debounceMs: 2, isOnline: () => state.online });
  return { store, bus, backend, engine, state, uid };
}
const entry = (over = {}) => ({ date: '2026-10-23', meal: 0, foodKey: 'usda:1', name: 'Banana', serving: { label: '1 medium', grams: 118 }, qty: 1, per: { kcal: 105 }, ...over });
const names = async (d, date = '2026-10-23') => (await d.store.logsForDate(date)).map((l) => l.name).sort();
const sync = async (...ds) => {
  for (let i = 0; i < 3; i++) for (const d of ds) { await d.engine.flush(); await d.engine.settle(); }
};

test('create on A appears on B; nothing echoes back as dirty', async () => {
  const cloud = new MemoryCloud();
  const A = device(cloud);
  const B = device(cloud);
  await A.engine.attach('u1');
  await B.engine.attach('u1');
  const e = await A.store.addLog(entry());
  await sync(A, B);
  assert.deepEqual(await names(B), ['Banana']);
  assert.equal((await B.store.logsForDate('2026-10-23'))[0].id, e.id);
  assert.equal((await A.store.dirtyRecords()).length, 0, 'A cleared dirty after push');
  assert.equal((await B.store.dirtyRecords()).length, 0, 'B applied remote without marking dirty');
  assert.equal(B.backend.pushes, 0, 'B never pushed anything');
});

test('records created while signed out upload on first sign-in', async () => {
  const cloud = new MemoryCloud();
  const A = device(cloud);
  await A.store.addLog(entry({ name: 'Offline lunch' }));
  await A.store.setWeight('2026-10-23', 80);
  assert.ok((await A.store.dirtyRecords()).length >= 2);
  await A.engine.attach('u1');
  await sync(A);
  assert.equal((await A.store.dirtyRecords()).length, 0);
  const B = device(cloud);
  await B.engine.attach('u1');
  await sync(B);
  assert.deepEqual(await names(B), ['Offline lunch']);
  assert.equal(await B.store.getWeight('2026-10-23'), 80);
});

test('concurrent edits resolve last-write-wins on both devices', async () => {
  const cloud = new MemoryCloud();
  const A = device(cloud);
  const B = device(cloud);
  await A.engine.attach('u1');
  await B.engine.attach('u1');
  const e = await A.store.addLog(entry());
  await sync(A, B);
  // both go offline, both edit; B edits LATER
  A.state.online = false;
  B.state.online = false;
  await A.store.updateLog(e.id, { qty: 2 });
  await B.store.updateLog(e.id, { qty: 3 });
  A.state.online = true;
  B.state.online = true;
  await sync(A, B);
  assert.equal((await A.store.logsForDate('2026-10-23'))[0].qty, 3);
  assert.equal((await B.store.logsForDate('2026-10-23'))[0].qty, 3);
  // the older edit pushed AFTER the newer one must not clobber it in the cloud
  const C = device(cloud);
  await C.engine.attach('u1');
  await sync(C);
  assert.equal((await C.store.logsForDate('2026-10-23'))[0].qty, 3);
});

test('older edit that reaches the cloud last does not win (pull before push)', async () => {
  const cloud = new MemoryCloud();
  const A = device(cloud);
  const B = device(cloud);
  await A.engine.attach('u1');
  await B.engine.attach('u1');
  const e = await A.store.addLog(entry());
  await sync(A, B);
  B.state.online = false;
  await B.store.updateLog(e.id, { qty: 5 }); // older
  await A.store.updateLog(e.id, { qty: 9 }); // newer
  await sync(A);
  B.state.online = true;
  await sync(B, A);
  for (const d of [A, B]) assert.equal((await d.store.logsForDate('2026-10-23'))[0].qty, 9);
});

test('stale offline edit pushed to the cloud last is skipped by the conditional write', async () => {
  const cloud = new MemoryCloud();
  const A = device(cloud);
  const B = device(cloud);
  await A.engine.attach('u1');
  await B.engine.attach('u1');
  const e = await A.store.addLog(entry());
  await sync(A, B);
  B.backend.unsubscribeAll(); // B's realtime link is dead (offline): it cannot learn about A's edit
  await B.store.updateLog(e.id, { qty: 5 }); // older
  await A.store.updateLog(e.id, { qty: 9 }); // newer
  await sync(A);
  await B.engine.flush(); // B reconnects and pushes first, before any catch-up
  const doc = cloud.docs('u1', 'foodLogs').get(e.id);
  assert.equal(doc.qty, 9, 'cloud keeps the newer copy');
  B.engine.detach();
  await B.engine.attach('u1'); // re-subscribe: catch-up delivers the newer doc
  await sync(B, A);
  for (const d of [A, B]) assert.equal((await d.store.logsForDate('2026-10-23'))[0].qty, 9);
});

test('delete propagates', async () => {
  const cloud = new MemoryCloud();
  const A = device(cloud);
  const B = device(cloud);
  await A.engine.attach('u1');
  await B.engine.attach('u1');
  const e = await A.store.addLog(entry());
  await sync(A, B);
  assert.equal((await names(B)).length, 1);
  await B.store.deleteLog(e.id);
  await sync(B, A);
  assert.equal((await names(A)).length, 0);
  assert.equal((await names(B)).length, 0);
});

test('offline queue flushes when the network returns; retries with backoff state', async () => {
  const cloud = new MemoryCloud();
  const A = device(cloud);
  const B = device(cloud);
  await A.engine.attach('u1');
  await B.engine.attach('u1');
  A.backend.online = false; // the SDK is "connected" but pushes fail
  await A.store.addLog(entry({ name: 'Queued 1' }));
  await A.store.addLog(entry({ name: 'Queued 2' }));
  await A.engine.flush();
  assert.equal(A.engine.status().state, 'error');
  assert.equal(A.engine.pending, 2);
  assert.equal((await names(B)).length, 0);
  A.backend.online = true;
  A.engine.onlineChange(true);
  await sync(A, B);
  assert.equal(A.engine.status().state, 'idle');
  assert.equal(A.engine.pending, 0);
  assert.deepEqual(await names(B), ['Queued 1', 'Queued 2']);
  // browser reports offline: nothing is attempted, pending is reported
  A.state.online = false;
  await A.store.addLog(entry({ name: 'While offline' }));
  const before = A.backend.pushes;
  await A.engine.flush();
  assert.equal(A.backend.pushes, before);
  assert.equal(A.engine.status().pending, 1);
  assert.equal(A.engine.status().online, false);
  A.state.online = true;
  A.engine.onlineChange(true);
  await sync(A, B);
  assert.equal((await names(B)).length, 3);
});

test('debounced push fires by itself after local changes', async () => {
  const cloud = new MemoryCloud();
  const A = device(cloud);
  const B = device(cloud);
  await A.engine.attach('u1');
  await B.engine.attach('u1');
  await A.store.addLog(entry({ name: 'Auto' }));
  await A.store.addLog(entry({ name: 'Auto 2' }));
  await new Promise((r) => setTimeout(r, 40));
  await B.engine.settle();
  assert.deepEqual(await names(B), ['Auto', 'Auto 2']);
  assert.equal(A.backend.pushes > 0, true);
});

test('dirty flag survives an edit made while a push is in flight', async () => {
  const cloud = new MemoryCloud();
  const A = device(cloud);
  await A.engine.attach('u1');
  const e = await A.store.addLog(entry());
  const orig = A.backend.push.bind(A.backend);
  let edited = false;
  A.backend.push = async (c, recs) => {
    if (!edited && c === 'foodLogs') {
      edited = true;
      await A.store.updateLog(e.id, { qty: 7 }); // local edit lands mid-push
    }
    return orig(c, recs);
  };
  await A.engine.flush();
  await sync(A);
  const B = device(cloud);
  await B.engine.attach('u1');
  await sync(B);
  assert.equal((await B.store.logsForDate('2026-10-23'))[0].qty, 7, 'the newer edit was not marked clean and got pushed');
});

test('cursors persist and are used after a restart', async () => {
  const cloud = new MemoryCloud();
  const adapter = createMemoryAdapter();
  const A = device(cloud);
  const B = device(cloud, 'u1', { adapter });
  await A.engine.attach('u1');
  await B.engine.attach('u1');
  await A.store.addLog(entry({ name: 'One' }));
  await sync(A, B);
  const cur = await B.store.getMeta('cursor:u1:foodLogs');
  assert.ok(cur > 0);
  B.engine.detach();
  await A.store.addLog(entry({ name: 'Two' }));
  await sync(A);
  // "restart": new store+engine over the same adapter
  const B2 = device(cloud, 'u1', { adapter });
  let subscribedSince = null;
  const orig = B2.backend.subscribe.bind(B2.backend);
  B2.backend.subscribe = (c, since, ...rest) => {
    if (c === 'foodLogs') subscribedSince = since;
    return orig(c, since, ...rest);
  };
  await B2.engine.attach('u1');
  await sync(B2);
  assert.equal(subscribedSince, cur);
  assert.deepEqual(await names(B2), ['One', 'Two']);
});

test('a different account over local data asks: merge uploads everything, erase wipes first', async () => {
  const cloud = new MemoryCloud();
  const A = device(cloud);
  await A.store.addLog(entry({ name: 'Mine' }));
  await A.engine.attach('u1');
  await sync(A);
  A.engine.detach();

  const other = device(cloud, 'u2');
  const store = A.store; // same device, new account
  const eng = new SyncEngine({ store, backend: other.backend, bus: A.bus, debounceMs: 2 });
  await assert.rejects(() => eng.attach('u2'), AccountDecisionNeeded);

  await eng.attach('u2', { strategy: 'merge' });
  await eng.flush();
  await eng.settle();
  const C = device(cloud, 'u2');
  await C.engine.attach('u2');
  await sync(C);
  assert.deepEqual(await names(C), ['Mine'], 'merge uploaded clean local records to the new account');
  eng.detach();

  const D = device(cloud, 'u3');
  const eng3 = new SyncEngine({ store, backend: D.backend, bus: A.bus, debounceMs: 2 });
  await assert.rejects(() => eng3.attach('u3'), AccountDecisionNeeded);
  await eng3.attach('u3', { strategy: 'erase' });
  await eng3.settle();
  assert.deepEqual(await names(A), [], 'erase removed this device data; u3 has none');
  eng3.detach();
});

test('same account signing back in needs no decision; status text fields are sane', async () => {
  const cloud = new MemoryCloud();
  const A = device(cloud);
  await A.store.addLog(entry());
  await A.engine.attach('u1');
  A.engine.detach();
  await A.engine.attach('u1');
  const st = A.engine.status();
  assert.equal(st.signedIn, true);
  assert.equal(st.configured, true);
  A.engine.detach();
  assert.equal(A.engine.status().signedIn, false);
});

test('erasing local data while signed in re-pulls from the cloud', async () => {
  const cloud = new MemoryCloud();
  const A = device(cloud);
  await A.engine.attach('u1');
  await A.store.addLog(entry({ name: 'Cloud copy' }));
  await sync(A);
  await A.store.eraseAll();
  await A.engine.settle();
  await sync(A);
  assert.deepEqual(await names(A), ['Cloud copy']);
});

test('large backlog is pushed in batches of at most 400', async () => {
  const cloud = new MemoryCloud();
  const A = device(cloud);
  for (let i = 0; i < 905; i++) await A.store.setWater(`2020-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}x${i}`, i);
  await A.engine.attach('u1');
  await sync(A);
  assert.equal((await A.store.dirtyRecords()).length, 0);
  assert.equal(A.backend.pushes, 3);
});
