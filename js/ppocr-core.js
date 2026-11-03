// ppocr-core.js - PURE parts of the PaddleOCR (PP-OCR) pipeline: text-box finding on the detector's probability map
// (DB post-processing), cropping a tilted box straight, CTC decoding of the recognizer output, and putting words back
// into lines. No DOM and no model runtime, so Node can test it; ppocr.js runs the models.

/**
 * Connected regions of `prob > thresh`, each as its pixel list and mean probability.
 * @param {Float32Array} prob row-major probability map
 * @param {number} w
 * @param {number} h
 * @param {number} [thresh]
 * @returns {Array<{xs:Int32Array, ys:Int32Array, n:number, score:number}>}
 */
export function regions(prob, w, h, thresh = 0.3) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const out = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || prob[start] <= thresh) continue;
    let top = 0;
    let n = 0;
    let sum = 0;
    stack[top++] = start;
    seen[start] = 1;
    const px = [];
    while (top) {
      const p = stack[--top];
      px.push(p);
      sum += prob[p];
      n++;
      const x = p % w;
      const y = (p - x) / w;
      if (x > 0 && !seen[p - 1] && prob[p - 1] > thresh) { seen[p - 1] = 1; stack[top++] = p - 1; }
      if (x < w - 1 && !seen[p + 1] && prob[p + 1] > thresh) { seen[p + 1] = 1; stack[top++] = p + 1; }
      if (y > 0 && !seen[p - w] && prob[p - w] > thresh) { seen[p - w] = 1; stack[top++] = p - w; }
      if (y < h - 1 && !seen[p + w] && prob[p + w] > thresh) { seen[p + w] = 1; stack[top++] = p + w; }
    }
    const xs = new Int32Array(n);
    const ys = new Int32Array(n);
    px.forEach((p, i) => { xs[i] = p % w; ys[i] = (p - xs[i]) / w; });
    out.push({ xs, ys, n, score: sum / n });
  }
  return out;
}

/** Convex hull (Andrew's monotone chain) of integer points. */
function hull(xs, ys) {
  const pts = [];
  for (let i = 0; i < xs.length; i++) pts.push([xs[i], ys[i]]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** The same rectangle read along its other side. */
function swapAxes(r) {
  return { ...r, w: r.h, h: r.w, ux: -r.uy, uy: r.ux };
}

/**
 * Smallest rotated rectangle around a region (rotating calipers over its hull). Pixel centers are widened by half a
 * pixel each way so a one-pixel line still has height.
 * @returns {{cx:number, cy:number, w:number, h:number, ux:number, uy:number}} center, size along the reading direction (w)
 *   and across it (h), and the unit vector of the reading direction (pointing right): the side nearer horizontal
 */
export function minAreaRect(xs, ys) {
  const H = hull(xs, ys);
  if (H.length < 3) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < xs.length; i++) { x0 = Math.min(x0, xs[i]); x1 = Math.max(x1, xs[i]); y0 = Math.min(y0, ys[i]); y1 = Math.max(y1, ys[i]); }
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0 + 1, h: y1 - y0 + 1, ux: 1, uy: 0 };
  }
  let best = null;
  for (let i = 0; i < H.length; i++) {
    const a = H[i];
    const b = H[(i + 1) % H.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!len) continue;
    const ux = (b[0] - a[0]) / len;
    const uy = (b[1] - a[1]) / len;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of H) {
      const u = p[0] * ux + p[1] * uy;
      const v = -p[0] * uy + p[1] * ux;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0 + 1) * (v1 - v0 + 1);
    if (!best || area < best.area) best = { area, ux, uy, u0, u1, v0, v1 };
  }
  const { ux, uy, u0, u1, v0, v1 } = best;
  const cu = (u0 + u1) / 2;
  const cv = (v0 + v1) / 2;
  let r = { cx: cu * ux - cv * uy, cy: cu * uy + cv * ux, w: u1 - u0 + 1, h: v1 - v0 + 1, ux, uy };
  if (Math.abs(r.uy) > Math.abs(r.ux)) r = swapAxes(r); // the reading direction is the side nearer horizontal: a big "0" stays upright
  if (r.ux < 0) r = { ...r, ux: -r.ux, uy: -r.uy }; // pointing right
  return r;
}

