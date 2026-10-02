// Shared helpers for the password-reset server functions (run on Vercel, not in the browser).
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import fs from 'node:fs';

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

let projectId = null, secret = null;
function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  return JSON.parse(text);
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

export async function sendCode(to, code) {
  const subject = `${code} is your Chess Arena password reset code`;
  const text = `Your Chess Arena password reset code is ${code}\n\nIt is valid for 10 minutes. If you didn't ask to reset your password, you can ignore this email.`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;border:1px solid #ddd;border-radius:12px">
    <h2 style="margin:0 0 8px">Chess Arena</h2><p>Your password reset code is:</p>
    <p style="font-size:34px;font-weight:bold;letter-spacing:8px;margin:12px 0">${code}</p>
    <p style="color:#555">It is valid for 10 minutes. If you didn't ask to reset your password, you can ignore this email.</p></div>`;
  if (process.env.MAIL_MODE === 'log') {                                  // local tests: write the email to a file
    fs.writeFileSync(process.env.MAIL_LOG_FILE || '/tmp/last-mail.json', JSON.stringify({ to, subject, code }));
    return;
  }
  const user = process.env.GMAIL_USER, pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (!user || !pass) throw new HttpError(503, 'Sending emails is not set up on this site yet. Use "Continue with Google" instead.');
  const t = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  await t.sendMail({ from: `"Chess Arena" <${user}>`, to, subject, text, html });
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
      console.error(e);
      send(500, { error: 'Something went wrong. Please try again in a minute.' });
    }
  };
}
