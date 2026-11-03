// Live label camera: frame checks (steady, in focus, a whole label at a readable size) and when an automatic read counts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toGray, coarse, motion, sharpness, textLayout, judgeFrame, wholeLabel, FRAME } from '../../js/label-frame.js';
import { parseNutritionLabel } from '../../js/label-parse.js';

/** A w x h gray "label": dark text strokes `stroke` pixels wide on white, optionally box-blurred `blur` times. */
function printed(w, h, stroke = 2, blur = 0) {
  let g = new Uint8Array(w * h).fill(240);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (y % 12 < 8 && x % 7 < stroke) g[y * w + x] = 20;
  for (let k = 0; k < blur; k++) {
    const n = new Uint8Array(g);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += g[(y + dy) * w + x + dx];
      n[y * w + x] = s / 9;
    }
    g = n;
  }
  return g;
}

test('toGray and motion: a still frame does not move; a shifted one does', () => {
  assert.deepEqual([...toGray(Uint8Array.from([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]))], [255, 0, 76]);
  const a = printed(60, 60);
  assert.equal(motion(a, a), 0);
  const shifted = new Uint8Array(a.length);
  shifted.set(a.subarray(3));
  assert.ok(motion(a, shifted) > FRAME.maxMotion, String(motion(a, shifted)));
  assert.equal(motion(a, null), Infinity, 'the first frame has nothing to compare with');
});

test('coarse: block averages, so a one-pixel drift of fine print is not movement but aiming elsewhere is', () => {
  assert.deepEqual([...coarse(Uint8Array.from([0, 8, 4, 4, 0, 8, 4, 4]), 4, 2, 2)], [4, 4]);
  const a = printed(96, 128, 2, 2); // a thumbnail of a camera frame is a little soft
  const drift = new Uint8Array(a.length);
  drift.set(a.subarray(1)); // one thumbnail pixel (about 1% of the frame)
  assert.ok(motion(a, drift) > FRAME.maxMotion, 'raw thumbnails: fine print makes any drift look like movement');
  assert.ok(motion(coarse(a, 96, 128), coarse(drift, 96, 128)) <= FRAME.maxMotion, 'coarse copies: steady enough');
  const away = new Uint8Array(a.length).fill(240);
  assert.ok(motion(coarse(a, 96, 128), coarse(away, 96, 128)) > FRAME.maxMotion, 'pointed at a blank wall');
});

test('sharpness: crisp print passes, blurred print and a blank surface do not', () => {
  const crisp = sharpness(printed(120, 120), 120, 120);
  const soft = sharpness(printed(120, 120, 2, 32), 120, 120); // about a 4-pixel Gaussian blur
  assert.ok(crisp >= FRAME.minSharp, `crisp ${crisp}`);
  assert.ok(soft < FRAME.minSharp, `soft ${soft}`);
  assert.equal(sharpness(new Uint8Array(100).fill(128), 10, 10), 0);
});

test('textLayout: counts lines (not specks), median print height, and how much of the frame they span', () => {
  const line = (y, h = 30, x = 100, w = 400) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const boxes = [...Array.from({ length: 12 }, (_, i) => line(300 + i * 80)), [[10, 10], [30, 10], [30, 40], [10, 40]]];
  const t = textLayout(boxes, 1080, 1440);
  assert.equal(t.lines, 12, 'the 20x30 speck is not a line');
  assert.ok(Math.abs(t.textH - 30 / 1440) < 1e-9);
  assert.ok(t.span > 0.6 && t.span < 0.7, String(t.span));
  assert.deepEqual(textLayout([], 100, 100), { lines: 0, textH: 0, span: 0 });
});

test('judgeFrame: one hint at a time, in the order the person can fix them', () => {
  const label = { lines: 40, textH: 0.03, span: 0.7 };
  assert.equal(judgeFrame({ motion: 20, sharp: 0.5, text: label }).hint, 'Hold steady…');
  assert.match(judgeFrame({ motion: 1, sharp: 0.05, text: label }).hint, /^Focusing/);
  assert.equal(judgeFrame({ motion: 1, sharp: 0.5, text: null }).hint, 'Looking for the label…');
  assert.match(judgeFrame({ motion: 1, sharp: 0.5, text: { lines: 2, textH: 0.03, span: 0.1 } }).hint, /Nutrition Facts panel/);
  assert.match(judgeFrame({ motion: 1, sharp: 0.5, text: { lines: 16, textH: 0.008, span: 0.2 } }).hint, /closer/);
  assert.match(judgeFrame({ motion: 1, sharp: 0.5, text: { lines: 16, textH: 0.08, span: 0.95 } }).hint, /back/);
  assert.deepEqual(judgeFrame({ motion: 1, sharp: 0.5, text: label }), { ready: true, hint: 'Hold still…' });
  // after a while without a shot, a shakier hand and a softer camera are accepted
  assert.equal(judgeFrame({ motion: 22, sharp: 0.2, text: label }).ready, false);
  assert.equal(judgeFrame({ motion: 22, sharp: 0.2, text: label, relaxed: true }).ready, true);
});

test('wholeLabel: an automatic read needs calories and 4 core rows; half a panel waits for a better shot', () => {
  assert.ok(wholeLabel(parseNutritionLabel('Calories 0\nTotal Fat 0g\nSodium 0mg\nTotal Carbohydrate 8g\nTotal Sugars 0g\nProtein 0g')));
  assert.ok(!wholeLabel(parseNutritionLabel('Calories 230\nTotal Fat 8g\nSaturated Fat 1g')), 'the bottom of the label was cut off');
  assert.ok(!wholeLabel(parseNutritionLabel('Total Fat 8g\nSodium 160mg\nTotal Carbohydrate 37g\nProtein 3g')), 'no calories');
});
