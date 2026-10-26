// charts.js - small SVG charts: ring, line (dots + trend + goal), bars (+ target line), sparkline.
// Styling lives in css/components.css via the ch-* classes, so themes just work.
import { h } from './ui.js';
import { diffDays, addDays, formatShort } from './dates.js';

const r1 = (n) => Math.round(n * 10) / 10;

/** Pick "nice" axis ticks covering [min,max]. */
export function niceTicks(min, max, count = 4) {
  if (!(max > min)) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(r1(v * 100) / 100);
  return { ticks, lo, hi };
}

/**
 * Instrument-style calorie ring: tick marks around a thin arc, with a marker at the current level.
 * @param {{value:number, max:number, over?:boolean, size?:number, ariaLabel?:string}} o
 */
export function ring({ value, max, over = false, size = 168, ariaLabel = '' }) {
  const c = size / 2;
  const rad = c - 14;
  const frac = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const circ = 2 * Math.PI * rad;
  const ticks = [];
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * 2 * Math.PI - Math.PI / 2;
    const major = i % 5 === 0;
    const r2 = c - 3;
    const r3 = r2 - (major ? 6 : 3);
    ticks.push(h('line', { x1: r1(c + Math.cos(a) * r2), y1: r1(c + Math.sin(a) * r2), x2: r1(c + Math.cos(a) * r3), y2: r1(c + Math.sin(a) * r3), style: `--i:${i}`, class: `ch-tick${major ? ' major' : ''}${i / 60 <= frac && frac > 0 ? ' on' : ''}${over ? ' over' : ''}` }));
  }
  const endA = frac * 2 * Math.PI - Math.PI / 2;
  const svg = h('svg', { class: 'ring', width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': ariaLabel },
    ...ticks,
    h('circle', { cx: c, cy: c, r: rad - 6, class: 'ch-track' }),
    h('circle', { cx: c, cy: c, r: rad - 6, class: `ch-arc${over ? ' over' : ''}`, 'stroke-dasharray': `${r1(frac * 2 * Math.PI * (rad - 6))} ${r1(circ)}`, transform: `rotate(-90 ${c} ${c})` }),
    frac > 0 ? h('circle', { cx: r1(c + Math.cos(endA) * (rad - 6)), cy: r1(c + Math.sin(endA) * (rad - 6)), r: 4.5, class: `ch-knob${over ? ' over' : ''}` }) : null,
  );
  return svg;
}

/**
 * Tiny trend line.
 * @param {number[]} values
 * @param {{width?:number, height?:number, label?:string}} [o]
 */
export function sparkline(values, { width = 120, height = 36, label = 'Trend' } = {}) {
  const vals = values.filter((v) => Number.isFinite(v));
  if (vals.length < 2) return h('svg', { class: 'spark', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${label}: not enough data` });
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const pad = 4;
  const span = max - min || 1;
  const pts = vals.map((v, i) => [pad + (i / (vals.length - 1)) * (width - pad * 2), pad + (1 - (v - min) / span) * (height - pad * 2)]);
  const last = pts[pts.length - 1];
  return h('svg', { class: 'spark', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${label}: ${r1(vals[0])} to ${r1(vals[vals.length - 1])}` },
    h('polyline', { points: pts.map((p) => p.map(r1).join(',')).join(' '), class: 'ch-trend', fill: 'none' }),
    h('circle', { cx: r1(last[0]), cy: r1(last[1]), r: 3, class: 'ch-knob' }),
  );
}

/**
 * Weight chart: weigh-in dots, trend line, dashed goal line, labelled axes.
 * @param {{from:string, to:string, points:Array<{date:string,v:number}>, trend:Array<{date:string,v:number}>, goal?:number|null, unit:string, width:number, height?:number}} o
 */
