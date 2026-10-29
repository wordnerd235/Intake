import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOFF, normalizeFDC, offNutrients, fdcNutrients, tidyName, convertMass, sameBarcode, textOf, barcodeOfFood, customForBarcode } from '../../js/normalize.js';
import { NUTRIENTS } from '../../js/nutrition.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

const OFF = {
  code: '3017620422003', product_name: 'Hazelnut spread', brands: 'Ferrero,Nutella', serving_size: '15 g', serving_quantity: '15',
  nutriments: {
    'energy-kcal_100g': 539, energy_100g: 2255, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9, fiber_100g: 0,
    sugars_100g: 56.3, 'saturated-fat_100g': 10.6, sodium_100g: 0.0428, cholesterol_100g: 0.005, potassium_100g: 0.4,
    calcium_100g: 0.11, iron_100g: 0.0035, 'vitamin-c_100g': 0.012, 'vitamin-a_100g': 0.0002, 'vitamin-d_100g': 0.0000025,
  },
};

test('OFF: grams -> mg/µg conversions', () => {
  const f = normalizeOFF(OFF);
  assert.equal(f.key, 'off:3017620422003');
  assert.equal(f.source, 'off');
  assert.equal(f.brand, 'Ferrero');
  near(f.per100g.sodium, 42.8);
  near(f.per100g.cholesterol, 5);
  near(f.per100g.potassium, 400);
  near(f.per100g.calcium, 110);
  near(f.per100g.iron, 3.5);
  near(f.per100g.vitC, 12);
  near(f.per100g.vitA, 200);
  near(f.per100g.vitD, 2.5);
  assert.equal(f.per100g.kcal, 539);
  assert.equal(f.per100g.protein, 6.3);
  assert.equal(f.per100g.transFat, null);
  assert.deepEqual(Object.keys(f.per100g), NUTRIENTS);
  assert.deepEqual(f.servings, [{ label: '15 g', grams: 15 }]);
});

test('OFF: kJ fallback, salt fallback, no energy => skipped', () => {
  const n = offNutrients({ energy_100g: 418.4, salt_100g: 1.25 });
  near(n.kcal, 100, 0.01);
  near(n.sodium, 500);
  assert.equal(offNutrients({ proteins_100g: 3 }), null);
  assert.equal(normalizeOFF({ code: '1', product_name: 'X', nutriments: { proteins_100g: 3 } }), null);
  assert.equal(normalizeOFF({ code: '', product_name: 'X', nutriments: { 'energy-kcal_100g': 5 } }), null);
  assert.equal(normalizeOFF({ code: '1', product_name: '', nutriments: { 'energy-kcal_100g': 5 } }), null);
  assert.equal(normalizeOFF(null), null);
  assert.equal(normalizeOFF('x'), null);
});

test('OFF: no serving -> 100 g default; junk values ignored; kcal 0 is valid', () => {
  const f = normalizeOFF({ code: '9', product_name: 'Water', nutriments: { 'energy-kcal_100g': 0, proteins_100g: 'abc', fat_100g: -3, sodium_100g: '0.001' } });
  assert.deepEqual(f.servings, [{ label: '100 g', grams: 100 }]);
  assert.equal(f.per100g.kcal, 0);
  assert.equal(f.per100g.protein, null);
  assert.equal(f.per100g.fat, null);
  near(f.per100g.sodium, 1);
  const g = normalizeOFF({ code: '9', product_name: 'Soda', serving_quantity: 330, nutriments: { 'energy-kcal_100g': 42 } });
  assert.deepEqual(g.servings, [{ label: '330 g', grams: 330 }]);
});

const FDC = {
  fdcId: 1234567, description: 'GREEK YOGURT, VANILLA', brandOwner: 'ACME DAIRY INC', brandName: 'ACME', gtinUpc: '012345678905',
  servingSize: 170, servingSizeUnit: 'g', householdServingFullText: '3/4 cup',
  foodNutrients: [
    { nutrientId: 1008, nutrientNumber: '208', unitName: 'KCAL', value: 94 },
    { nutrientId: 1003, nutrientNumber: '203', unitName: 'G', value: 9.4 },
    { nutrientId: 1005, nutrientNumber: '205', unitName: 'G', value: 12.9 },
    { nutrientId: 1004, nutrientNumber: '204', unitName: 'G', value: 0.6 },
    { nutrientId: 1093, nutrientNumber: '307', unitName: 'MG', value: 41 },
    { nutrientId: 1087, nutrientNumber: '301', unitName: 'MG', value: 106 },
    { nutrientId: 1104, nutrientNumber: '318', unitName: 'IU', value: 100 },
    { nutrientId: 1110, nutrientNumber: '324', unitName: 'IU', value: 40 },
    { nutrientId: 1253, nutrientNumber: '601', unitName: 'MG', value: 6 },
    { nutrientId: 2000, nutrientNumber: '269', unitName: 'G', value: 11.8 },
  ],
};

test('FDC: nutrient mapping, IU conversions, name tidy, servings', () => {
  const f = normalizeFDC(FDC);
  assert.equal(f.key, 'fdc:1234567');
  assert.equal(f.source, 'fdc');
  assert.equal(f.name, 'Greek Yogurt, Vanilla');
  assert.equal(f.brand, 'Acme');
  assert.equal(f.per100g.kcal, 94);
  assert.equal(f.per100g.sodium, 41);
  assert.equal(f.per100g.sugar, 11.8);
  near(f.per100g.vitA, 30); // 100 IU * 0.3
  near(f.per100g.vitD, 1); // 40 IU * 0.025
  assert.equal(f.per100g.fiber, null);
  assert.equal(f.servings[0].grams, 170);
  assert.equal(f.servings[0].label, '3/4 cup (170 g)');
  assert.equal(f.gtin, '012345678905');
});

