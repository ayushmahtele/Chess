// Session: who is signed in, where their data lives, and account helpers.
import { localStore } from './local.js';

const env = import.meta.env;
const EMU = env.VITE_USE_EMULATOR === '1';
const config = env.VITE_FIREBASE_API_KEY ? {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
} : EMU ? { apiKey: 'demo-key', authDomain: 'demo-chess.firebaseapp.com', projectId: 'demo-chess', appId: 'demo' } : null;

export const cloudEnabled = !!config;
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export const cleanUsername = s => (s || '').trim().toLowerCase().replace(/^@/, '');

const state = { user: null, store: localStore, fb: null, db: null, ready: false };
const listeners = new Set();
const emit = () => listeners.forEach(f => f(state));
let fbMod = null;

export function onSession(cb) { listeners.add(cb); if (state.ready) cb(state); return () => listeners.delete(cb); }
export function session() { return state; }

export async function initSession() {
  if (!config) { state.ready = true; emit(); return; }
  try {
    fbMod = await import('./firebase.js');
    const makeFake = EMU ? (await import('./db-fake.js')).createFakeDb : null;
    state.fb = fbMod.createFirebase(config, makeFake);
    state.db = state.fb.db;
    state.fb.onUser(user => {
      const changedUser = state.user?.uid !== user?.uid;
      state.user = user;
      state.store = user ? fbMod.cloudStore(user, state.db) : localStore;
      state.ready = true;
      if (user && changedUser) state.db.calibrate(user.uid);
      emit();
    });
  } catch (e) {
    console.error('Firebase failed to start; using guest mode.', e);
    state.ready = true; emit();
  }
}

const need = () => { if (!state.fb) throw new Error('Online accounts are not set up on this site yet.'); return state.fb; };
export const friendlyError = e => fbMod ? fbMod.friendlyError(e) : (e?.message || String(e));
export const signInGoogle = () => need().signInGoogle();
export const signInUsername = (u, pw) => need().signInUsername(cleanUsername(u), pw);
export async function signUpUsername(u, pw) {
  u = cleanUsername(u);
  if (!USERNAME_RE.test(u)) throw new Error('Usernames are 3–20 characters: letters, numbers and _ only.');
  if (await usernameOwner(u)) throw new Error('That username is already taken.');
  return need().signUpUsername(u, pw);
}
export const linkGoogle = () => need().linkGoogle();
export const addPassword = (u, pw) => need().addPassword(cleanUsername(u), pw);
export const changePassword = (cur, pw) => need().changePassword(cur, pw);
export const signOut = () => state.fb ? state.fb.signOut() : null;

/** uid that owns a username, or null */
export async function usernameOwner(u) {
  if (!state.db) return null;
  const d = await state.db.get(`usernames/${cleanUsername(u)}`);
  return d?.uid || null;
}

/** Create the profile of a signed-in user and reserve their username in one step. */
export async function createCloudProfile(profile) {
  const { user, db } = state;
  const u = cleanUsername(profile.username);
  if (!USERNAME_RE.test(u)) throw new Error('Usernames are 3–20 characters: letters, numbers and _ only.');
  await db.tx(async t => {
    const taken = await t.get(`usernames/${u}`);
    if (taken && taken.uid !== user.uid) throw new Error('That username is already taken.');
    if (!taken) t.set(`usernames/${u}`, { uid: user.uid, createdAt: Date.now() });
    t.set(`users/${user.uid}`, { ...profile, username: u });
  });
}

/** Give an existing profile a username (for accounts made before usernames existed). */
export async function claimUsername(name) {
  const { user, db } = state;
  const u = cleanUsername(name);
  if (!USERNAME_RE.test(u)) throw new Error('Usernames are 3–20 characters: letters, numbers and _ only.');
  await db.tx(async t => {
    const taken = await t.get(`usernames/${u}`);
    if (taken && taken.uid !== user.uid) throw new Error('That username is already taken.');
    const p = await t.get(`users/${user.uid}`);
    if (!taken) t.set(`usernames/${u}`, { uid: user.uid, createdAt: Date.now() });
    t.update(`users/${user.uid}`, { username: u });
    void p;
  });
}
