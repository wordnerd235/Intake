// label-frame.js - PURE checks on live camera frames for the label scanner: is the phone steady, is the picture in
// focus, and does the text detector see a whole Nutrition Facts panel at a readable size? No DOM: label-scan.js feeds
// it pixels and detector boxes; tests feed it arrays.

/**
 * Thresholds, tuned on real phone photos of labels and on bad frames made from them (blurred, too far, no label).
 * Sizes are fractions of the frame's longer side.
 */
export const FRAME = {
  /** Mean gray-level change per pixel between two checks (0-255) above which the phone is still moving. */
  maxMotion: 7,
  /** Focus score (see sharpness) below which the picture is too soft to read. */
  minSharp: 0.3,
  /** Fewest text lines a Nutrition Facts panel shows (even a short one: calories, fat, sodium, carbs, sugars, protein). */
  minLines: 8,
  /** Median text height: below this the print is too small to read well (the label is too far away). */
  minTextH: 0.011,
  /** ...and above this only part of the label can be in the frame. */
  maxTextH: 0.06,
  /** The text must spread over at least this much of the frame's height (the label fills the frame). */
  minSpan: 0.35,
};

/**
 * RGBA pixels to gray levels (0-255).
 * @param {Uint8ClampedArray|Uint8Array} rgba
 * @returns {Uint8Array}
 */
export function toGray(rgba) {
  const g = new Uint8Array(rgba.length >> 2);
  for (let i = 0, p = 0; p < g.length; i += 4, p++) g[p] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  return g;
}

/**
 * How much the picture changed between two checks: mean absolute gray-level difference per pixel.
 * @param {Uint8Array} a
 * @param {Uint8Array} b same size as a
 * @returns {number} 0-255; Infinity when there is nothing to compare
 */
export function motion(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/**
 * Focus score of a gray patch taken at the camera's full resolution: the strongest edges (98th percentile of the
 * absolute Laplacian) relative to the patch's contrast range. Sharp print scores high; a soft or shaken picture scores
 * low whatever its lighting.
 * @param {Uint8Array} gray
 * @param {number} w
 * @param {number} h
 * @returns {number} roughly 0-1
 */
export function sharpness(gray, w, h) {
  if (w < 3 || h < 3) return 0;
  const hist = new Uint32Array(1021);
  const lv = new Uint32Array(256);
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = Math.abs(4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w]);
      hist[lap]++;
      lv[gray[i]]++;
      n++;
    }
  }
  const pct = (hst, q) => { let acc = 0; for (let v = 0; v < hst.length; v++) { acc += hst[v]; if (acc >= q * n) return v; } return hst.length - 1; };
  const range = pct(lv, 0.95) - pct(lv, 0.05);
  return range < 24 ? 0 : pct(hist, 0.98) / range; // a flat patch (range < 24) has nothing to focus on
}

/**
 * What the text detector saw: how many lines, how big the print is, and how much of the frame the text covers.
 * @param {Array<number[][]>} boxes quads [tl, tr, br, bl] in frame pixels
 * @param {number} fw frame width
 * @param {number} fh frame height
 * @returns {{lines:number, textH:number, span:number}} textH as a fraction of the frame's longer side, span of its height
 */
export function textLayout(boxes, fw, fh) {
  const side = Math.max(fw, fh);
  const rows = [];
  for (const [tl, tr, br, bl] of boxes) {
    const hgt = (Math.hypot(bl[0] - tl[0], bl[1] - tl[1]) + Math.hypot(br[0] - tr[0], br[1] - tr[1])) / 2;
    const wid = (Math.hypot(tr[0] - tl[0], tr[1] - tl[1]) + Math.hypot(br[0] - bl[0], br[1] - bl[1])) / 2;
    if (wid < hgt * 1.2) continue; // a lone character or a speck: not a line of text
    rows.push({ h: hgt, y: (tl[1] + tr[1] + br[1] + bl[1]) / 4 });
  }
  if (!rows.length) return { lines: 0, textH: 0, span: 0 };
  const hs = rows.map((r) => r.h).sort((a, b) => a - b);
  const ys = rows.map((r) => r.y).sort((a, b) => a - b);
  const at = (arr, q) => arr[Math.min(arr.length - 1, Math.floor(q * arr.length))];
  return { lines: rows.length, textH: at(hs, 0.5) / side, span: (at(ys, 0.95) - at(ys, 0.05)) / fh };
}

/**
 * Is this frame worth reading, and if not, what should the person do?
 * @param {{motion:number, sharp:number, text?:{lines:number, textH:number, span:number}|null}} f text is left out
 *   until the cheaper checks pass
 * @returns {{ready:boolean, hint:string}}
 */
export function judgeFrame({ motion: mo, sharp, text }) {
  if (!(mo <= FRAME.maxMotion)) return { ready: false, hint: 'Hold steady…' };
  if (!(sharp >= FRAME.minSharp)) return { ready: false, hint: 'Focusing… hold the label flat, in good light.' };
  if (!text) return { ready: false, hint: 'Looking for the label…' };
  if (text.lines < FRAME.minLines) return { ready: false, hint: 'Point the camera at the Nutrition Facts panel, close enough to fill the frame.' };
  if (text.textH > FRAME.maxTextH) return { ready: false, hint: 'Move back so the whole label fits.' };
  if (text.textH < FRAME.minTextH || text.span < FRAME.minSpan) return { ready: false, hint: 'Move closer so the label fills the frame.' };
  return { ready: true, hint: 'Hold still…' };
}

/** Core rows an automatic read must find (besides calories) before it is trusted without a tap. */
const CORE = ['fat', 'satFat', 'sodium', 'carbs', 'fiber', 'sugar', 'protein'];

/**
 * Did an automatic read get the whole label? Calories and at least 4 core rows; a partial read (the shot cut off half
 * the panel) waits for a better frame instead of opening a half-empty form.
 * @param {{per:Record<string,number>}} r a parseNutritionLabel result
 * @returns {boolean}
 */
export function wholeLabel(r) {
  return r.per.kcal != null && CORE.filter((k) => r.per[k] != null).length >= 4;
}
