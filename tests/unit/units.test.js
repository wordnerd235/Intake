import test from 'node:test';
import assert from 'node:assert/strict';
import * as U from '../../js/units.js';

test('parseAmount accepts decimals and fractions', () => {
  const cases = [['2', 2], ['1.5', 1.5], ['.5', 0.5], ['1/2', 0.5], ['1 1/2', 1.5], ['1-1/2', 1.5], ['  3/4 ', 0.75], ['0', 0], ['1,5', 1.5], ['½', 0.5], ['1½', 1.5], ['2 ¾', 2.75], ['10 1/4', 10.25]];
  for (const [s, n] of cases) assert.ok(Math.abs(U.parseAmount(s) - n) < 1e-9, `${s} -> ${U.parseAmount(s)}`);
  assert.ok(Math.abs(U.parseAmount('1/3') - 1 / 3) < 1e-12);
});

test('parseAmount rejects garbage, negatives, zero denominators', () => {
  for (const s of ['', ' ', 'abc', '1/0', '1 1/0', '-2', '1.2.3', '1/', '/2', '1e3', null, undefined, NaN, '--1', '1 2']) {
    assert.equal(U.parseAmount(s), null, String(s));
  }
  assert.equal(U.parseAmount(3), 3);
  assert.equal(U.parseAmount(-1), null);
});

test('parseAmount reads a comma before exactly three digits as thousands (R-30)', () => {
  const thousands = [['1,200', 1200], ['2,500', 2500], ['12,500', 12500], ['1,000', 1000], ['123,456', 123456], ['1,234,567', 1234567], ['1,234.5', 1234.5], [' 1,200 ', 1200]];
  for (const [s, n] of thousands) assert.equal(U.parseAmount(s), n, s);
});

test('parseAmount keeps a comma before one or two digits, or after a leading 0, as a decimal point', () => {
  const decimals = [['1,5', 1.5], ['1,25', 1.25], ['0,75', 0.75], ['0,250', 0.25], [',5', 0.5], ['185,5', 185.5], ['10,50', 10.5], ['0,2345', 0.2345]];
  for (const [s, n] of decimals) assert.ok(Math.abs(U.parseAmount(s) - n) < 1e-9, `${s} -> ${U.parseAmount(s)}`);
});

test('parseAmount refuses a comma it cannot read, and ambiguousNumber says so', () => {
  for (const s of ['1,2345', '1,2,3', '12,34,567', '1.234,5', '1,200,5', '1,,200']) {
    assert.equal(U.parseAmount(s), null, s);
    assert.equal(U.ambiguousNumber(s), true, s);
  }
  for (const s of ['abc', '', '1,5', '1,200', '1,200 g', '-3']) assert.equal(U.ambiguousNumber(s), false, s);
  const msg = U.rangeProblem(U.parseAmount('1,2345'), { label: 'Calories', unit: 'kcal', max: 10000, raw: '1,2345' });
  assert.match(msg, /Calories: "1,2345" is unclear/);
  assert.match(msg, /no commas for thousands/);
  assert.equal(U.rangeProblem(null, { label: 'Calories', raw: 'abc' }), 'Calories must be a number.');
  assert.equal(U.rangeProblem(U.parseAmount('1,200'), { label: 'Calories', unit: 'kcal', max: 10000, raw: '1,200' }), '');
  assert.equal(U.rangeProblem(U.parseAmount('12,000'), { label: 'Calories', unit: 'kcal', max: 10000, raw: '12,000' }), 'Calories can be at most 10,000 kcal.');
});

test('weight / height / water conversions round trip', () => {
  assert.ok(Math.abs(U.lbToKg(176) - 79.8) < 0.05);
  assert.ok(Math.abs(U.kgToLb(U.lbToKg(180)) - 180) < 1e-9);
  assert.deepEqual(U.cmToFtIn(177.8), { ft: 5, in: 10 });
  assert.deepEqual(U.cmToFtIn(182.88), { ft: 6, in: 0 });
  assert.deepEqual(U.cmToFtIn(182.5), { ft: 6, in: 0 }, '71.85 in rounds up and carries to the next foot');
  assert.ok(Math.abs(U.ftInToCm(5, 10) - 177.8) < 1e-9);
  assert.ok(Math.abs(U.mlToOz(U.ozToMl(64)) - 64) < 1e-9);
  assert.equal(Math.round(U.glassMl('oz')), 237);
  assert.equal(U.glassMl('ml'), 250);
});

