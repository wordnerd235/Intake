// Meal photo estimate: the Gemini request, reading its answer, USDA matching over the real food list, diary entries.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildRequest, parseEstimate, pickMatch, itemNutrients, itemEntry, explainError, MODELS, SCHEMA } from '../../js/meal-photo-core.js';
import { setFoodsDoc, searchLocal } from '../../js/foods-db.js';

setFoodsDoc(JSON.parse(fs.readFileSync(new URL('../../data/foods.json', import.meta.url), 'utf8')));

test('buildRequest: the prompt, the photo, JSON mode with the schema (or without it as a fallback)', () => {
  const r = buildRequest('QUJD', 'image/jpeg');
  assert.match(r.contents[0].parts[0].text, /grams/);
  assert.deepEqual(r.contents[0].parts[1], { inline_data: { mime_type: 'image/jpeg', data: 'QUJD' } });
  assert.equal(r.generationConfig.responseMimeType, 'application/json');
  assert.equal(r.generationConfig.responseSchema, SCHEMA);
  assert.equal(buildRequest('QUJD', 'image/jpeg', false).generationConfig.responseSchema, undefined);
  assert.deepEqual(r.generationConfig.thinkingConfig, { thinkingLevel: 'low' }, 'quick answers by default');
  assert.equal(buildRequest('QUJD', 'image/jpeg', true, false).generationConfig.thinkingConfig, undefined);
  assert.equal(MODELS[0], 'gemini-3.8-flash');
});

test('parseEstimate: a normal answer, fenced JSON, junk rows dropped, a blocked photo', () => {
  const answer = { items: [{ name: 'Grilled chicken thigh', search: 'chicken thigh roasted', grams: 140.4, kcal: 290, protein: 34, carbs: 0, fat: 16 }, { name: '', grams: 50, kcal: 10 }, { name: 'Air', grams: 0, kcal: 0 }, { name: 'Rice', grams: '180 g', kcal: '234', protein: 4 }], note: 'Assumed  cooked in a little oil.' };
  const r = parseEstimate({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] });
  assert.deepEqual(r.items, [
    { name: 'Grilled chicken thigh', search: 'chicken thigh roasted', grams: 140, kcal: 290, protein: 34, carbs: 0, fat: 16 },
    { name: 'Rice', search: 'Rice', grams: 180, kcal: 234, protein: 4, carbs: null, fat: null },
  ]);
  assert.equal(r.note, 'Assumed cooked in a little oil.');
  assert.equal(parseEstimate('```json\n{"items":[{"name":"Banana","search":"banana raw","grams":118,"kcal":105,"protein":1,"carbs":27,"fat":0}],"note":""}\n```').items[0].name, 'Banana');
  assert.deepEqual(parseEstimate({ promptFeedback: { blockReason: 'SAFETY' } }), { items: [], note: '', blocked: 'SAFETY' });
  assert.deepEqual(parseEstimate('not json').items, []);
  assert.equal(parseEstimate({ candidates: [{ content: { parts: [{ text: '{"items":[{"name":"Cake","search":"cake","grams":99999,"kcal":99999}],"note":""}' }] } }] }).items[0].grams, 5000, 'impossible amounts are capped');
});

test('pickMatch over the real USDA list: plain foods match; fried or sauced ones keep the estimate; plain beats restaurant', async () => {
  const rows = [
    // [search, grams, Gemini kcal, USDA food expected (start of name) or null for "keep Gemini's numbers"]
    ['chicken thigh roasted', 140, 290, 'Chicken, broilers or fryers, thigh, meat only, cooked, roasted'],
    ['rice white cooked', 180, 234, 'Rice, white, long-grain, regular, enriched, cooked'],
    ['broccoli cooked', 90, 32, 'Broccoli, cooked, boiled'],
    ['banana raw', 118, 105, 'Bananas, raw'],
    ['chicken drumstick fried', 120, 330, 'Chicken, broilers or fryers, drumstick, meat and skin, cooked, fried, flour'],
    ['spaghetti meat sauce', 350, 500, 'Restaurant, Italian, spaghetti with meat sauce'], // not OLIVE GARDEN's
    ['broccoli cooked', 90, 150, null], // drenched in butter: plain broccoli would be far too low
  ];
  for (const [q, grams, kcal, want] of rows) {
    const m = pickMatch({ grams, kcal }, await searchLocal(q, 8));
    if (want == null) assert.equal(m, null, q);
    else assert.ok(m && m.name.startsWith(want), `${q}: ${m && m.name}`);
  }
  assert.equal(pickMatch({ grams: 0, kcal: 10 }, [{ name: 'X', per100g: { kcal: 10 } }]), null);
});

test('itemNutrients and itemEntry: a match logs as the USDA food by the gram; an estimate logs like Quick add, scaled', () => {
  const food = { key: 'usda:173944', name: 'Bananas, raw', per100g: { kcal: 89, protein: 1.09, carbs: 22.84, fat: 0.33 } };
  const item = { name: 'Banana', grams: 118, kcal: 105, protein: 1.3, carbs: 27, fat: 0.4 };
  assert.ok(Math.abs(itemNutrients(item, food, 200).kcal - 178) < 1e-9);
  const e = itemEntry(item, food, 150);
  assert.equal(e.foodKey, 'usda:173944');
  assert.equal(e.name, 'Banana', 'the plain name, not the USDA one');
  assert.deepEqual([e.serving, e.qty], [{ label: 'g', grams: 1 }, 150]);
  assert.ok(Math.abs(e.per.kcal * e.qty - 133.5) < 1e-9);
  const q = itemEntry({ ...item, name: 'Fried plantain' }, null, 236);
  assert.equal(q.foodKey, 'quick');
  assert.equal(q.name, 'Fried plantain (photo estimate)');
  assert.deepEqual([q.serving, q.qty], [{ label: '236 g', grams: 236 }, 1]);
  assert.equal(q.per.kcal, 210);
  assert.ok(Math.abs(q.per.protein - 2.6) < 1e-9);
  assert.equal(q.per.sodium, null, 'unknown, not zero');
});

test('explainError: what each Google error means, and when the next model is worth a try', () => {
  assert.match(explainError(400, { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] } }).message, /isn't valid/);
  assert.match(explainError(403, { error: { status: 'PERMISSION_DENIED', message: 'Generative Language API has not been used in project 123 before or it is disabled.', details: [{ reason: 'SERVICE_DISABLED' }] } }).message, /Generative Language API/);
  assert.deepEqual(explainError(429, { error: { status: 'RESOURCE_EXHAUSTED' } }).tryNext, true);
  assert.equal(explainError(404, null).tryNext, true);
  assert.equal(explainError(503, null).tryNext, true);
  assert.equal(explainError(400, { error: { status: 'INVALID_ARGUMENT', message: 'Bad image' } }).tryNext, false);
  assert.match(explainError(0, null).message, /reach Google|offline/);
  assert.match(explainError(401, { error: { message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'ACCESS_TOKEN_TYPE_UNSUPPORTED' }] } }).message, /didn't accept this key/);
});
