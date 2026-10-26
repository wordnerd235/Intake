// ui.js - DOM helpers: h(), esc(), icon(), form controls. Overlays (sheet/toast/confirm/menu) live in overlay.js and are re-exported.
import { iconSvg } from './icons.js';
import { parseAmount, formatQty, rangeProblem } from './units.js';

export { toast, clearToast, sheet, confirmDialog as confirm, choiceDialog as choice, menu, closeAllOverlays, hasOverlay } from './overlay.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'g', 'path', 'circle', 'line', 'rect', 'text', 'polyline', 'polygon', 'defs', 'linearGradient', 'stop', 'title', 'clipPath']);

/**
 * Escape text for use inside HTML. Use for any untrusted string that must go through innerHTML.
 * @param {*} s
 * @returns {string}
 */
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' })[c]);
}

/**
 * Element builder. Children are appended as text nodes (never parsed as HTML).
 * attrs: class, style (object|string), dataset, on<event> handlers, boolean props, anything else becomes an attribute.
 * @param {string} tag
 * @param {Object|null} [attrs]
 * @param {...*} children Node | string | number | array | null
 * @returns {HTMLElement|SVGElement}
 */
export function h(tag, attrs, ...children) {
  const isSvg = SVG_TAGS.has(tag);
  const el = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

/** Append strings/numbers as text, nodes as-is, arrays recursively; null/false/undefined skipped. */
export function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
  return el;
}

/** Replace all children of el. */
export function mount(el, ...children) {
  el.textContent = '';
  return append(el, children);
}

/**
 * Inline icon element.
 * @param {string} name
 * @param {number} [size]
 * @returns {HTMLElement}
 */
export function icon(name, size = 22) {
  const s = document.createElement('span');
  s.className = 'ic-wrap';
  s.innerHTML = iconSvg(name, size); // constant markup from icons.js, no user data
  return s;
}

/** Icon-only button with an accessible label. */
export function iconButton(name, label, onClick, cls = '') {
  return h('button', { type: 'button', class: ['icon-btn', cls], 'aria-label': label, title: label, onclick: onClick }, icon(name, 20));
}

/** Text button. variant: primary | secondary | ghost | danger */
export function button(label, onClick, { variant = 'secondary', icon: ic1, ic: ic2, cls = '', type = 'button', disabled = false } = {}) {
  const ic = ic1 || ic2; // `ic` is accepted as a short alias
  return h('button', { type, class: ['btn', `btn-${variant}`, cls], onclick: onClick, disabled }, ic ? icon(ic, 18) : null, h('span', null, label));
}

let uid = 0;
/** Unique DOM id for label/for wiring. */
export const nextId = (p = 'f') => `${p}${++uid}`;

/**
 * Labeled form field wrapper.
 * @param {string} label
 * @param {HTMLElement} control
 * @param {string} [hint]
 * @returns {HTMLElement}
 */
export function field(label, control, hint) {
  const id = control.id || (control.id = nextId());
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, hint ? h('div', { class: 'hint' }, hint) : null);
}

/** <select> from [{value,label}] */
export function select(options, value, onChange, attrs = {}) {
  const el = h('select', { class: 'input', ...attrs }, options.map((o) => h('option', { value: String(o.value), selected: String(o.value) === String(value) }, o.label)));
  if (onChange) el.addEventListener('change', () => onChange(el.value));
  return el;
}

/**
 * Segmented control (radio-like buttons).
 * @param {Array<{value:string,label:string}>} options
 * @param {string} value
 * @param {(v:string)=>void} onChange
 * @param {string} label accessible name
 */
export function segmented(options, value, onChange, label = '') {
  const wrap = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
  const draw = (cur) => {
    mount(
      wrap,
      options.map((o) =>
        h('button', { type: 'button', role: 'radio', 'aria-checked': String(o.value === cur), class: o.value === cur ? 'on' : '', onclick: () => { draw(o.value); onChange(o.value); } }, o.label),
      ),
    );
  };
  draw(value);
  return wrap;
}

/**
 * Numeric text input that accepts "1/2", "1 1/2", ".5". Never yields NaN: get() is a number or null.
 * @param {{value?:number|null, placeholder?:string, label?:string, onChange?:(n:number|null)=>void, allowZero?:boolean, max?:number, id?:string, dp?:number, unit?:string, inputmode?:string}} o
 * @returns {{el:HTMLElement, input:HTMLInputElement, get:()=>number|null, set:(n:number|null)=>void, raw:()=>string}}
 */
export function numInput(o = {}) {
  const input = h('input', {
    type: 'text', class: 'input num', inputmode: o.inputmode || 'decimal', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    placeholder: o.placeholder || '', 'aria-label': o.label || null, id: o.id || null, enterkeyhint: 'done',
  });
  const fmt = (n) => (n == null ? '' : formatQty(Math.round(n * 10 ** (o.dp ?? 2)) / 10 ** (o.dp ?? 2)));
  input.value = fmt(o.value);
  const get = () => {
    const raw = input.value.trim();
    if (!raw) return null;
    const n = parseAmount(raw);
    if (n == null || (!o.allowZero && n === 0)) return null;
    if (o.max != null && n > o.max) return null; // outside the allowed range counts as not a usable number
    if (o.min != null && n < o.min) return null;
    return n;
  };
  /** '' when the box is empty or fine; otherwise the plain-words reason (names the limit that was broken). */
  const problem = () => {
    const raw = input.value.trim();
    if (!raw) return '';
    return rangeProblem(parseAmount(raw), { label: o.name || o.label, unit: o.unit, min: o.min, max: o.max, allowZero: o.allowZero, raw });
  };
  const check = () => {
    const bad = input.value.trim() !== '' && get() == null;
    input.classList.toggle('invalid', bad);
    input.setAttribute('aria-invalid', String(bad));
    return get();
  };
  input.addEventListener('input', () => o.onChange && o.onChange(check()));
  input.addEventListener('blur', check);
  const el = o.unit ? h('div', { class: 'input-unit' }, input, h('span', { class: 'unit' }, o.unit)) : input;
  return {
    el, input, get, problem,
    raw: () => input.value,
    set(n) { input.value = fmt(n); check(); },
  };
}

/** Section heading inside a card/page. */
export const heading = (text, ...right) => h('div', { class: 'sect-head' }, h('h2', null, text), right.length ? h('div', { class: 'sect-right' }, right) : null);

/** Friendly empty state. */
export function emptyState(title, text, action) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, title), text ? h('p', null, text) : null, action || null);
}

/** Spinner element. */
export const spinner = (label = 'Loading') => h('span', { class: 'spinner', role: 'status', 'aria-label': label });

/** Trigger a file download from text. */
export function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Debounce helper. */
export function debounce(fn, ms) {
  let t;
  const d = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

/**
 * Coalesce rapid redraw requests into one per animation frame.
 * @param {()=>void} fn
 */
export function rafOnce(fn) {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn();
    });
  };
}
