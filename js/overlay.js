// overlay.js - sheets/modals (focus trap, Esc, browser Back), confirm dialogs, toasts, popover menus.
// Every sheet pushes one history entry so the phone's Back button closes it instead of leaving the app.

const stack = [];
let ignorePops = 0;
let lastFocus = null;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function root() {
  let el = document.getElementById('overlays');
  if (!el) {
    el = document.createElement('div');
    el.id = 'overlays';
    document.body.appendChild(el);
  }
  return el;
}

const mk = (tag, cls, attrs = {}) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

/** @returns {boolean} true while any sheet/dialog/menu is open */
export const hasOverlay = () => stack.length > 0;

function removeEntry(entry) {
  const i = stack.indexOf(entry);
  if (i < 0) return false;
  stack.splice(i, 1);
  return true;
}

function finish(entry, { fromPop }) {
  if (!removeEntry(entry)) return;
  entry.el.classList.add('closing');
  const done = () => {
    entry.el.remove();
    if (!stack.length) document.documentElement.classList.remove('has-overlay');
    const target = entry.opener && document.contains(entry.opener) ? entry.opener : lastFocus;
    if (!stack.length && target && target.focus) target.focus({ preventScroll: true });
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) done();
  else setTimeout(done, 160);
  if (entry.history && !fromPop) {
    ignorePops++;
    history.back();
  }
  entry.needsPush = false;
  if (entry.onClose) entry.onClose();
}

/** Give sheets opened while a programmatic Back was still pending their own history entry. */
function flushPendingPushes() {
  for (const e of stack) {
    if (e.needsPush) {
      e.needsPush = false;
      e.history = true;
      history.pushState({ overlay: true }, '');
    }
  }
}

window.addEventListener('popstate', () => {
  if (ignorePops > 0) {
    ignorePops--;
    if (ignorePops === 0) flushPendingPushes();
    return;
  }
  const top = [...stack].reverse().find((e) => e.history);
  if (top) finish(top, { fromPop: true });
  else if (stack.length) closeAllOverlays();
  else if (history.state && history.state.overlay) history.back(); // a stale entry left by a sheet that was closed by navigation
});

