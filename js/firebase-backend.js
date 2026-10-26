// firebase-backend.js - the ONLY place that talks to the Firebase SDK (besides firebase-config.js).
// The SDK is dynamically imported from gstatic.com when sync is configured; nothing here runs at load time.
// Firebase JS SDK 13.1.0 modular API: initializeApp, getAuth, onAuthStateChanged, signInWith*, initializeFirestore, memoryLocalCache, writeBatch, onSnapshot...

export const FIREBASE_VERSION = '13.1.0';
const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;
const PUSH_TIMEOUT_MS = 20000;

/**
 * Turn a Firebase auth error into a sentence a person can act on. Returns null for user-cancelled flows.
 * @param {{code?:string, message?:string}} e
 * @returns {string|null}
 */
export function friendlyAuthError(e) {
  const code = (e && e.code) || '';
  const map = {
    'auth/invalid-email': "That email address doesn't look right.",
    'auth/missing-email': 'Enter your email address.',
    'auth/missing-password': 'Enter your password.',
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/wrong-password': 'Email or password is incorrect.',
    'auth/user-not-found': 'Email or password is incorrect.',
    'auth/email-already-in-use': 'An account with this email already exists. Try signing in instead.',
    'auth/weak-password': 'Choose a password with at least 6 characters.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/network-request-failed': 'No connection. Check your network and try again.',
    'auth/unauthorized-domain': "This site's address isn't authorized in Firebase (Authentication > Settings > Authorized domains).",
    'auth/operation-not-allowed': "This sign-in method isn't enabled in the Firebase console (Authentication > Sign-in method).",
    'auth/user-disabled': 'This account has been disabled.',
    'auth/account-exists-with-different-credential': 'An account with this email already exists with a different sign-in method. Sign in with your email and password, or with the method you used before.',
    'auth/web-storage-unsupported': 'This browser blocks the storage that Google sign-in needs. Use your email and password instead.',
    'auth/popup-blocked': 'The browser blocked the sign-in window. Allow pop-ups for this site, or use your email and password.',
    'auth/internal-error': 'Sign-in failed inside the browser. Try your email and password instead.',
  };
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' || code === 'auth/user-cancelled') return null;
  return map[code] || (e && e.message) || 'Something went wrong. Try again.';
}

const withTimeout = (p, ms, msg) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

/** Firestore + Auth wrapper implementing the SyncEngine backend interface. */
export class FirebaseBackend {
  constructor(parts) {
    Object.assign(this, parts);
    this.uid = null;
    this.unsubs = [];
  }

  /**
   * Load the SDK and initialise. Rejects when offline / CDN blocked, so callers can degrade.
   * @param {Object} config Firebase web config
   * @param {{onRedirectError?:(e:Error)=>void}} [o] called when a Google sign-in that went through a redirect comes back with an error
   * @returns {Promise<FirebaseBackend>}
   */
  static async create(config, o = {}) {
    const [appM, authM, fsM] = await Promise.all([
      import(`${CDN}firebase-app.js`),
      import(`${CDN}firebase-auth.js`),
      import(`${CDN}firebase-firestore.js`),
    ]);
    const app = appM.initializeApp(config);
    const auth = authM.getAuth(app);
    // Our IndexedDB is the source of truth, so Firestore keeps only the default in-memory cache.
    const db = fsM.initializeFirestore(app, { localCache: fsM.memoryLocalCache(), ignoreUndefinedProperties: true });
    const be = new FirebaseBackend({ app, auth, db, authM, fsM });
    // Completes a signInWithRedirect fallback; onAuthStateChanged does the rest. A failure here must reach the person, not vanish.
    authM.getRedirectResult(auth).catch((e) => { if (o.onRedirectError) o.onRedirectError(e); });
    return be;
  }

  // ---- auth ----
  /** @param {(u:{uid:string,email:string|null,name:string|null}|null)=>void} cb @returns {()=>void} */
  onAuthChange(cb) {
    return this.authM.onAuthStateChanged(this.auth, (u) => cb(u ? { uid: u.uid, email: u.email, name: u.displayName } : null));
  }
  async signUp(email, password) {
    await this.authM.createUserWithEmailAndPassword(this.auth, email, password);
  }
  async signIn(email, password) {
    await this.authM.signInWithEmailAndPassword(this.auth, email, password);
  }
  async resetPassword(email) {
    await this.authM.sendPasswordResetEmail(this.auth, email);
  }
  /** Google sign-in: popup first, redirect if the popup is blocked or unsupported. */
  async signInGoogle() {
    const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = this.authM;
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(this.auth, provider);
    } catch (e) {
      if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) {
        await signInWithRedirect(this.auth, provider);
        return;
      }
      throw e;
    }
  }
  async signOut() {
    this.unsubscribeAll();
    await this.authM.signOut(this.auth);
  }

  // ---- sync backend ----
  setUser(uid) {
    this.uid = uid;
  }
  /**
   * Push records. One transaction per batch (<= 400 docs) so a copy in the cloud that is already as new
   * or newer is never overwritten by a stale offline edit (last-write-wins on `updatedAt`).
   * Transactions also fail fast when offline instead of queueing silently.
   * @param {string} collection
   * @param {Object[]} records
   */
  async push(collection, records) {
    if (!this.uid) throw new Error('Not signed in');
    const { runTransaction, doc, serverTimestamp } = this.fsM;
    const usable = records.filter((r) => typeof r.id === 'string' && r.id && !r.id.includes('/'));
    const refs = usable.map((r) => doc(this.db, 'users', this.uid, collection, r.id));
    await withTimeout(
      runTransaction(this.db, async (tx) => {
        const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
        snaps.forEach((snap, i) => {
          const cur = snap.exists() ? snap.data() : null;
          if (cur && typeof cur.updatedAt === 'number' && cur.updatedAt >= usable[i].updatedAt) return;
          tx.set(refs[i], { ...usable[i], serverUpdatedAt: serverTimestamp() });
        });
      }),
      PUSH_TIMEOUT_MS,
      'Timed out while saving to the cloud',
    );
  }
  /**
   * Realtime listener for docs with serverUpdatedAt >= since (inclusive; the engine is idempotent).
   * @returns {()=>void}
   */
  subscribe(collection, since, onDocs, onErr) {
    const { collection: col, query, where, orderBy, onSnapshot, Timestamp } = this.fsM;
    const q = query(col(this.db, 'users', this.uid, collection), where('serverUpdatedAt', '>=', Timestamp.fromMillis(since || 0)), orderBy('serverUpdatedAt'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const docs = [];
        snap.docChanges().forEach((ch) => {
          if (ch.type === 'removed' || ch.doc.metadata.hasPendingWrites) return;
          const data = ch.doc.data();
          if (!data.serverUpdatedAt || typeof data.serverUpdatedAt.toMillis !== 'function') return;
          docs.push({ ...data, id: ch.doc.id, serverUpdatedAt: data.serverUpdatedAt.toMillis() });
        });
        onDocs(docs);
      },
      (err) => onErr && onErr(err),
    );
    this.unsubs.push(unsub);
    return unsub;
  }
  unsubscribeAll() {
    for (const u of this.unsubs.splice(0)) {
      try {
        u();
      } catch {
        /* already closed */
      }
    }
  }
}
