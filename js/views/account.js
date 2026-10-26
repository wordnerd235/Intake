// views/account.js - Account & sync: status, sign in / up / out (email + Google), reset password, sync now.
import { h, icon, field, button, toast, confirm } from '../ui.js';
import { bus } from '../bus.js';
import { cloud } from '../cloud.js';
import { card, notice } from '../components.js';
import { formatClock } from '../dates.js';
import { isIosStandalone } from '../platform.js';

/** @param {HTMLElement} root */
export async function mount(root) {
  const host = h('div', { class: 'page' });
  root.append(host);
  let mode = 'in'; // 'in' | 'up'
  let busy = false;

  const draw = () => {
    const s = cloud.status();
    const back = h('a', { href: '#/more', class: 'back-link' }, icon('chevL', 16), 'More');
    const head = h('header', { class: 'page-head' }, h('div', null, back, h('h1', null, 'Account and sync')));
    if (!s.configured) {
      host.replaceChildren(head, card(null, [notice('Sync is off. Intake works fully on this device without an account.', 'info'), h('p', null, 'To sync between your phone and computer, set up a free Firebase project and paste its config into js/firebase-config.js. The README walks through it step by step.')]));
      return;
    }
    if (s.signedIn) {
      mode = 'in'; // the next sign-in form starts in sign-in mode
      host.replaceChildren(head, card(null, [
        h('div', { class: 'acct' }, icon('user', 28), h('div', null, h('strong', null, s.user.email || s.user.name || 'Signed in'), h('div', { class: 'muted small' }, 'Your diary syncs to this account.'))),
        h('dl', { class: 'ledger wide' },
          h('div', null, h('dt', null, 'Status'), h('dd', null, s.text)),
          h('div', null, h('dt', null, 'Last synced'), h('dd', { class: 'num' }, s.lastSynced ? formatClock(s.lastSynced) : '—')),
          h('div', null, h('dt', null, 'Waiting to upload'), h('dd', { class: 'num' }, String(s.pending)))),
        s.state === 'error' ? notice(`Sync hit a problem: ${s.error}. Intake retries automatically.`, 'warn') : null,
        h('div', { class: 'btn-row left wrap' },
          button('Sync now', async () => { await cloud.syncNow(); toast('Sync complete'); }, { variant: 'primary', icon: 'refresh' }),
          button('Sign out', () => cloud.signOut(), { variant: 'secondary' }),
          button('Sign out and remove data from this device', async () => {
            if (!(await confirm({ title: 'Remove data from this device?', message: 'You will be signed out and this device\'s diary will be erased. Your data stays in your account and comes back when you sign in again.', confirmLabel: 'Sign out and remove', danger: true }))) return;
            await cloud.signOut({ removeData: true });
            toast('Signed out and removed local data');
          }, { variant: 'ghost', cls: 'danger-text' })),
      ]));
      return;
    }
    const email = h('input', { class: 'input', id: 'ac-email', type: 'email', autocomplete: 'email', inputmode: 'email', autocapitalize: 'off' });
    const pass = h('input', { class: 'input', id: 'ac-pass', type: 'password', autocomplete: mode === 'up' ? 'new-password' : 'current-password' });
    const err = h('div', { class: 'field-error', role: 'alert' });
    const submit = async (e) => {
      e.preventDefault();
      if (busy) return;
      err.textContent = '';
      if (!email.value.trim() || !pass.value) { err.textContent = 'Enter your email and password.'; return; }
      busy = true;
      const msg = await (mode === 'up' ? cloud.signUp(email.value.trim(), pass.value) : cloud.signIn(email.value.trim(), pass.value));
      busy = false;
      if (msg) err.textContent = msg; else toast(mode === 'up' ? 'Account created' : 'Signed in');
    };
    if (cloud.authNotice) err.textContent = cloud.authNotice;
    const iosApp = isIosStandalone(navigator, window.matchMedia && window.matchMedia.bind(window));
    const form = h('form', { class: 'stack', onsubmit: submit, novalidate: true },
      field('Email', email), field('Password', pass, mode === 'up' ? 'At least 6 characters.' : null), err,
      h('div', { class: 'btn-row left wrap' },
        h('button', { type: 'submit', class: 'btn btn-primary' }, h('span', null, mode === 'up' ? 'Create account' : 'Sign in')),
        mode === 'in' ? button('Forgot password', async () => {
          if (!email.value.trim()) { err.textContent = 'Enter your email first, then tap Forgot password.'; email.focus(); return; }
          const msg = await cloud.resetPassword(email.value.trim());
          if (msg) err.textContent = msg; else toast('Password reset email sent');
        }, { variant: 'ghost' }) : null),
      h('p', { class: 'muted small' }, mode === 'in' ? 'New here? ' : 'Already have an account? ', h('button', { type: 'button', class: 'link-btn', onclick: () => { mode = mode === 'in' ? 'up' : 'in'; draw(); } }, mode === 'in' ? 'Create an account' : 'Sign in')),
      h('div', { class: 'or-rule', role: 'separator' }, h('span', null, 'or')),
      button('Continue with Google', async () => { err.textContent = ''; const msg = await cloud.signInGoogle(); if (msg) err.textContent = msg; }, { variant: 'secondary' }),
      iosApp ? h('p', { class: 'muted small', id: 'ac-ios-note' }, 'Google sign-in may not work in the installed app — use email & password (one account works on all devices)') : null);
    host.replaceChildren(head, card(s.text === 'Offline (cloud unavailable)' ? null : 'Sign in to sync', [
      cloud.sdkError ? notice("Couldn't load the sync service. Check your connection; Intake keeps working locally.", 'warn', button('Retry', () => cloud.init(), { variant: 'ghost' })) : null,
      h('p', { class: 'muted' }, 'Sync keeps this device and your other devices up to date. Your data is stored in your own account and nobody else can read it.'),
      form]));
  };
  // Redraw only when what is on screen changes: a signed-out form must not be wiped while someone types in it.
  const viewKey = () => { const s = cloud.status(); return s.signedIn ? `in|${s.text}|${s.pending}|${s.error}` : `out|${s.configured}|${!!cloud.sdkError}|${cloud.loading}|${cloud.authNotice || ''}`; };
  let shown = viewKey();
  draw();
  const off = bus.on('cloud:status', () => { const k = viewKey(); if (k !== shown) { shown = k; draw(); } });
  cloud.init();
  return () => off();
}
