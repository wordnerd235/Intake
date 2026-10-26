// router.js - hash router. Routes: #/today  #/diary[/YYYY-MM-DD]  #/progress  #/foods[/tab]  #/more  #/account  #/onboarding
import { closeAllOverlays } from './overlay.js';
import { isValid } from './dates.js';
import { setDate } from './state.js';

/** Tab / sidebar navigation entries. */
export const NAV = [
  { name: 'today', label: 'Today', icon: 'today' },
  { name: 'diary', label: 'Diary', icon: 'diary' },
  { name: 'progress', label: 'Progress', icon: 'progress' },
  { name: 'foods', label: 'Foods', icon: 'foods' },
  { name: 'more', label: 'More', icon: 'more' },
];

const LOADERS = {
  today: () => import('./views/today.js'),
  diary: () => import('./views/diary.js'),
  progress: () => import('./views/progress.js'),
  foods: () => import('./views/foods.js'),
  more: () => import('./views/settings.js'),
  account: () => import('./views/account.js'),
  onboarding: () => import('./views/onboarding.js'),
};
const TITLES = { today: 'Today', diary: 'Diary', progress: 'Progress', foods: 'Foods', more: 'More', account: 'Account & sync', onboarding: 'Welcome' };
const NAV_FOR = { account: 'more' };

/**
 * Parse a location hash into {name, params}.
 * @param {string} hash e.g. "#/diary/2026-10-23"
 */
export function parseHash(hash) {
  const parts = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  const name = LOADERS[parts[0]] ? parts[0] : 'today';
  return { name, params: parts.slice(1).map(decodeURIComponent) };
}

/**
 * Navigate by changing the hash (re-renders if it is already the current hash).
 * @param {string} to e.g. "#/diary"
 */
export function go(to) {
  if (location.hash === to) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = to;
}

/**
 * Start the router.
 * @param {{outlet:HTMLElement, gate?:(route:{name:string})=>string|null, onRoute?:(route:Object)=>void}} o
 *   gate may return a hash to redirect to (onboarding).
 */
export function startRouter({ outlet, gate, onRoute }) {
  let cleanup = null;
  let seq = 0;
  async function render() {
    const my = ++seq;
    const route = parseHash(location.hash);
    const redirect = gate && gate(route);
    if (redirect && redirect !== location.hash) {
      location.replace(redirect);
      return;
    }
    if (route.name === 'diary' && route.params[0] && isValid(route.params[0])) setDate(route.params[0]);
    closeAllOverlays();
    if (cleanup) {
      try { cleanup(); } catch (e) { console.error(e); }
      cleanup = null;
    }
    outlet.textContent = '';
    outlet.dataset.route = route.name;
    document.title = `${TITLES[route.name]} · Intake`;
    if (onRoute) onRoute({ ...route, nav: NAV_FOR[route.name] || route.name });
    try {
      const mod = await LOADERS[route.name]();
      if (my !== seq) return;
      const res = await mod.mount(outlet, route);
      if (my !== seq) {
        if (typeof res === 'function') res();
        return;
      }
      cleanup = typeof res === 'function' ? res : null;
      window.scrollTo(0, 0);
    } catch (e) {
      console.error(e);
      if (my === seq) {
        outlet.textContent = '';
        const box = document.createElement('div');
        box.className = 'empty';
        box.innerHTML = '<div class="empty-title">This screen could not load</div><p>Reload the page. If it keeps happening, your data is safe on this device; export a backup from More.</p>';
        outlet.append(box);
      }
    }
  }
  window.addEventListener('hashchange', render);
  render();
  return { render };
}