test('FDC: kJ-only energy, unit conversion, direct RAE beats IU, bad input', () => {
  const n = fdcNutrients([{ nutrientNumber: '268', unitName: 'kJ', value: 418.4 }, { nutrientNumber: '303', unitName: 'UG', value: 3500 }, { nutrientNumber: '320', unitName: 'UG', value: 50 }, { nutrientNumber: '318', unitName: 'IU', value: 1000 }]);
  near(n.kcal, 100, 0.01);
  near(n.iron, 3.5);
  assert.equal(n.vitA, 50);
  assert.equal(fdcNutrients([{ nutrientNumber: '203', unitName: 'G', value: 3 }]), null, 'no energy');
  assert.equal(fdcNutrients(null), null);
  assert.equal(normalizeFDC({ description: 'x' }), null);
  assert.equal(normalizeFDC(null), null);
  const f = normalizeFDC({ fdcId: 1, description: 'Thing', foodNutrients: [{ nutrientNumber: '208', unitName: 'KCAL', value: 10 }], servingSize: 5, servingSizeUnit: 'tsp' });
  assert.deepEqual(f.servings, [{ label: '100 g', grams: 100 }], 'unknown serving unit falls back to 100 g');
});

test('helpers', () => {
  assert.equal(tidyName('GREEK YOGURT (PLAIN)'), 'Greek Yogurt (Plain)');
  assert.equal(tidyName('iPhone Case'), 'iPhone Case');
  assert.equal(tidyName('  a   b '), 'a b');
  near(convertMass(1000, 'MG', 'g'), 1);
  near(convertMass(1, 'g', 'mg'), 1000);
  near(convertMass(1000, 'µg', 'mg'), 1);
  assert.equal(convertMass(1, 'IU', 'mg'), null);
  assert.ok(sameBarcode('012345678905', '12345678905'));
  assert.ok(!sameBarcode('', ''));
  assert.ok(!sameBarcode('123', '124'));
});

test('OFF: text fields may be strings, arrays or language objects, never "[object Object]"', () => {
  const base = { code: '999', nutriments: { 'energy-kcal_100g': 100 } };
  assert.equal(normalizeOFF({ ...base, product_name: { en: 'Oat drink', fr: 'Boisson' } }).name, 'Oat drink');
  assert.equal(normalizeOFF({ ...base, product_name: { main: 'Haferdrink' } }).name, 'Haferdrink');
  assert.equal(normalizeOFF({ ...base, product_name: { de: 'Nur Deutsch' } }).name, 'Nur Deutsch');
  assert.equal(normalizeOFF({ ...base, product_name: ['Soup'] }).name, 'Soup');
  assert.equal(normalizeOFF({ ...base, product_name: '', product_name_en: { en: 'Fallback' } }).name, 'Fallback');
  assert.equal(normalizeOFF({ ...base, product_name: 'X', brands: ['Acme', 'Other'] }).brand, 'Acme');
  assert.equal(normalizeOFF({ ...base, product_name: 'X', brands: { en: 'Acme, Other' } }).brand, 'Acme');
  assert.equal(normalizeOFF({ ...base, product_name: 'X', serving_quantity: 30, serving_size: { en: '2 cookies (30 g)' } }).servings[0].label, '2 cookies (30 g)');
  assert.equal(normalizeOFF({ ...base, product_name: { weird: 5 } }), null);
  assert.equal(textOf(null), '');
  assert.equal(textOf({}), '');
  assert.ok(!/object/i.test(normalizeOFF({ ...base, product_name: { x: {} } })?.name || ''));
});

test('FDC: the OpenAPI field name "number" works like nutrientNumber; ml servings say they are approximate', () => {
  const n = fdcNutrients([{ number: '208', unitName: 'KCAL', amount: 50 }, { number: '307', unitName: 'MG', amount: 20 }]);
  assert.equal(n.kcal, 50);
  assert.equal(n.sodium, 20);
  const f = normalizeFDC({ fdcId: 7, description: 'Juice', foodNutrients: [{ nutrientNumber: '208', unitName: 'KCAL', value: 45 }], servingSize: 240, servingSizeUnit: 'ml', householdServingFullText: '1 cup' });
  assert.equal(f.servings[0].label, '1 cup (240 ml, about 240 g)');
  assert.equal(f.servings[0].grams, 240);
});

test('barcodeOfFood reads the barcode from an OFF key, a USDA gtin or a saved custom food', () => {
  assert.equal(barcodeOfFood({ key: 'off:0016000504622' }), '0016000504622');
  assert.equal(barcodeOfFood({ key: 'fdc:2339095', gtin: '00850791002352' }), '00850791002352');
  assert.equal(barcodeOfFood({ key: 'custom:x', barcode: '123456789012' }), '123456789012');
  assert.equal(barcodeOfFood({ key: 'usda:173944' }), '');
  assert.equal(barcodeOfFood({ key: 'off:abc' }), '');
  assert.equal(barcodeOfFood(null), '');
});

test('customForBarcode finds a corrected copy, ignoring leading zeros', () => {
  const customs = [{ id: 'a', name: 'No code' }, { id: 'b', name: 'Fixed bar', barcode: '016000504622' }];
  assert.equal(customForBarcode(customs, '0016000504622').id, 'b');
  assert.equal(customForBarcode(customs, '99999999'), null);
  assert.equal(customForBarcode([], '016000504622'), null);
});
