// Online lookups: failure mapping and the two-host Open Food Facts search, with a fake fetch (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { getJson, searchOFF, describeError, OnlineError } from '../../js/online-foods.js';

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const hit = (code, name) => ({ code, product_name: name, nutriments: { 'energy-kcal_100g': 120 } });
const script = (...steps) => {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    return step;
  };
  fn.calls = calls;
  return fn;
};

test('429 and 503 both read as "busy, try again in a minute"', async () => {
  for (const status of [429, 503]) {
    await assert.rejects(getJson('https://x.test/a', { fetchFn: script(reply(status, {})) }), (e) => {
      assert.equal(e.kind, 'rate');
      assert.equal(e.status, status);
      assert.match(describeError(e), /busy.*minute/i);
      return true;
    });
  }
  await assert.rejects(getJson('https://x.test/a', { fetchFn: script(reply(500, {})) }), (e) => e.kind === 'http');
});

test('searchOFF: an empty answer from the second host is "no results", not an error', async () => {
  const fetchFn = script(reply(502, {}), reply(200, { products: [] }));
  assert.deepEqual(await searchOFF('zzz empty one', { fetchFn }), []);
  assert.equal(fetchFn.calls.length, 2);
});

test('searchOFF: falls back to the second host and caches a good answer', async () => {
  const fetchFn = script(reply(500, {}), reply(200, { products: [hit('1', 'Oat bar')] }));
  const first = await searchOFF('oat bar fallback', { fetchFn });
  assert.equal(first[0].name, 'Oat bar');
  const again = await searchOFF('  Oat   BAR fallback ', { fetchFn });
  assert.equal(again[0].name, 'Oat bar');
  assert.equal(fetchFn.calls.length, 2, 'the repeat (different spacing and case) is served from the cache');
});

test('searchOFF: every host failing is an error; a rate limit stops after one request', async () => {
  await assert.rejects(searchOFF('all down query', { fetchFn: script(reply(500, {}), reply(500, {})) }), (e) => e instanceof OnlineError && e.kind === 'http');
  const busy = script(reply(503, {}), reply(200, { products: [hit('2', 'Never reached')] }));
  await assert.rejects(searchOFF('busy query here', { fetchFn: busy }), (e) => e.kind === 'rate');
  assert.equal(busy.calls.length, 1, 'both hosts share one limit, so the second is not tried');
});
