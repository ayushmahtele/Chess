// Step 2 of "Forgot password": check the code and set the new password.
import crypto from 'node:crypto';
import { adminAuth, handler, HttpError, USERNAME_RE, usernameEmail, codeHash } from './_lib.js';

const MAX_TRIES = 5;
export default handler(async ({ username, code, password }) => {
  const u = String(username || '').trim().toLowerCase().replace(/^@/, '');
  const c = String(code || '').replace(/\D/g, '');
  if (!USERNAME_RE.test(u)) throw new HttpError(400, 'Type your username.');
  if (c.length !== 6) throw new HttpError(400, 'The code has 6 digits.');
  if (String(password || '').length < 6) throw new HttpError(400, 'Password must be at least 6 characters.');
  const auth = adminAuth();
  let user;
  try { user = await auth.getUserByEmail(usernameEmail(u)); } catch { throw new HttpError(404, `There is no account with the username @${u}.`); }
  const claims = { ...(user.customClaims || {}) }, pr = claims.pr;
  if (!pr?.h) throw new HttpError(400, 'Ask for a code first.');
  if (Date.now() > pr.e) throw new HttpError(400, 'This code has expired. Ask for a new one.');
  if (pr.f >= MAX_TRIES) throw new HttpError(429, 'Too many wrong codes. Ask for a new code.');
  const ok = crypto.timingSafeEqual(Buffer.from(codeHash(user.uid, c, pr.e)), Buffer.from(pr.h));
  if (!ok) {
    claims.pr = { ...pr, f: pr.f + 1 };
    await auth.setCustomUserClaims(user.uid, claims);
    const left = MAX_TRIES - claims.pr.f;
    throw new HttpError(400, left > 0 ? `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong codes. Ask for a new code.');
  }
  await auth.updateUser(user.uid, { password: String(password) });
  delete claims.pr;
  await auth.setCustomUserClaims(user.uid, Object.keys(claims).length ? claims : null);
  await auth.revokeRefreshTokens(user.uid);           // sign out other devices
  return { ok: true };
});