export function lineChart({ from, to, points, trend, goal = null, unit, width, height = 220 }) {
  const m = { l: 40, r: 12, t: 10, b: 24 };
  const w = Math.max(200, width);
  const iw = w - m.l - m.r;
  const ih = height - m.t - m.b;
  const days = Math.max(1, diffDays(from, to));
  const all = [...points.map((p) => p.v), ...trend.map((p) => p.v), ...(goal != null ? [goal] : [])].filter(Number.isFinite);
  if (!all.length) return h('svg', { width: w, height, viewBox: `0 0 ${w} ${height}`, role: 'img', 'aria-label': 'No weight data' });
  const { ticks, lo, hi } = niceTicks(Math.min(...all), Math.max(...all), 4);
  const X = (d) => m.l + (diffDays(from, d) / days) * iw;
  const Y = (v) => m.t + (1 - (v - lo) / (hi - lo || 1)) * ih;
  const xl = [];
  const nx = w < 420 ? 3 : 5;
  for (let i = 0; i <= nx; i++) {
    const d = addDays(from, Math.round((days * i) / nx));
    xl.push(h('text', { x: r1(X(d)), y: height - 6, class: 'ch-label', 'text-anchor': i === 0 ? 'start' : i === nx ? 'end' : 'middle' }, formatShort(d, to)));
  }
  const inRange = (d) => d >= from && d <= to;
  const tr = trend.filter((p) => inRange(p.date));
  return h('svg', { class: 'chart', width: w, height, viewBox: `0 0 ${w} ${height}`, role: 'img', 'aria-label': `Weight chart in ${unit}, ${points.length} weigh-ins` },
    ...ticks.map((t) => h('g', null, h('line', { x1: m.l, x2: w - m.r, y1: r1(Y(t)), y2: r1(Y(t)), class: 'ch-grid' }), h('text', { x: m.l - 6, y: r1(Y(t)) + 4, class: 'ch-label', 'text-anchor': 'end' }, String(t)))),
    goal != null ? h('line', { x1: m.l, x2: w - m.r, y1: r1(Y(goal)), y2: r1(Y(goal)), class: 'ch-goal' }) : null,
    goal != null ? h('text', { x: w - m.r, y: r1(Y(goal)) - 4, class: 'ch-label goal', 'text-anchor': 'end' }, `Goal ${r1(goal)}`) : null,
    tr.length > 1 ? h('polyline', { class: 'ch-trend', fill: 'none', points: tr.map((p) => `${r1(X(p.date))},${r1(Y(p.v))}`).join(' ') }) : null,
    ...points.filter((p) => inRange(p.date)).map((p) => h('circle', { cx: r1(X(p.date)), cy: r1(Y(p.v)), r: 3, class: 'ch-dot' }, h('title', null, `${formatShort(p.date, to)}: ${r1(p.v)} ${unit}`))),
    ...xl,
  );
}

/**
 * Bar chart with an optional horizontal target line. Bars with no value are left blank.
 * @param {{bars:Array<{label:string, value:number|null, title?:string}>, target?:number|null, width:number, height?:number, unit?:string, name?:string, color?:string, overIsBad?:boolean}} o
 */
export function barChart({ bars, target = null, width, height = 180, unit = '', name = 'Chart', overIsBad = false }) {
  const m = { l: 40, r: 8, t: 10, b: 24 };
  const w = Math.max(200, width);
  const iw = w - m.l - m.r;
  const ih = height - m.t - m.b;
  const vals = bars.map((b) => b.value).filter((v) => v != null && Number.isFinite(v));
  if (!vals.length) return h('svg', { width: w, height, viewBox: `0 0 ${w} ${height}`, role: 'img', 'aria-label': `${name}: no data` });
  const { ticks, hi } = niceTicks(0, Math.max(...vals, target || 0), 4);
  const Y = (v) => m.t + (1 - v / (hi || 1)) * ih;
  const slot = iw / bars.length;
  const bw = Math.max(1.5, Math.min(26, slot * 0.7));
  const every = Math.ceil(bars.length / (w < 420 ? 5 : 8));
  return h('svg', { class: 'chart', width: w, height, viewBox: `0 0 ${w} ${height}`, role: 'img', 'aria-label': `${name}: ${vals.length} days with data` },
    ...ticks.map((t) => h('g', null, h('line', { x1: m.l, x2: w - m.r, y1: r1(Y(t)), y2: r1(Y(t)), class: 'ch-grid' }), h('text', { x: m.l - 6, y: r1(Y(t)) + 4, class: 'ch-label', 'text-anchor': 'end' }, t >= 1000 ? `${t / 1000}k` : String(t)))),
    ...bars.map((b, i) => {
      if (b.value == null || !Number.isFinite(b.value)) return null;
      const x = m.l + slot * i + (slot - bw) / 2;
      const bad = overIsBad && target != null && b.value > target;
      return h('rect', { x: r1(x), y: r1(Y(b.value)), width: r1(bw), height: r1(Math.max(1, m.t + ih - Y(b.value))), rx: Math.min(3, bw / 3), class: `ch-bar${bad ? ' over' : ''}` }, h('title', null, b.title || `${b.label}: ${Math.round(b.value)} ${unit}`));
    }),
    target != null ? h('line', { x1: m.l, x2: w - m.r, y1: r1(Y(target)), y2: r1(Y(target)), class: 'ch-goal' }) : null,
    ...bars.map((b, i) => (i % every === 0 ? h('text', { x: r1(m.l + slot * i + slot / 2), y: height - 6, class: 'ch-label', 'text-anchor': 'middle' }, b.label) : null)),
  );
}

/**
 * Draw a chart into `host` at the host's width, redrawing when it resizes.
 * @param {HTMLElement} host
 * @param {(width:number)=>Node} draw
 * @returns {()=>void} stop observing
 */
export function autoChart(host, draw) {
  let last = 0;
  const paint = () => {
    const w = Math.floor(host.clientWidth);
    if (!w || Math.abs(w - last) < 2) return;
    last = w;
    host.textContent = '';
    host.append(draw(w));
  };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => requestAnimationFrame(paint)) : null;
  if (ro) ro.observe(host);
  requestAnimationFrame(paint);
  return () => ro && ro.disconnect();
}