test('formatting never yields NaN', () => {
  assert.equal(U.formatWeight(null, 'lb'), '-');
  assert.equal(U.formatWeight(NaN, 'kg'), '-');
  assert.equal(U.formatWeight(80, 'kg'), '80.0 kg');
  assert.equal(U.formatWeight(80, 'lb'), '176.4 lb');
  assert.equal(U.formatHeight(177.8, 'ftin'), `5'10"`);
  assert.equal(U.formatHeight(undefined, 'cm'), '-');
  assert.equal(U.fmtInt(1850.4), '1,850');
  assert.equal(U.fmtInt(NaN), '0');
  assert.equal(U.fmtInt(-1234), '-1,234');
  assert.equal(U.fmtInt(1e22), '10,000,000,000,000,000,000,000', 'never an exponent');
  assert.equal(U.fmtInt(1.5e300).includes('e'), false);
  assert.equal(U.trimNum(1e25), '10000000000000000905969664');
  assert.ok(!/e/.test(U.trimNum(-1e30)));
  assert.equal(U.formatQty(1.5), '1.5');
  assert.equal(U.formatQty(0.33333), '0.33');
  assert.equal(U.formatQty(2), '2');
  assert.equal(U.formatWater(1893, 'oz'), '64 oz');
  assert.equal(U.formatWater(undefined, 'ml'), '0 ml');
});

test('pace choices', () => {
  assert.deepEqual(U.paceChoices('kg').map((p) => p.kg), [0.25, 0.5, 0.75, 1]);
  const lb = U.paceChoices('lb');
  assert.equal(lb.length, 4);
  assert.ok(Math.abs(lb[1].kg - 0.45359) < 1e-4);
  assert.equal(lb[0].label, '0.5 lb / week');
});

test('rangeProblem names the limit that was broken, in the unit the person typed', () => {
  assert.equal(U.rangeProblem(250, { label: 'Calories', unit: 'kcal', max: 10000 }), '');
  assert.equal(U.rangeProblem(null, { label: 'Calories' }), 'Calories must be a number.');
  assert.equal(U.rangeProblem(0, { label: 'Minutes' }), 'Minutes must be above 0.');
  assert.equal(U.rangeProblem(0, { label: 'Calories', allowZero: true }), '');
  assert.equal(U.rangeProblem(999999999, { label: 'Calories', unit: 'kcal', max: U.LIMITS.kcal }), 'Calories can be at most 10,000 kcal.');
  assert.equal(U.rangeProblem(5001, { label: 'Calories burned', unit: 'kcal', max: U.LIMITS.exerciseKcal }), 'Calories burned can be at most 5,000 kcal.');
  assert.equal(U.rangeProblem(5000, { label: 'Calories burned', unit: 'kcal', max: U.LIMITS.exerciseKcal }), '');
  assert.equal(U.rangeProblem(1500, { label: 'Protein', unit: 'g', max: U.LIMITS.macroGrams }), '');
  assert.equal(U.rangeProblem(3000, { label: 'Protein', unit: 'g', max: U.LIMITS.macroGrams }), 'Protein can be at most 2,000 g.');
  assert.equal(U.rangeProblem(5, { label: 'Daily calories', unit: 'kcal', ...U.LIMITS.calorieOverride }), 'Daily calories must be at least 500 kcal.');
  assert.equal(U.rangeProblem(Infinity, { label: 'X' }), 'X must be a number.');
});

test('amountProblem talks about servings when servings were typed and grams when grams were', () => {
  const banana = { label: '1 medium', grams: 118 };
  assert.equal(U.amountProblem(2, banana), '');
  assert.equal(U.amountProblem(10000, { label: '1 serving', grams: null }), '', 'no weight, so only the servings limit applies');
  assert.equal(U.amountProblem(10001, { label: '1 serving', grams: null }), 'One entry can hold at most 10,000 servings.');
  assert.equal(U.amountProblem(10000, banana), 'That comes to 1,180,000 g. One entry can hold at most 10,000 g, so try a smaller amount.');
  assert.equal(U.amountProblem(84, banana), '', '84 x 118 g = 9,912 g is allowed');
  assert.match(U.amountProblem(86, banana), /^That comes to 10,148 g\./);
  assert.equal(U.amountProblem(10000, { label: 'g', grams: 1 }), '');
  assert.equal(U.amountProblem(10001, { label: 'g', grams: 1 }), 'One entry can hold at most 10,000 g.');
  assert.match(U.amountProblem(400, { label: 'oz', grams: 28.35 }), /^That comes to 11,340 g\./);
});

test('maxForUnit gives every custom-food nutrient a ceiling', () => {
  assert.equal(U.maxForUnit('kcal'), 10000);
  assert.equal(U.maxForUnit('g'), 10000);
  assert.equal(U.maxForUnit('mg'), 100000);
  assert.equal(U.maxForUnit('µg'), 100000);
});
