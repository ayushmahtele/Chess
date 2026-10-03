// Google + username/password sign-in (Firebase Auth) and cloud storage.
import { initializeApp } from 'firebase/app';
import {
  getAuth, initializeAuth, inMemoryPersistence, browserPopupRedirectResolver, connectAuthEmulator,
  GoogleAuthProvider, EmailAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, linkWithPopup, linkWithCredential,
  updatePassword, reauthenticateWithCredential, reauthenticateWithPopup, signOut, onAuthStateChanged,
  signInWithCredential, getAdditionalUserInfo, deleteUser,
} from 'firebase/auth';
import { createFirestoreDb } from './db-firestore.js';

const EMU = import.meta.env.VITE_USE_EMULATOR === '1';

/** Username accounts use a hidden internal email: <username>@<project>.firebaseapp.com */
export const usernameEmail = (cfg, u) => `${u.toLowerCase()}@${cfg.projectId}.firebaseapp.com`;

const FRIENDLY = {
  'auth/invalid-credential': 'Wrong username or password.',
  'auth/wrong-password': 'Wrong username or password.',
  'auth/user-not-found': 'No account with that username.',
  'auth/invalid-email': 'That username is not valid.',
  'auth/email-already-in-use': 'That username is already taken.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
  'auth/popup-closed-by-user': 'Google sign-in was closed before finishing.',
  'auth/cancelled-popup-request': 'Google sign-in was closed before finishing.',
  'auth/credential-already-in-use': 'That Google account already has its own Chess Throne account. Sign out and sign in with Google to use it, or link a different Google account.',
  'auth/provider-already-linked': 'A Google account is already linked.',
  'auth/requires-recent-login': 'For your security, sign out and sign in again, then retry. (Linking your Google account avoids this.)',
  'auth/popup-blocked': 'Your browser blocked the Google window. Allow pop-ups for this site and try again.',
  'auth/unauthorized-domain': 'This website address is not authorised in Firebase yet (Authentication → Settings → Authorized domains).',
  'auth/operation-not-allowed': 'This sign-in method is not enabled in the Firebase console.',
  'auth/network-request-failed': 'Network error. Check your internet connection.',
};
export const friendlyError = e => FRIENDLY[e?.code] || e?.message || String(e);

