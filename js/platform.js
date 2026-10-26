// platform.js - small, pure checks about where the app is running.

/**
 * True when the app runs as an installed iOS home-screen app (Safari's "Add to Home Screen").
 * Google sign-in popups and redirects are unreliable there, so the Account screen points to email and password.
 * @param {{userAgent?:string, platform?:string, maxTouchPoints?:number, standalone?:boolean}} nav navigator-like
 * @param {(q:string)=>{matches:boolean}} [matchMedia]
 * @returns {boolean}
 */
export function isIosStandalone(nav, matchMedia) {
  if (!nav) return false;
  const ua = String(nav.userAgent || '');
  const ios = /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints || 0) > 1); // iPadOS reports a Mac
  if (!ios) return false;
  const display = typeof matchMedia === 'function' ? !!matchMedia('(display-mode: standalone)').matches : false;
  return nav.standalone === true || display;
}
