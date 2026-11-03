// PaddleOCR post-processing: box finding on a probability map, straightening crops, CTC decoding, line rebuilding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { regions, minAreaRect, boxesFromMap, cropForRecognition, ctcDecode, toLines } from '../../js/ppocr-core.js';

/** A w x h map with filled rectangles (axis-aligned) of the given probability. */
function map(w, h, rects) {
  const m = new Float32Array(w * h);
  for (const [x0, y0, x1, y1, p] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = p;
  return m;
}

test('regions: separate blobs, with their mean probability', () => {
  const r = regions(map(40, 20, [[2, 2, 12, 6, 0.9], [20, 10, 35, 15, 0.7]]), 40, 20);
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((x) => x.n).sort((a, b) => a - b), [40, 75]);
  assert.ok(Math.abs(r.find((x) => x.n === 40).score - 0.9) < 1e-6);
});

test('minAreaRect: long axis first, pointing right, also for a tilted bar', () => {
  const a = minAreaRect(Int32Array.from([0, 9, 0, 9]), Int32Array.from([0, 0, 2, 2]));
  assert.deepEqual([a.w, a.h, a.ux, a.uy], [10, 3, 1, 0]);
  const xs = [];
  const ys = [];
  for (let t = 0; t < 40; t++) for (let k = 0; k < 4; k++) { xs.push(t); ys.push(Math.round(t * 0.2) + k); } // ~11 degrees down
  const b = minAreaRect(Int32Array.from(xs), Int32Array.from(ys));
  assert.ok(b.w > 35 && b.h < 8, `${b.w} x ${b.h}`);
  assert.ok(b.ux > 0.95 && b.uy > 0.1, `${b.ux},${b.uy}`);
});

test('a lone tall digit stays upright; a clearly vertical line is read along its length', () => {
  const block = (w, h) => { const xs = []; const ys = []; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { xs.push(x); ys.push(y); } return [Int32Array.from(xs), Int32Array.from(ys)]; };
  const zero = minAreaRect(...block(10, 14));
  assert.deepEqual([zero.w, zero.h, zero.ux, zero.uy], [10, 14, 1, 0], 'minAreaRect reads along the side nearer horizontal');
  // The detector's core of the big "0" of "Calories 0" is 2:1 tall, but the grown box is not: it must not be read sideways.
  const [tl, tr, , bl] = boxesFromMap(map(40, 40, [[15, 10, 25, 30, 0.9]]), 40, 40, 1, 1)[0];
  assert.ok(tr[0] > tl[0] + 10 && Math.abs(tr[1] - tl[1]) < 1e-6 && bl[1] > tl[1] + 20, JSON.stringify([tl, tr, bl]));
  // "VITAL PROTEINS IS A REGISTERED TRADEMARK" up the side of a carton.
  const [vtl, vtr] = boxesFromMap(map(40, 80, [[18, 5, 22, 75, 0.9]]), 40, 80, 1, 1)[0];
  assert.ok(Math.abs(vtr[1] - vtl[1]) > 60, 'read along its length');
});

test('boxesFromMap: drops faint and tiny regions, grows text cores, scales to the photo', () => {
  const m = map(64, 32, [[4, 4, 44, 10, 0.95], [50, 20, 60, 24, 0.4], [50, 4, 52, 6, 0.99]]);
  const boxes = boxesFromMap(m, 64, 32, 2, 2);
  assert.equal(boxes.length, 1, 'faint (0.4 mean) and 2-pixel regions are dropped');
  const [tl, tr, br, bl] = boxes[0];
  assert.ok(tl[0] < 8 && tr[0] > 88 && tl[1] < 8 && bl[1] > 20, JSON.stringify(boxes[0]));
  assert.ok(Math.abs(br[0] - tr[0]) < 1e-6 && Math.abs(bl[1] - br[1]) < 1e-6);
});

test('cropForRecognition: straightens to height 48, normalized to [-1, 1]', () => {
  const w = 100;
  const h = 40;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const v = x < 50 ? 0 : 255; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; }
  const c = cropForRecognition({ data, width: w, height: h }, [[0, 10], [100, 10], [100, 34], [0, 34]]);
  assert.equal(c.height, 48);
  assert.equal(c.width, 200);
  assert.ok(c.data[5] < -0.99, 'left half black');
  assert.ok(c.data[48 * 200 - 5] > 0.99, 'right half white');
  assert.equal(cropForRecognition({ data, width: w, height: h }, [[0, 0], [1, 0], [1, 1], [0, 1]]), null);
});

test('ctcDecode: collapses repeats, drops blanks, keeps a repeat split by a blank', () => {
  const keys = ['', 'a', 'b', 'l', ' '];
  const steps = [1, 1, 0, 2, 2, 0, 3, 0, 3, 4];
  const probs = new Float32Array(steps.length * keys.length);
  steps.forEach((c, t) => { probs[t * keys.length + c] = 0.9; });
  assert.deepEqual(ctcDecode(probs, steps.length, keys.length, keys), { text: 'abll ', conf: 0.8999999761581421 });
});

test('toLines: words on a tilted row stay together; rows come out top to bottom', () => {
  const box = (x, y, w, slope = 0) => [[x, y], [x + w, y + slope * w], [x + w, y + 12 + slope * w], [x, y + 12]];
  const items = [
    { q: box(200, 44, 30, 0.1), text: '10%' },
    { q: box(10, 20, 80, 0.1), text: 'Total Fat' },
    { q: box(95, 29.5, 30, 0.1), text: '8g' },
    { q: box(10, 0, 120), text: 'Calories 230' },
    { q: box(10, 50, 100, 0.1), text: 'Sodium 160mg' },
  ];
  assert.equal(toLines(items), 'Calories 230\nTotal Fat 8g 10%\nSodium 160mg');
});