document.addEventListener('keydown', (e) => {
  if (!stack.length) return;
  const top = stack[stack.length - 1];
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    top.close();
    return;
  }
  if (e.key === 'Tab' && top.trap) {
    const items = [...top.el.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !top.el.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});

/**
 * Close every open overlay (route changes). History is left alone: the route has already moved on, so the overlays'
 * leftover back-stack entries are skipped later by the popstate handler.
 */
export function closeAllOverlays() {
  const all = [...stack];
  for (const e of all.reverse()) {
    removeEntry(e);
    e.el.remove();
    e.needsPush = false;
    if (e.onClose) e.onClose();
  }
  document.documentElement.classList.remove('has-overlay');
}

/**
 * Open a sheet (bottom sheet / full-screen on phones, centered modal on desktop).
 * @param {{title?:string, content?:Node|Node[], footer?:Node|null, size?:'sm'|'md'|'lg'|'full', onClose?:()=>void, back?:boolean, ariaLabel?:string, headerExtra?:Node|null}} o
 * @returns {{el:HTMLElement, body:HTMLElement, footer:HTMLElement, close:()=>void, setTitle:(t:string)=>void}}
 */
export function sheet(o = {}) {
  lastFocus = lastFocus || document.activeElement;
  const opener = document.activeElement;
  const titleId = `sh-t${Math.random().toString(36).slice(2, 8)}`;
  const scrim = mk('div', 'scrim');
  const panel = mk('div', `sheet sheet-${o.size || 'md'}`, { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId });
  const title = mk('h2', 'sheet-title', { id: titleId });
  title.textContent = o.title || '';
  const closeBtn = mk('button', 'icon-btn sheet-close', { type: 'button', 'aria-label': 'Close' });
  closeBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const head = mk('header', 'sheet-head');
  head.append(title);
  if (o.headerExtra) head.append(o.headerExtra);
  head.append(closeBtn);
  const body = mk('div', 'sheet-body');
  const footer = mk('footer', 'sheet-foot');
  if (o.content) body.append(...[].concat(o.content).filter(Boolean));
  if (o.footer) footer.append(o.footer);
  else footer.hidden = true;
  panel.append(head, body, footer);
  scrim.append(panel);
  root().append(scrim);
  document.documentElement.classList.add('has-overlay');

  const entry = { el: scrim, trap: true, history: false, needsPush: false, onClose: o.onClose, opener, close: () => finish(entry, { fromPop: false }) };
  stack.push(entry);
  if (ignorePops > 0) entry.needsPush = true; // a Back is still in flight; pushing now would be undone by it
  else {
    entry.history = true;
    history.pushState({ overlay: true }, '');
  }
  closeBtn.addEventListener('click', entry.close);
  scrim.addEventListener('mousedown', (e) => {
    if (e.target === scrim) entry.close();
  });
  requestAnimationFrame(() => {
    if (panel.contains(document.activeElement)) return; // the person (or a script) already focused a field: do not steal it back
    const target = panel.querySelector('[autofocus]') || body.querySelector(FOCUSABLE) || closeBtn;
    target.focus({ preventScroll: true });
  });
  return {
    el: panel, body, footer, close: entry.close,
    setTitle: (t) => { title.textContent = t; },
    showFooter: (node) => { footer.textContent = ''; if (node) { footer.append(node); footer.hidden = false; } else footer.hidden = true; },
  };
}

/**
 * Confirm dialog. Resolves true/false.
 * @param {{title:string, message?:string, confirmLabel?:string, cancelLabel?:string, danger?:boolean}} o
 * @returns {Promise<boolean>}
 */
export function confirmDialog(o) {
  return new Promise((resolve) => {
    let answer = false;
    const ok = mk('button', `btn ${o.danger ? 'btn-danger' : 'btn-primary'}`, { type: 'button' });
    ok.textContent = o.confirmLabel || 'OK';
    const cancel = mk('button', 'btn btn-secondary', { type: 'button' });
    cancel.textContent = o.cancelLabel || 'Cancel';
    const msg = mk('p', 'confirm-msg');
    msg.textContent = o.message || '';
    const foot = mk('div', 'btn-row');
    foot.append(cancel, ok);
    const s = sheet({ title: o.title, size: 'sm', content: msg, footer: foot, onClose: () => resolve(answer) });
    cancel.addEventListener('click', () => s.close());
    ok.addEventListener('click', () => {
      answer = true;
      s.close();
    });
    s.el.classList.add('dialog');
    requestAnimationFrame(() => cancel.focus());
  });
}

/**
 * Dialog with several answers (Cancel is always offered). Resolves to the chosen `value`, or null when cancelled.
 * @param {{title:string, message?:string, choices:Array<{label:string, value:string, danger?:boolean}>}} o the last choice is the primary button
 * @returns {Promise<string|null>}
 */
export function choiceDialog(o) {
  return new Promise((resolve) => {
    let answer = null;
    const msg = mk('p', 'confirm-msg');
    msg.textContent = o.message || '';
    const foot = mk('div', 'btn-row');
    const cancel = mk('button', 'btn btn-secondary', { type: 'button' });
    cancel.textContent = 'Cancel';
    foot.append(cancel);
    const s = sheet({ title: o.title, size: 'sm', content: msg, footer: foot, onClose: () => resolve(answer) });
    cancel.addEventListener('click', () => s.close());
    o.choices.forEach((c, i) => {
      const b = mk('button', `btn ${c.danger ? 'btn-danger' : i === o.choices.length - 1 ? 'btn-primary' : 'btn-secondary'}`, { type: 'button' });
      b.textContent = c.label;
      b.addEventListener('click', () => { answer = c.value; s.close(); });
      foot.append(b);
    });
    s.el.classList.add('dialog');
    requestAnimationFrame(() => cancel.focus());
  });
}

let toastTimer = null;
let toastAt = 0;
/**
 * Show a toast (one at a time). Optional action button, e.g. Undo.
 * @param {string} msg
 * @param {{action?:string, onAction?:()=>void, ms?:number}} [o]
 */
export function toast(msg, o = {}) {
  let host = document.getElementById('toasts');
  if (!host) {
    host = mk('div', 'toasts', { id: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  host.textContent = '';
  clearTimeout(toastTimer);
  const t = mk('div', 'toast');
  const span = mk('span', 'toast-msg');
  span.textContent = msg;
  t.append(span);
  const dismiss = () => {
    t.classList.add('closing');
    setTimeout(() => t.remove(), 160);
  };
  if (o.action) {
    const b = mk('button', 'toast-action', { type: 'button' });
    b.textContent = o.action;
    b.addEventListener('click', () => {
      dismiss();
      if (o.onAction) o.onAction();
    });
    t.append(b);
  }
  host.append(t);
  toastAt = Date.now();
  toastTimer = setTimeout(dismiss, o.ms || (o.action ? 5000 : 3200));
  return { dismiss };
}

/**
 * Remove the current toast (a toast belongs to the screen it was raised on, so the router clears it on navigation).
 * @param {number} [keepFreshMs] leave a toast alone if it appeared less than this long ago (a toast raised just before a redirect)
 */
export function clearToast(keepFreshMs = 0) {
  if (Date.now() - toastAt < keepFreshMs) return;
  clearTimeout(toastTimer);
  const host = document.getElementById('toasts');
  if (host) host.textContent = '';
}

/**
 * Popover menu anchored to an element.
 * @param {HTMLElement} anchor
 * @param {Array<{label:string, onClick:()=>void, danger?:boolean, disabled?:boolean}|'-'>} items
 */
export function menu(anchor, items) {
  const wrap = mk('div', 'menu-scrim');
  const list = mk('div', 'menu', { role: 'menu' });
  for (const it of items) {
    if (it === '-') {
      list.append(mk('div', 'menu-sep', { role: 'separator' }));
      continue;
    }
    const b = mk('button', `menu-item${it.danger ? ' danger' : ''}`, { type: 'button', role: 'menuitem' });
    if (it.disabled) b.disabled = true;
    b.textContent = it.label;
    b.addEventListener('click', () => {
      entry.close();
      it.onClick();
    });
    list.append(b);
  }
  wrap.append(list);
  root().append(wrap);
  const r = anchor.getBoundingClientRect();
  const w = list.offsetWidth;
  const hgt = list.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
  const top = r.bottom + 6 + hgt > window.innerHeight - 8 ? Math.max(8, r.top - hgt - 6) : r.bottom + 6;
  list.style.left = `${left}px`;
  list.style.top = `${top}px`;
  const entry = { el: wrap, trap: false, history: false, opener: anchor, close: () => finish(entry, { fromPop: false }) };
  stack.push(entry);
  wrap.addEventListener('mousedown', (e) => {
    if (e.target === wrap) entry.close();
  });
  list.addEventListener('keydown', (e) => {
    const els = [...list.querySelectorAll('.menu-item:not(:disabled)')];
    const i = els.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); els[(i + 1) % els.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); els[(i - 1 + els.length) % els.length].focus(); }
  });
  const first = list.querySelector('.menu-item:not(:disabled)');
  if (first) first.focus({ preventScroll: true });
  return entry;
}
