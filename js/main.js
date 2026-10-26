// main.js - app entry: open the local database, apply the theme, build the navigation chrome, start the router.
import { h, icon, button, toast, clearToast } from './ui.js';
import { store, initStore } from './store.js';
import { createIdbAdapter, createMemoryAdapter } from './db.js';
import { startRouter, NAV, parseHash, go } from './router.js';
import { applyTheme } from './theme.js';
import { appFlags, getDate, refreshToday } from './state.js';
import { mealForClock } from './dates.js';
import { bus } from './bus.js';
import { cloud } from './cloud.js';
import { startTabSync } from './tabsync.js';
import { APP_VERSION } from './version.js';

const FAB_ROUTES = new Set(['today', 'diary']);

async function openStore() {
  try {
    initStore(createIdbAdapter());
    await store.ready();
    return null;
  } catch (e) {
    console.warn('IndexedDB unavailable, using temporary memory', e);
    initStore(createMemoryAdapter());
    await store.ready();
    return e;
  }
}

async function addFood() {
  const { openAddFood } = await import('./views/add-food.js');
  openAddFood({ date: getDate(), meal: mealForClock() });
}

function buildChrome(app) {
  const links = (cls) => NAV.map((n) => h('a', { href: `#/${n.name}`, class: cls, 'data-nav': n.name }, icon(n.icon, 22), h('span', null, n.label)));
  const status = h('div', { class: 'side-status', id: 'side-status' });
  const sidebar = h('aside', { class: 'sidebar' },
    h('a', { class: 'brand', href: '#/today', 'aria-label': 'Intake, go to Today' }, h('span', { class: 'brand-mark' }, 'Intake')),
    h('nav', { 'aria-label': 'Primary', class: 'side-nav' }, links('side-link')),
    button('Add food', addFood, { variant: 'primary', icon: 'plus', cls: 'side-add' }),
    status);
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Primary' }, links('tab'));
  const fab = h('button', { type: 'button', class: 'fab', 'aria-label': 'Add food', title: 'Add food', onclick: addFood }, icon('plus', 26));
  const outlet = h('main', { id: 'main', class: 'outlet', tabindex: '-1' });
  const banner = h('div', { class: 'banners', id: 'banners' });
  app.replaceChildren(h('a', { class: 'skip-link', href: '#main', onclick: (e) => { e.preventDefault(); outlet.focus(); } }, 'Skip to content'), sidebar, h('div', { class: 'stage' }, banner, outlet), tabbar, fab);
  const syncStatus = () => { status.textContent = cloud.configured ? cloud.status().text : 'Saved on this device'; };
  syncStatus();
  bus.on('cloud:status', syncStatus);
  return { outlet, banner, fab };
}

function registerServiceWorker(banner) {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  let wantReload = false;
  const offer = (worker) => {
    if (banner.querySelector('.update-bar')) return;
    banner.append(h('div', { class: 'update-bar', role: 'status' }, h('span', null, 'Update available'),
      button('Reload', () => { wantReload = true; worker.postMessage({ type: 'SKIP_WAITING' }); }, { variant: 'primary', cls: 'btn-sm' })));
  };
  // The first install also fires controllerchange (clients.claim); only reload once the person asked for an update.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (wantReload) location.reload();
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
    // Look for a new version when the app returns to the foreground.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch((e) => console.warn('Service worker not registered', e));
}

let freshTimer = 0;

async function start() {
  const app = document.getElementById('app');
  const storageError = await openStore();
  const settings = await store.getSettings();
  appFlags.onboarded = !!settings.onboarded;
  applyTheme(settings.theme);
  const { outlet, banner, fab } = buildChrome(app);

  if (storageError) {
    banner.append(h('div', { class: 'notice warn', role: 'alert' }, icon('alert', 18),
      h('span', null, 'Your browser is blocking local storage (private browsing, or storage turned off). Intake works, but nothing you log will be kept after you close this tab.')));
  }

  bus.on('change:settings', async () => {
    const s = await store.getSettings();
    appFlags.onboarded = !!s.onboarded;
    applyTheme(s.theme);
    const route = parseHash(location.hash).name;
    if (s.onboarded && route === 'onboarding') go('#/today');
    else if (!s.onboarded && route !== 'onboarding' && route !== 'account') go('#/onboarding'); // e.g. this device was erased for another account
  });

  startTabSync(bus); // a change in another open tab redraws this one

  startRouter({
    outlet,
    gate: (route) => {
      if (!appFlags.onboarded && route.name !== 'onboarding' && route.name !== 'account') return '#/onboarding';
      if (appFlags.onboarded && route.name === 'onboarding') return '#/today';
      return null;
    },
    onRoute: (route) => {
      clearToast(800); // a toast raised just before this redirect stays; an older one belongs to the previous screen
      outlet.dataset.fresh = ''; // lets the ring play its wind-up once per navigation
      clearTimeout(freshTimer);
      freshTimer = setTimeout(() => delete outlet.dataset.fresh, 1200);
      app.dataset.route = route.name;
      app.dataset.chrome = route.name === 'onboarding' ? 'off' : 'on';
      fab.hidden = !FAB_ROUTES.has(route.name);
      for (const a of app.querySelectorAll('[data-nav]')) {
        if (a.dataset.nav === route.nav) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      }
    },
  });

  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshToday(); });
  setInterval(() => { if (!document.hidden) refreshToday(); }, 60000);
  window.addEventListener('offline', () => toast('You are offline. Everything still works, and changes sync later.'));
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  registerServiceWorker(banner);
  if (cloud.configured) setTimeout(() => cloud.init(), 200);
  document.documentElement.dataset.version = APP_VERSION;
}

start().catch((e) => {
  console.error(e);
  const app = document.getElementById('app');
  if (app) app.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'empty' }, h('div', { class: 'empty-title' }, 'Intake could not start'), h('p', null, 'Reload the page. If this keeps happening, try another browser; your data is not deleted by this error.'))));
});
