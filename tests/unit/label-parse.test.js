// Nutrition Facts label parsing: clean text, typical OCR noise, and the traps (Added Sugars, % DV numbers, lost "g").
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNutritionLabel, cleanLine } from '../../js/label-parse.js';

const CLEAN = `Nutrition Facts
8 servings per container
Serving size 2/3 cup (55g)
Amount per serving
Calories 230
% Daily Value*
Total Fat 8g 10%
Saturated Fat 1g 5%
Trans Fat 0g
Cholesterol 0mg 0%
Sodium 160mg 7%
Total Carbohydrate 37g 13%
Dietary Fiber 4g 14%
Total Sugars 12g
Includes 10g Added Sugars 20%
Protein 3g
Vitamin D 2mcg 10%
Calcium 260mg 20%
Iron 8mg 45%
Potassium 240mg 6%`;

test('a clean label: every row, the serving, and Added Sugars ignored', () => {
  const r = parseNutritionLabel(CLEAN);
  assert.deepEqual(r.per, { kcal: 230, fat: 8, satFat: 1, transFat: 0, cholesterol: 0, sodium: 160, carbs: 37, fiber: 4, sugar: 12, protein: 3, vitD: 2, calcium: 260, iron: 8, potassium: 240 });
  assert.equal(r.label, '2/3 cup');
  assert.equal(r.grams, 55);
  assert.equal(r.found[0], 'kcal');
});

test('OCR noise: lost "g" read as 9, letter O for zero, calories on their own line, odd case and symbols', () => {
  const ocr = `NUTRITION FACTS
Serving Size 1 bar (40g)
Calories
190
Total Fat 89 10%
Saturated Fat 3.5g 18%
Trans Fat Og
Cholesterol 5mg 2%
Sodium 1,200mg 52%
Total Carbohydrate 2og 7%
Protein 9g`;
  const r = parseNutritionLabel(ocr);
  assert.equal(r.per.kcal, 190);
  assert.equal(r.per.fat, 8, '"89 10%" is 8 g (10% of 78 g), not 89 g');
  assert.equal(r.per.satFat, 3.5);
  assert.equal(r.per.transFat, 0, '"Og" is 0 g');
  assert.equal(r.per.sodium, 1200, 'comma is a thousands separator');
  assert.equal(r.per.carbs, 20, '"2og" is 20 g');
  assert.equal(r.per.protein, 9, 'a real 9 g with no % DV stays 9');
  assert.equal(r.label, '1 bar');
  assert.equal(r.grams, 40);
});

test('real OCR output of a rendered label (Tesseract 5, straight and tilted 3 degrees)', () => {
  const straight = `Nutrition Facts\n8 servings per container\nServing size 2/3 cup (559)\nLe rrr)\nMm pera\nCalories 230\n% Daily Value*\nTotal Fat 8g 10%\nSaturated Fat 1g 5%\nTrans Fat Og\nCholesterol Omg 0%\nSodium 160mg 7%\nTotal Carbohydrate 37g 13%\nDietary Fiber 49 14%\nTotal Sugars 129\nIncludes 10g Added Sugars 20%\nProtein 3g\nVitamin D 2meg 10%\nCalcium 260mg 20%\nIron 8mg 45%\nPotassium 240mg 6%`;
  const want = { kcal: 230, fat: 8, satFat: 1, transFat: 0, cholesterol: 0, sodium: 160, carbs: 37, fiber: 4, sugar: 12, protein: 3, vitD: 2, calcium: 260, iron: 8, potassium: 240 };
  const a = parseNutritionLabel(straight);
  assert.deepEqual(a.per, want);
  assert.equal(a.grams, 55, '"(559)" is 55 g');
  const tilted = `Nutrition Facts\n\n8 servings per container\n\nServing size 2/3 cu (55¢\n\nen 2200.55) er\nCalories 230\n—_————\nTotal Fat 8g 10%\nSaturated Fat 1g 5%\n\nTrans Fat [7]\n\nCholesterol Omg 0%\nSodium 160mg 7%\nTotal Carbohydrate 37g 13%\nDietary Fiber 49 14%\nTotal Sugars 12,\n\nIncludes 10; Added Sugars 20%\nVitamin D 2meg 10%\nCalcium 260m, 20%\nIron 8mg 45%\nPotassium 240mg 6%`;
  const b = parseNutritionLabel(tilted);
  const { protein, transFat, ...rest } = want;
  assert.deepEqual(b.per, rest, 'protein was not read at all, and a boxed [7] is not 7 g of trans fat');
  assert.equal(b.grams, 55);
});

