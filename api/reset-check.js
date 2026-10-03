// Open /api/reset-check in a browser to see whether password reset by email is set up correctly.
// Shows only ✅ / ❌ — never any secret values.
import { serviceAccount, adminAuth, mailer, mailError } from './_lib.js';

export default async function handler(req, res) {
  const out = {};
  try {
    const sa = serviceAccount();
    out.FIREBASE_SERVICE_ACCOUNT = sa ? `✅ found (project ${sa.project_id})` : '❌ missing';
    if (sa) {
      try { await adminAuth().getUserByEmail('nobody-' + Date.now() + '@example.com'); out.firebase_login = '✅ works'; }
      catch (e) { out.firebase_login = e?.code === 'auth/user-not-found' ? '✅ works' : '❌ ' + (e?.code || e?.message || 'failed'); }
    }
  } catch (e) { out.FIREBASE_SERVICE_ACCOUNT = '❌ ' + e.message; }
  out.GMAIL_USER = process.env.GMAIL_USER ? (/^[^@\s]+@gmail\.com$/i.test(process.env.GMAIL_USER.trim()) ? '✅ looks like a Gmail address' : '⚠️ set, but it does not look like name@gmail.com') : '❌ missing';
  const pw = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  out.GMAIL_APP_PASSWORD = !pw ? '❌ missing' : pw.length === 16 ? '✅ 16 letters' : `⚠️ has ${pw.length} letters (an app password has 16)`;
  if (process.env.GMAIL_USER && pw) {
    try { await mailer().verify(); out.gmail_login = '✅ Gmail accepted the app password'; }
    catch (e) { out.gmail_login = '❌ ' + mailError(e).message; }
  }
  out.ready = Object.values(out).every(v => !String(v).startsWith('❌')) ? '✅ Password reset by email should work' : '❌ Fix the items marked ❌, then Redeploy';
  res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(out, null, 2));
}
