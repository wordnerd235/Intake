"""Tiny in-page stand-ins for the Firebase v13 modular SDK (app, auth, firestore).
They implement only what js/firebase-backend.js calls, backed by globalThis.__fb, so the sync UI and engine can be driven without a network."""

STATE = "const S = (globalThis.__fb ||= { users: {}, current: null, authCbs: [], docs: {}, snaps: [], clock: 1000, n: 0 });"

APP = "export function initializeApp(config) { return { config }; }\n"

AUTH = STATE + """
const user = () => (S.current ? { uid: S.current.uid, email: S.current.email, displayName: null } : null);
const emit = () => { for (const cb of S.authCbs) setTimeout(() => cb(user()), 0); };
const fail = (code) => Object.assign(new Error(code), { code });
export function getAuth() { return {}; }
export function onAuthStateChanged(auth, cb) { S.authCbs.push(cb); setTimeout(() => cb(user()), 0); return () => { S.authCbs = S.authCbs.filter((x) => x !== cb); }; }
export async function createUserWithEmailAndPassword(auth, email, pw) {
  if (pw.length < 6) throw fail('auth/weak-password');
  if (S.users[email]) throw fail('auth/email-already-in-use');
  S.current = S.users[email] = { uid: 'u' + (++S.n), email, pw }; emit();
}
export async function signInWithEmailAndPassword(auth, email, pw) {
  const u = S.users[email];
  if (!u || u.pw !== pw) throw fail('auth/invalid-credential');
  S.current = u; emit();
}
export async function sendPasswordResetEmail(auth, email) { if (!email.includes('@')) throw fail('auth/invalid-email'); S.resets = (S.resets || 0) + 1; }
export async function signOut() { S.current = null; emit(); }
export class GoogleAuthProvider {}
export async function signInWithPopup() { S.current = S.users['g@example.com'] ||= { uid: 'u' + (++S.n), email: 'g@example.com', pw: '' }; emit(); }
export async function signInWithRedirect() {}
export async function getRedirectResult() {
  const code = globalThis.__fbRedirectError; // set by a test to simulate a Google redirect that came back with an error
  if (code) { globalThis.__fbRedirectError = null; const e = new Error(code); e.code = code; throw e; }
  return null;
}
"""

FIRESTORE = STATE + """
const SENTINEL = { sentinel: true };
export const Timestamp = { fromMillis: (ms) => ({ ms, toMillis() { return ms; } }) };
export function initializeFirestore() { return {}; }
export function memoryLocalCache() { return {}; }
export function serverTimestamp() { return SENTINEL; }
export function doc(db, ...p) { return { path: p.join('/'), id: p[p.length - 1], col: p.slice(0, -1).join('/') }; }
export function collection(db, ...p) { return { path: p.join('/') }; }
export function where(field, op, v) { return { since: v.toMillis() }; }
export function orderBy() { return {}; }
export function query(col, ...c) { return { col: col.path, since: (c.find((x) => x.since !== undefined) || { since: 0 }).since }; }
const snapshot = (entries) => ({ docChanges: () => entries.map(([id, d]) => ({ type: 'added', doc: { id, data: () => d, metadata: { hasPendingWrites: false } } })) });
export async function runTransaction(db, fn) {
  if (S.offline) throw new Error('Failed to get document because the client is offline.');
  const tx = {
    get: async (ref) => { const d = S.docs[ref.path]; return { exists: () => !!d, data: () => d }; },
    set: (ref, data) => {
      const d = { ...data, serverUpdatedAt: Timestamp.fromMillis(++S.clock) };
      S.docs[ref.path] = d;
      for (const l of S.snaps) if (l.col === ref.col) setTimeout(() => l.next(snapshot([[ref.id, d]])), 0);
    },
  };
  await fn(tx);
}
export function onSnapshot(q, next) {
  const l = { col: q.col, next };
  S.snaps.push(l);
  const depth = q.col.split('/').length + 1;
  const entries = Object.entries(S.docs).filter(([p, d]) => p.startsWith(q.col + '/') && p.split('/').length === depth && d.serverUpdatedAt.toMillis() >= q.since).map(([p, d]) => [p.split('/').pop(), d]);
  setTimeout(() => next(snapshot(entries)), 0);
  return () => { S.snaps = S.snaps.filter((x) => x !== l); };
}
"""

MODULES = {"firebase-app.js": APP, "firebase-auth.js": AUTH, "firebase-firestore.js": FIRESTORE}
CONFIG = "export const firebaseConfig = { apiKey: 'fake', authDomain: 'fake.example', projectId: 'fake', appId: 'fake' };\n"