/**
 * Text boxes from the detector's probability map, as quads [tl, tr, br, bl] in the original image's pixels.
 * DB post-processing: threshold, keep confident regions, grow each by area * ratio / perimeter (the model draws
 * shrunk text cores).
 * @param {Float32Array} prob
 * @param {number} w map width
 * @param {number} h map height
 * @param {number} sx original width / map width
 * @param {number} sy original height / map height
 * @param {{thresh?:number, boxThresh?:number, unclip?:number, minSize?:number}} [o]
 * @returns {Array<number[][]>}
 */
export function boxesFromMap(prob, w, h, sx, sy, { thresh = 0.3, boxThresh = 0.6, unclip = 1.6, minSize = 3 } = {}) {
  const boxes = [];
  for (const r of regions(prob, w, h, thresh)) {
    if (r.score < boxThresh) continue;
    let m = minAreaRect(r.xs, r.ys);
    if (Math.min(m.w, m.h) < minSize) continue;
    const d = (m.w * m.h * unclip) / (2 * (m.w + m.h));
    // A grown box over 1.5 times taller than wide is a vertical line of text: read it along its length. (Judged after
    // growing, as PaddleOCR does: the shrunk core of a lone big "0" is much taller than the digit.)
    if (m.h + 2 * d > 1.5 * (m.w + 2 * d)) { m = swapAxes(m); if (m.ux < 0) m = { ...m, ux: -m.ux, uy: -m.uy }; }
    const hw = m.w / 2 + d;
    const hh = m.h / 2 + d;
    const vx = -m.uy;
    const vy = m.ux; // across the text, pointing down
    const corner = (a, b) => [(m.cx + 0.5 + a * hw * m.ux + b * hh * vx) * sx, (m.cy + 0.5 + a * hw * m.uy + b * hh * vy) * sy];
    boxes.push([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]);
  }
  return boxes;
}

/** Homography mapping the unit-free rectangle (0,0)-(W,H) onto quad [tl, tr, br, bl]. */
function homography(q, W, H) {
  const src = [[0, 0], [W, 0], [W, H], [0, H]];
  const A = [];
  const B = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = q[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
  }
  // Gaussian elimination
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [B[c], B[p]] = [B[p], B[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c || !A[c][c]) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      B[r] -= f * B[c];
    }
  }
  return B.map((b, i) => b / A[i][i]);
}

/**
 * Cut a (possibly tilted) text box out of an RGBA image, straightened and scaled to height `outH`, as a CHW float tensor
 * normalized to [-1, 1] (the recognizer's input). Each output pixel averages up to 4x4 source samples so large text
 * shrinks cleanly.
 * @param {{data:Uint8ClampedArray|Uint8Array, width:number, height:number}} img
 * @param {number[][]} q quad [tl, tr, br, bl]
 * @param {number} [outH]
 * @param {number} [maxW]
 * @returns {{data:Float32Array, width:number, height:number}|null}
 */
