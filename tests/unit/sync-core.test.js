import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../js/sync-core.js';

test('shouldApplyRemote is strict last-write-wins', () => {
  assert.equal(S.shouldApplyRemote(null, { updatedAt: 1 }), true);
  assert.equal(S.shouldApplyRemote({ updatedAt: 5 }, { updatedAt: 6 }), true);
  assert.equal(S.shouldApplyRemote({ updatedAt: 5 }, { updatedAt: 5 }), false);
  assert.equal(S.shouldApplyRemote({ updatedAt: 6 }, { updatedAt: 5 }), false);
  assert.equal(S.shouldApplyRemote({ updatedAt: 6 }, null), false);
  assert.equal(S.shouldApplyRemote({ updatedAt: 6 }, {}), false);
});

test('nextCursor takes the max and ignores junk', () => {
  assert.equal(S.nextCursor(0, []), 0);
  assert.equal(S.nextCursor(10, [{ serverUpdatedAt: 5 }, { serverUpdatedAt: 20 }, {}, null]), 20);
  assert.equal(S.nextCursor(30, [{ serverUpdatedAt: 20 }]), 30);
  assert.equal(S.nextCursor(NaN, [{ serverUpdatedAt: 2 }]), 2);
});

test('batch splits at 400', () => {
  const arr = Array.from({ length: 1000 }, (_, i) => i);
  const b = S.batch(arr);
  assert.deepEqual(b.map((x) => x.length), [400, 400, 200]);
  assert.deepEqual(S.batch([]), []);
  assert.deepEqual(S.batch([1, 2, 3], 2), [[1, 2], [3]]);
});

test('toRemote strips local fields; fromRemote restores clean local shape', () => {
  const r = S.toRemote({ id: 'a', updatedAt: 1, _dirty: 1, note: undefined, serverUpdatedAt: 9 });
  assert.deepEqual(r, { id: 'a', updatedAt: 1, note: null });
  const l = S.fromRemote({ id: 'a', updatedAt: 1, serverUpdatedAt: 9 });
  assert.deepEqual(l, { id: 'a', updatedAt: 1, deleted: false, _dirty: 0 });
});

test('backoff, cursor key, account decision, status text', () => {
  assert.deepEqual([0, 1, 2, 5, 10].map(S.backoffDelay), [1000, 2000, 4000, 32000, 60000]);
  assert.equal(S.cursorKey('u1', 'foodLogs'), 'cursor:u1:foodLogs');
  assert.equal(S.needsAccountDecision(null, 'u1', true), false);
  assert.equal(S.needsAccountDecision('u1', 'u1', true), false);
  assert.equal(S.needsAccountDecision('u1', 'u2', false), false);
  assert.equal(S.needsAccountDecision('u1', 'u2', true), true);
  const base = { configured: true, signedIn: true, state: 'idle', pending: 0, lastSynced: 0, online: true };
  assert.equal(S.statusText({ ...base, configured: false }), 'Off');
  assert.equal(S.statusText({ ...base, signedIn: false }), 'Signed out');
  assert.equal(S.statusText({ ...base, state: 'syncing' }), 'Syncing…');
  assert.equal(S.statusText({ ...base, online: false, pending: 3 }), 'Offline (3 pending)');
  assert.equal(S.statusText({ ...base, state: 'error', error: 'denied' }), 'Error: denied');
  assert.match(S.statusText({ ...base, lastSynced: 1000 }, () => '3:00 pm'), /Synced \(3:00 pm\)/);
});
