// Step 1 of "Forgot password": email a 6-digit code to the Gmail linked to this username.
import crypto from 'node:crypto';
import { adminAuth, handler, HttpError, USERNAME_RE, usernameEmail, codeHash, mask, sendCode } from './_lib.js';

const MINUTE = 60e3;
export default handler(async ({ username }) => {
  const u = String(username || '').trim().toLowerCase().replace(/^@/, '');
  if (!USERNAME_RE.test(u)) throw new HttpError(400, 'Type your username (3–20 letters, numbers or _).');
  const auth = adminAuth();
  let user;
  try { user = await auth.getUserByEmail(usernameEmail(u)); }
  catch { throw new HttpError(404, `There is no account with the username @${u}.`); }
  const gmail = user.providerData.find(p => p.providerId === 'google.com')?.email;
  if (!gmail) throw new HttpError(400, 'This account has no Gmail linked, so a code can\'t be sent. Ask the owner to sign in and link Google in Profile.');

  const now = Date.now(), pr = user.customClaims?.pr || {};
  if (pr.t && now - pr.t < MINUTE) throw new HttpError(429, 'A code was just sent. Please wait a minute before asking for another.');
  const inWindow = pr.w && now - pr.w < 60 * MINUTE;
  const count = inWindow ? (pr.n || 0) + 1 : 1;
  if (count > 5) throw new HttpError(429, 'Too many codes requested. Please try again in an hour.');

  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  const exp = now + 10 * MINUTE;
  await auth.setCustomUserClaims(user.uid, { ...(user.customClaims || {}), pr: { h: codeHash(user.uid, code, exp), e: exp, f: 0, t: now, n: count, w: inWindow ? pr.w : now } });
  await sendCode(gmail, code);
  return { ok: true, sentTo: mask(gmail) };
});
