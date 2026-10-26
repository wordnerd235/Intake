// Two tabs, each with its own bus, joined only by a BroadcastChannel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBus } from '../../js/bus.js';
import { startTabSync } from '../../js/tabsync.js';

const tick = () => new Promise((r) => setTimeout(r, 40));

test('a local change in tab A reaches tab B as a "tab" event, and never loops back', async () => {
  const a = createBus();
  const b = createBus();
  const stopA = startTabSync(a, 'intake-test');
  const stopB = startTabSync(b, 'intake-test');
  const seenA = [];
  const seenB = [];
  a.on('change:*', (p) => seenA.push(p));
  b.on('change:*', (p) => seenB.push(p));
  a.emit('change:water', { collection: 'water', id: 'x', source: 'local' });
  await tick();
  assert.equal(seenA.length, 1, 'tab A only sees its own event');
  assert.deepEqual(seenB, [{ collection: 'water', id: null, source: 'tab' }]);
  b.emit('change:foodLogs', { collection: 'foodLogs', id: null, source: 'remote' });
  b.emit('change:settings', { collection: 'settings', id: null, source: 'local' });
  await tick();
  assert.deepEqual(seenA.slice(1), [{ collection: 'settings', id: null, source: 'tab' }], 'only local changes are announced');
  stopA();
  stopB();
});

test('startTabSync without BroadcastChannel is a no-op', () => {
  const saved = globalThis.BroadcastChannel;
  delete globalThis.BroadcastChannel;
  try {
    const stop = startTabSync(createBus());
    assert.equal(typeof stop, 'function');
    stop();
  } finally {
    globalThis.BroadcastChannel = saved;
  }
});
