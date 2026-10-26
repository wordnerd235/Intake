// cloud.js - optional sync glue: loads Firebase lazily (only when firebase-config.js has a config), tracks the signed-in user
// and runs the SyncEngine. Everything degrades to "Off" / "Offline" without breaking the local app.
import { firebaseConfig } from './firebase-config.js';
import { bus } from './bus.js';
import { store } from './store.js';
import { SyncEngine, AccountDecisionNeeded, FirebaseBackend } from './sync.js';
import { statusText } from './sync-core.js';
import { formatClock } from './dates.js';
import { friendlyAuthError } from './firebase-backend.js';
import { h, sheet, button, toast } from './ui.js';

export const cloud = {
  configured: !!firebaseConfig,
  user: null,
  backend: null,
  engine: null,
  loading: false,
  sdkError: null,
  decisionOpen: false,
  /** Message from a Google sign-in redirect that failed, shown on the Account screen until the next attempt. */
  authNotice: null,

  /** Status for the UI: fields for statusText plus the rendered text. */
  status() {
    const e = this.engine ? this.engine.status() : null;
    const s = {
      configured: this.configured, signedIn: !!this.user, state: e ? e.state : 'idle', pending: e ? e.pending : 0,
      lastSynced: e ? e.lastSynced : null, error: e ? e.error : null, online: navigator.onLine !== false,
    };
    if (this.configured && !this.backend) {
      s.text = this.loading ? 'Connecting…' : this.sdkError ? 'Offline (cloud unavailable)' : 'Signed out';
    } else s.text = statusText(s, formatClock);
    return { ...s, user: this.user };
  },
  emit() {
    bus.emit('cloud:status', this.status());
  },

  /** Load the SDK and wire auth -> sync. Safe to call repeatedly. */
  async init() {
    if (!this.configured || this.backend || this.loading) return;
    this.loading = true;
    this.sdkError = null;
    this.emit();
    try {
      this.backend = await FirebaseBackend.create(firebaseConfig, {
        onRedirectError: (e) => {
          this.authNotice = friendlyAuthError(e);
          if (this.authNotice) toast(this.authNotice, { ms: 8000 });
          this.emit();
        },
      });
    } catch (e) {
      this.sdkError = e;
      this.loading = false;
      this.emit();
      window.addEventListener('online', () => this.init(), { once: true });
      return;
    }
    this.loading = false;
    this.engine = new SyncEngine({ store, backend: this.backend, bus });
    bus.on('sync:status', () => this.emit());
    window.addEventListener('online', () => this.engine.onlineChange(true));
    window.addEventListener('offline', () => this.engine.onlineChange(false));
    this.backend.onAuthChange(async (user) => {
      this.user = user;
      this.emit();
      if (!user) { this.engine.detach(); this.emit(); return; }
      this.backend.setUser(user.uid);
      try {
        await this.engine.attach(user.uid);
      } catch (e) {
        if (e instanceof AccountDecisionNeeded) await this.askDecision(user);
        else toast(`Sync problem: ${e.message}`, { ms: 6000 });
      }
      this.emit();
    });
  },

  /** A different account signed in over existing local data. */
  askDecision(user) {
    if (this.decisionOpen) return Promise.resolve();
    this.decisionOpen = true;
    return new Promise((resolve) => {
      let chosen = false;
      const pick = (strategy) => async () => {
        chosen = true;
        s.close();
        try { await this.engine.attach(user.uid, { strategy }); } catch (e) { toast(`Sync problem: ${e.message}`, { ms: 6000 }); }
        this.emit();
      };
      const s = sheet({
        title: 'Use this account on this device?', size: 'sm',
        content: [h('p', null, `You signed in as ${user.email || 'a different account'}, but this device holds data from another account or from before you signed in.`), h('p', { class: 'muted' }, 'Merge adds this device\'s data to the account. Erase removes this device\'s data first so you start from the account\'s data only.')],
        footer: h('div', { class: 'btn-stack' }, button('Merge this device\'s data into this account', pick('merge'), { variant: 'primary' }), button('Erase this device\'s data first', pick('erase'), { variant: 'secondary' }), button('Cancel and sign out', () => s.close(), { variant: 'ghost' })),
        onClose: async () => {
          this.decisionOpen = false;
          if (!chosen) await this.signOut({ removeData: false });
          resolve();
        },
      });
    });
  },

  async signUp(email, password) { return this._auth(() => this.backend.signUp(email, password)); },
  async signIn(email, password) { return this._auth(() => this.backend.signIn(email, password)); },
  async signInGoogle() { return this._auth(() => this.backend.signInGoogle()); },
  async resetPassword(email) { return this._auth(() => this.backend.resetPassword(email)); },
  /** Run an auth call; resolve to an error message string or null. */
  async _auth(fn) {
    this.authNotice = null;
    if (!this.backend) return 'Sync is not available right now. Check your connection and try again.';
    try {
      await fn();
      return null;
    } catch (e) {
      return friendlyAuthError(e);
    }
  },

  /**
   * Sign out. Local data stays unless removeData.
   * @param {{removeData?:boolean}} [o]
   */
  async signOut({ removeData = false } = {}) {
    if (this.engine) this.engine.detach();
    if (this.backend) await this.backend.signOut();
    if (removeData) await store.eraseAll();
    this.user = null;
    this.emit();
  },

  async syncNow() {
    if (this.engine && this.user) await this.engine.flush();
    this.emit();
  },
};
