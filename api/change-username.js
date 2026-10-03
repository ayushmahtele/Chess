// Change a player's username (Profile → Account → Username).
// Accounts that sign in with username + password keep a hidden sign-in address <username>@<project>.firebaseapp.com,
// and only the server (Firebase Admin) can change that address, so the whole change happens here:
//   1. reserve the new name, 2. move the sign-in address, 3. update the profile and free the old name.
import { getFirestore } from 'firebase-admin/firestore';
import { adminAuth, handler, HttpError, USERNAME_RE, usernameEmail } from './_lib.js';

export default handler(async ({ idToken, username }) => {
  const u = String(username || '').trim().toLowerCase().replace(/^@/, '');
  if (!USERNAME_RE.test(u)) throw new HttpError(400, 'Usernames are 3–20 characters: letters, numbers and _ only.');
  let auth;
  try { auth = adminAuth(); }
  catch (e) {
    if (e instanceof HttpError && e.status === 503) throw new HttpError(503, 'Changing usernames is not set up on this site yet (FIREBASE_SERVICE_ACCOUNT is missing).');
    throw e;
  }
  let uid;
  try { uid = (await auth.verifyIdToken(String(idToken || ''))).uid; }
  catch { throw new HttpError(401, 'Your sign-in has expired. Sign out, sign in again and retry.'); }

  const db = getFirestore();
  const profileRef = db.doc(`users/${uid}`), newRef = db.doc(`usernames/${u}`);
  const profile = await profileRef.get();
  if (!profile.exists) throw new HttpError(404, 'Create your profile first.');
  const old = profile.data().username || null;
  if (old === u) return { ok: true, username: u };

  // 1. reserve the new name (fails if someone else owns it)
  let reservedNow = false;
  await db.runTransaction(async t => {
    const s = await t.get(newRef);
    if (s.exists && s.data().uid !== uid) throw new HttpError(409, `@${u} is already taken.`);
    if (!s.exists) { t.set(newRef, { uid, createdAt: Date.now() }); reservedNow = true; }
  });

  // 2. move the hidden sign-in address of username + password accounts
  const user = await auth.getUser(uid);
  if (user.providerData.some(p => p.providerId === 'password')) {
    try { await auth.updateUser(uid, { email: usernameEmail(u) }); }
    catch (e) {
      if (reservedNow) await newRef.delete().catch(() => {});
      if (e?.code === 'auth/email-already-exists') throw new HttpError(409, `@${u} is already taken.`);
      throw e;
    }
  }

  // 3. save it on the profile and free the old name
  await db.runTransaction(async t => {
    const oldRef = old ? db.doc(`usernames/${old}`) : null;
    const oldDoc = oldRef ? await t.get(oldRef) : null;
    t.update(profileRef, { username: u, usernameChangedAt: Date.now() });
    if (oldDoc?.exists && oldDoc.data().uid === uid) t.delete(oldRef);
  });
  return { ok: true, username: u };
});
