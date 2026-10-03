// Shared helpers for the password-reset server functions (run on Vercel, not in the browser).
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import fs from 'node:fs';

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

let projectId = null, secret = null;
// Pasting can add real line breaks inside the quoted text (e.g. inside the private key). JSON doesn't allow that,
// so remove line breaks that are inside "…" strings and keep everything else exactly as it was.
function dropLineBreaksInsideStrings(t) {
  let out = '', inStr = false, esc = false;
  for (const ch of t) {
    if (inStr) {
      if (esc) { esc = false; out += ch; continue; }
      if (ch === '\\') { esc = true; out += ch; continue; }
      if (ch === '"') inStr = false;
      if (ch === '\n' || ch === '\r') continue;
      out += ch;
    } else { if (ch === '"') inStr = true; out += ch; }
  }
  return out;
}
export function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  let json;
  try {
    const text = raw.trim().startsWith('{') ? raw.trim() : Buffer.from(raw.trim(), 'base64').toString('utf8');
    try { json = JSON.parse(text); } catch { json = JSON.parse(dropLineBreaksInsideStrings(text)); }   // repair a key pasted with line breaks inside the text
  } catch { throw new HttpError(503, 'The Firebase key (FIREBASE_SERVICE_ACCOUNT) is not complete. Paste the WHOLE downloaded .json file, from the first { to the last }.'); }
  if (!json.private_key || !json.client_email) throw new HttpError(503, 'The Firebase key (FIREBASE_SERVICE_ACCOUNT) is the wrong file. Use the key from Project settings → Service accounts → Generate new private key.');
  json.private_key = json.private_key.replace(/\\n/g, '\n');          // keys pasted with literal \n
  return json;
}
export function adminAuth() {
  if (!getApps().length) {
    if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {                       // local tests
      projectId = process.env.GCLOUD_PROJECT || 'demo-chess';
      initializeApp({ projectId });
      secret = 'local-test-secret';
    } else {
      const sa = serviceAccount();
      if (!sa) throw new HttpError(503, 'Password reset by email is not set up on this site yet. Use "Continue with Google" instead.');
      projectId = process.env.VITE_FIREBASE_PROJECT_ID || sa.project_id;
      initializeApp({ credential: cert(sa) });
      secret = process.env.OTP_SECRET || crypto.createHash('sha256').update(sa.private_key).digest('hex');
    }
  }
  return getAuth();
}
export const usernameEmail = u => `${u}@${projectId}.firebaseapp.com`;
export const codeHash = (uid, code, exp) => crypto.createHmac('sha256', secret).update(`${uid}:${code}:${exp}`).digest('hex');
export const mask = email => { const [n, d] = email.split('@'); return (n.length <= 2 ? n[0] + '*' : n.slice(0, 2) + '*'.repeat(Math.min(6, n.length - 2))) + '@' + d; };

export function mailer() {
  const user = (process.env.GMAIL_USER || '').trim(), pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (!user || !pass) throw new HttpError(503, 'Sending emails is not set up on this site yet (GMAIL_USER / GMAIL_APP_PASSWORD). Use "Continue with Google" instead.');
  return nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 });
}
export function mailError(e) {
  const m = String(e?.message || e);
  if (e?.code === 'EAUTH' || /535|Username and Password not accepted|Invalid login/i.test(m))
    return new HttpError(503, 'Gmail rejected the login. Check that GMAIL_USER is the full Gmail address and GMAIL_APP_PASSWORD is a current 16-letter app password for that same account, then redeploy.');
  if (/ETIMEDOUT|ECONNECTION|ESOCKET|timeout/i.test(m)) return new HttpError(503, 'Could not reach Gmail to send the email. Please try again in a minute.');
  return new HttpError(502, 'The email could not be sent (' + (e?.code || 'error') + '). Please try again in a minute.');
}

export async function sendCode(to, code) {
  const subject = `${code} is your Chess Throne password reset code`;
  const text = `Your Chess Throne password reset code is ${code}\n\nIt is valid for 10 minutes. If you didn't ask to reset your password, you can ignore this email.`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;border:1px solid #ddd;border-radius:12px">
    <h2 style="margin:0">Chess Throne</h2><p style="margin:2px 0 14px;color:#9c7200;font-weight:bold">Rise To The Throne</p><p>Your password reset code is:</p>
    <p style="font-size:34px;font-weight:bold;letter-spacing:8px;margin:12px 0">${code}</p>
    <p style="color:#555">It is valid for 10 minutes. If you didn't ask to reset your password, you can ignore this email.</p></div>`;
  if (process.env.MAIL_MODE === 'log') {                                  // local tests: write the email to a file
    fs.writeFileSync(process.env.MAIL_LOG_FILE || '/tmp/last-mail.json', JSON.stringify({ to, subject, code }));
    return;
  }
  const user = process.env.GMAIL_USER, pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (!user || !pass) throw new HttpError(503, 'Sending emails is not set up on this site yet. Use "Continue with Google" instead.');
  const t = mailer();
  try { await t.sendMail({ from: `"Chess Throne" <${process.env.GMAIL_USER.trim()}>`, to, subject, text, html }); }
  catch (e) { throw mailError(e); }
}

/** Wrap a handler: POST + JSON only, friendly errors. */
export function handler(fn) {
  return async (req, res) => {
    const send = (status, obj) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); };
    if (req.method !== 'POST') return send(405, { error: 'Use POST.' });
    try {
      let body = req.body;
      if (!body || typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch { body = {}; } }
      send(200, await fn(body));
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message });
      console.error('[reset]', e?.code || '', e?.message || e);
      const m = String(e?.code || '') + ' ' + String(e?.message || '');
      if (/credential|invalid_grant|private key|PEM|DECODER|app\/invalid/i.test(m))
        return send(503, { error: 'The Firebase key (FIREBASE_SERVICE_ACCOUNT) was not accepted. Generate a new private key in Firebase and paste the whole file again, then redeploy.' });
      send(500, { error: 'Something went wrong on the server (' + (e?.code || 'error') + '). Please try again in a minute.' });
    }
  };
}