test('a real 9 that agrees with its % DV is kept', () => {
  assert.equal(parseNutritionLabel('Total Fat 19 24%').per.fat, 19, '19 g is 24% of 78 g; 1 g would be 1%');
});

test('% DV-only rows (older labels) and words that are not nutrients are skipped', () => {
  const r = parseNutritionLabel(`Calories 100\nCalories from Fat 20\nVitamin A 10%\nVitamin C 0 %\nSugar Alcohol 5g\nPolyunsaturated Fat 1g\nFat 2g`);
  assert.equal(r.per.kcal, 100);
  assert.equal(r.per.vitA, undefined);
  assert.equal(r.per.vitC, undefined);
  assert.equal(r.per.sugar, undefined, 'sugar alcohol is not sugar');
  assert.equal(r.per.fat, 2);
});

test('micrograms and milligrams convert to the stored unit; impossible numbers are dropped', () => {
  const r = parseNutritionLabel('Vitamin D 0.005mg\nIron 1800 mg\nCalcium 0.2 g');
  assert.equal(r.per.vitD, 5);
  assert.equal(r.per.iron, undefined, '1800 mg iron is a misread');
  assert.equal(r.per.calcium, 200);
});

test('serving size: grams only, amount on the next line, and nothing readable', () => {
  assert.deepEqual((({ label, grams }) => ({ label, grams }))(parseNutritionLabel('Serving size 28g')), { label: '1 serving', grams: 28 });
  assert.deepEqual((({ label, grams }) => ({ label, grams }))(parseNutritionLabel('Serving size\n1 cup (240mL)')), { label: '1 cup', grams: null });
  const empty = parseNutritionLabel('a blurry photo of a cat');
  assert.deepEqual(empty.per, {});
  assert.deepEqual(empty.found, []);
  assert.equal(empty.label, '1 serving');
});

test('misspelled and run-together row names are repaired (PaddleOCR output from blurred photos)', () => {
  const r = parseNutritionLabel('Calorles 110\nSatarated Fat 0.5g 3%\nDietary Fber 2g 7%\nTotalSugars 6g\nPotassaum.400mg 9%\nIron2mg 11%\nVitamin D omcg 0%\nCholesterol Smg 2%\nIron 07mg 4%');
  assert.deepEqual(r.per, { kcal: 110, satFat: 0.5, fiber: 2, sugar: 6, potassium: 400, iron: 2, vitD: 0, cholesterol: 5 });
  assert.equal(parseNutritionLabel('Iron 07mg 4%').per.iron, 0.7, 'a lost decimal point: 07 mg is 0.7 mg');
  assert.equal(parseNutritionLabel('Iron 196').per.iron, undefined, 'a bare 196 is a misread "1%", not 196 mg of iron');
  assert.equal(parseNutritionLabel('Total Fat 3g\nFatty 9g').per.fat, 3, 'a word that only looks like a name is left alone');
});

test('cleanLine tidies OCR text', () => {
  assert.equal(cleanLine('  Total  Fat 1o g '), 'total fat 10 g');
  assert.equal(cleanLine('Vitamin D 2μg'), 'vitamin d 2µg');
  assert.equal(cleanLine(null), '');
});