export function createFirebase(config, makeFakeDb) {
  const app = initializeApp(config);
  const auth = EMU
    ? initializeAuth(app, { persistence: inMemoryPersistence, popupRedirectResolver: browserPopupRedirectResolver })
    : getAuth(app);
  if (EMU) connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = EMU ? makeFakeDb() : createFirestoreDb(app);
  const google = () => { const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' }); return p; };
  const suffix = '@' + config.projectId + '.firebaseapp.com';

  const describe = u => {
    if (!u) return null;
    const providers = u.providerData.map(p => p.providerId);
    const g = u.providerData.find(p => p.providerId === 'google.com');
    const pw = u.providerData.find(p => p.providerId === 'password');
    return {
      uid: u.uid, providers,
      name: g?.displayName || u.displayName || null,
      email: g?.email || null,
      photo: g?.photoURL || u.photoURL || null,
      passwordUsername: pw?.email?.endsWith(suffix) ? pw.email.slice(0, -suffix.length) : null,
    };
  };
  let listener = null;
  getRedirectResult(auth).catch(() => {});
  if (EMU) {
    // Test-only: the Auth emulator accepts fake Google tokens, so tests don't need Google's popup.
    const fake = (email, name) => GoogleAuthProvider.credential(JSON.stringify({ sub: 'g-' + email, email, email_verified: true, name }));
    window.__emuGoogle = {
      signIn: (email, name) => signInWithCredential(auth, fake(email, name)),
      link: async (email, name) => { await linkWithCredential(auth.currentUser, fake(email, name)); listener?.(describe(auth.currentUser)); },
    };
  }

  return {
    db,
    onUser(cb) { listener = cb; return onAuthStateChanged(auth, u => cb(describe(u))); },
    async refresh() { if (auth.currentUser) { await auth.currentUser.reload(); listener?.(describe(auth.currentUser)); } },
    async signInGoogle() {
      try { await signInWithPopup(auth, google()); }
      catch (e) {
        if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') return signInWithRedirect(auth, google());
        throw e;
      }
    },
    signInUsername: (u, pw) => signInWithEmailAndPassword(auth, usernameEmail(config, u), pw),
    signUpUsername: (u, pw) => createUserWithEmailAndPassword(auth, usernameEmail(config, u), pw),
    /** New account = the Gmail the player picks + a username and password linked to it. One Gmail, one account. */
    async signUpWithGmail(u, pw, hasProfile) {
      const res = EMU && window.__emuGoogleEmail
        ? await signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: 'g-' + window.__emuGoogleEmail, email: window.__emuGoogleEmail, email_verified: true, name: 'Test User' })))
        : await signInWithPopup(auth, google());
      const user = res.user, d = describe(user);
      const isNew = getAdditionalUserInfo(res)?.isNewUser;
      if (d.passwordUsername || (!isNew && await hasProfile(user.uid))) {
        await signOut(auth);
        throw Object.assign(new Error(d.passwordUsername
          ? `${d.email || 'This Gmail'} already belongs to @${d.passwordUsername}. Each Gmail can have only one account. Use "Continue with Google" on the Sign in tab.`
          : `${d.email || 'This Gmail'} already has a Chess Throne account. Each Gmail can have only one account. Use "Continue with Google" on the Sign in tab.`), { code: 'gmail-used' });
      }
      try { await linkWithCredential(user, EmailAuthProvider.credential(usernameEmail(config, u), pw)); }
      catch (e) {
        try { await deleteUser(user); } catch { await signOut(auth); }        // never leave a half-made account behind
        if (e.code === 'auth/email-already-in-use' || e.code === 'auth/credential-already-in-use') throw Object.assign(new Error('That username was just taken. Please choose another.'), { code: e.code });
        throw e;
      }
      await this.refresh();
    },
    async linkGoogle() { await linkWithPopup(auth.currentUser, google()); await this.refresh(); },
    async addPassword(u, pw) { await linkWithCredential(auth.currentUser, EmailAuthProvider.credential(usernameEmail(config, u), pw)); await this.refresh(); },
    /** No old password needed. If Firebase wants a fresh sign-in, confirm with the linked Google account. */
    async changePassword(newPw) {
      const u = auth.currentUser;
      try { await updatePassword(u, newPw); }
      catch (e) {
        if (e.code !== 'auth/requires-recent-login' || !u.providerData.some(p => p.providerId === 'google.com')) throw e;
        await reauthenticateWithPopup(u, google());
        await updatePassword(u, newPw);
      }
    },
    /** Cancel an unfinished sign-up: remove the sign-in account (nothing else was saved yet). */
    async deleteCurrentUser() { const u = auth.currentUser; if (!u) return; try { await deleteUser(u); } catch { await signOut(auth); } },
    signOut: () => signOut(auth),
    idToken: () => auth.currentUser.getIdToken(),
  };
}

/** Profile + game storage for a signed-in user, on top of the db wrapper. */
export function cloudStore(user, db) {
  const base = `users/${user.uid}`;
  const strip = d => { if (!d) return d; const { id, ...rest } = d; return rest; };
  return {
    kind: 'cloud',
    async getProfile() { return strip(await db.get(base)); },
    saveProfile: p => db.set(base, p),
    addGame: g => db.add(`${base}/games`, g),
    listGames: () => db.list(`${base}/games`, { orderBy: ['endedAt', 'desc'], limit: 500 }),
    getGame: id => db.get(`${base}/games/${id}`),
    deleteGame: id => db.del(`${base}/games/${id}`),
    async deleteAllGames() { const gs = await db.list(`${base}/games`, {}); await db.delMany(gs.map(g => `${base}/games/${g.id}`)); },
    async deleteAccountData() {
      const p = await this.getProfile();
      await this.deleteAllGames();
      if (p?.username) { try { await db.del(`usernames/${p.username}`); } catch {} }
      await db.del(base);
    },
  };
}
