import { test } from 'node:test';
import assert from 'node:assert/strict';
import { friendlyAuthError } from '../../js/firebase-backend.js';
import { isIosStandalone } from '../../js/platform.js';

test('friendlyAuthError: known codes get plain sentences, cancellations stay silent', () => {
  assert.match(friendlyAuthError({ code: 'auth/invalid-credential' }), /incorrect/);
  assert.match(friendlyAuthError({ code: 'auth/unauthorized-domain' }), /Authorized domains/);
  assert.match(friendlyAuthError({ code: 'auth/web-storage-unsupported' }), /email and password/);
  assert.match(friendlyAuthError({ code: 'auth/account-exists-with-different-credential' }), /different sign-in method/);
  assert.equal(friendlyAuthError({ code: 'auth/popup-closed-by-user' }), null);
  assert.equal(friendlyAuthError({ code: 'auth/cancelled-popup-request' }), null);
  assert.match(friendlyAuthError({}), /Something went wrong/);
});

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
test('isIosStandalone: only the installed iOS app, not Safari tabs or other platforms', () => {
  assert.equal(isIosStandalone({ userAgent: IPHONE, standalone: true }), true);
  assert.equal(isIosStandalone({ userAgent: IPHONE, standalone: false }), false);
  assert.equal(isIosStandalone({ userAgent: IPHONE }, () => ({ matches: true })), true);
  assert.equal(isIosStandalone({ userAgent: IPHONE }, () => ({ matches: false })), false);
  assert.equal(isIosStandalone({ userAgent: 'Mozilla/5.0 (Linux; Android 14)', standalone: true }), false);
  assert.equal(isIosStandalone({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5, standalone: true }), true, 'iPadOS reports as a Mac');
  assert.equal(isIosStandalone({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0, standalone: true }), false, 'a real Mac');
  assert.equal(isIosStandalone(null), false);
});