export function cropForRecognition(img, q, outH = 48, maxW = 1600) {
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const qw = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  const qh = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  if (qw < 2 || qh < 2) return null;
  const W = Math.max(16, Math.min(maxW, Math.ceil((outH * qw) / qh)));
  const [a, b, c, d, e, f, g, hh] = homography(q, W, outH);
  const k = Math.max(1, Math.min(4, Math.round(qh / outH)));
  const out = new Float32Array(3 * outH * W);
  const { data, width, height } = img;
  const plane = outH * W;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, gg = 0, bl = 0;
      for (let sy = 0; sy < k; sy++) {
        for (let sx = 0; sx < k; sx++) {
          const X = x + (sx + 0.5) / k;
          const Y = y + (sy + 0.5) / k;
          const den = g * X + hh * Y + 1;
          let u = (a * X + b * Y + c) / den - 0.5;
          let v = (d * X + e * Y + f) / den - 0.5;
          u = Math.min(width - 1, Math.max(0, u));
          v = Math.min(height - 1, Math.max(0, v));
          const x0 = Math.floor(u), y0 = Math.floor(v);
          const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
          const fx = u - x0, fy = v - y0;
          const i00 = (y0 * width + x0) * 4, i10 = (y0 * width + x1) * 4, i01 = (y1 * width + x0) * 4, i11 = (y1 * width + x1) * 4;
          const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
          r += data[i00] * w00 + data[i10] * w10 + data[i01] * w01 + data[i11] * w11;
          gg += data[i00 + 1] * w00 + data[i10 + 1] * w10 + data[i01 + 1] * w01 + data[i11 + 1] * w11;
          bl += data[i00 + 2] * w00 + data[i10 + 2] * w10 + data[i01 + 2] * w01 + data[i11 + 2] * w11;
        }
      }
      const n = k * k * 127.5;
      const o = y * W + x;
      out[o] = r / n - 1;
      out[plane + o] = gg / n - 1;
      out[2 * plane + o] = bl / n - 1;
    }
  }
  return { data: out, width: W, height: outH };
}

/**
 * Greedy CTC decode of recognizer output [T x C]: best class per step, collapse repeats, drop blanks (class 0).
 * @param {Float32Array} probs
 * @param {number} T
 * @param {number} C
 * @param {string[]} keys index -> character; keys[0] is the blank
 * @returns {{text:string, conf:number}}
 */
export function ctcDecode(probs, T, C, keys) {
  let text = '';
  let sum = 0;
  let n = 0;
  let prev = 0;
  for (let t = 0; t < T; t++) {
    let best = 0;
    let bv = -Infinity;
    for (let c = 0; c < C; c++) { const v = probs[t * C + c]; if (v > bv) { bv = v; best = c; } }
    if (best !== prev && best !== 0) { text += keys[best] || ''; sum += bv; n++; }
    prev = best;
  }
  return { text, conf: n ? sum / n : 0 };
}

/**
 * Put recognized words back into text lines, top to bottom. Each line is followed along its own slope, so words on a
 * tilted or curved row stay together and the "%" column stays with its nutrient.
 * @param {Array<{q:number[][], text:string}>} items
 * @returns {string}
 */
export function toLines(items) {
  const rows = [];
  for (const { q, text } of [...items].sort((a, b) => a.q[0][0] - b.q[0][0])) {
    const [tl, tr, br, bl] = q;
    const midL = (tl[1] + bl[1]) / 2;
    const hgt = (Math.hypot(bl[0] - tl[0], bl[1] - tl[1]) + Math.hypot(br[0] - tr[0], br[1] - tr[1])) / 2;
    const slope = ((tr[1] + br[1]) - (tl[1] + bl[1])) / 2 / Math.max(1, tr[0] - tl[0]);
    let best = null;
    for (const r of rows) {
      const pred = r.ey + r.slope * (tl[0] - r.ex);
      const off = Math.abs(midL - pred);
      if (off < 0.5 * Math.min(r.eh, hgt) && tl[0] > r.minx - 5 && (!best || off < best.off)) best = { off, r };
    }
    const end = { ex: (tr[0] + br[0]) / 2, ey: (tr[1] + br[1]) / 2, eh: hgt };
    if (best) {
      const r = best.r;
      r.parts.push(text);
      Object.assign(r, end, { slope: 0.5 * r.slope + 0.5 * slope });
    } else rows.push({ parts: [text], ...end, slope, minx: tl[0], y: (tl[1] + bl[1] + tr[1] + br[1]) / 4 });
  }
  rows.sort((a, b) => a.y - b.y);
  return rows.map((r) => r.parts.join(' ')).join('\n');
}
