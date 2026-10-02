import { h, clear, toast } from '../dom.js';
import { icon } from '../icons.js';
import { APP_NAME } from '../config.js';
import { session, cloudEnabled, signInGoogle, signInUsername, signUpWithGmail, friendlyError, USERNAME_RE, cleanUsername, usernameOwner } from '../store/index.js';

export async function loginView(main, _p, ctx) {
  if (session().user) { ctx.go(ctx.profile ? '/' : '/welcome'); return; }
  if (!cloudEnabled) {
    main.append(h('div.onb', h('h1', 'Sign in'), h('p.muted', 'Accounts are not set up on this copy of the site yet. Add the Firebase keys (see README) to enable Google and username sign-in.'), h('a.btn', { href: '#/' }, 'Back')));
    return;
  }
  let mode = sessionStorage.getItem('chessarena:loginMode') || 'signin';
  const lastErr = sessionStorage.getItem('chessarena:loginErr');
  // the page can be drawn twice in a row after a refused sign-up; keep the note briefly so both see it
  setTimeout(() => { sessionStorage.removeItem('chessarena:loginMode'); sessionStorage.removeItem('chessarena:loginErr'); }, 2500);
  const card = h('div.card.auth-card');
  const err = h('p.form-err', { role: 'alert' });

  let lastCheck = { u: null, free: false };
  function render() {
    clear(card); err.textContent = '';
    const signup = mode === 'signup';
    const user = h('input.text-in', { id: 'au', autocomplete: 'username', placeholder: 'username', maxlength: 20, autocapitalize: 'none', spellcheck: false });
    const pw = h('input.text-in', { id: 'ap', type: 'password', autocomplete: signup ? 'new-password' : 'current-password', placeholder: 'Password' });
    const pw2 = h('input.text-in', { id: 'ap2', type: 'password', autocomplete: 'new-password', placeholder: 'Repeat password' });
    const avail = h('small.avail');
    let t;
    if (signup) user.addEventListener('input', () => {
      clearTimeout(t); const u = cleanUsername(user.value); lastCheck = { u: null, free: false };
      if (!u) { avail.textContent = ''; return; }
      if (!USERNAME_RE.test(u)) { avail.textContent = '3–20 characters: letters, numbers and _'; avail.className = 'avail bad'; return; }
      avail.textContent = 'Checking…'; avail.className = 'avail';
      t = setTimeout(async () => { const taken = await usernameOwner(u); if (cleanUsername(user.value) !== u) return; lastCheck = { u, free: !taken }; avail.textContent = taken ? `@${u} is taken` : `@${u} is available`; avail.className = 'avail ' + (taken ? 'bad' : 'ok'); }, 300);
    });
    const submit = signup
      ? h('button.btn.primary.big', { type: 'submit' }, icon('google'), 'Verify Gmail & create account')
      : h('button.btn.primary.big', { type: 'submit' }, 'Sign in');
    const form = h('form', { on: { submit: async e => {
      e.preventDefault(); err.textContent = ''; submit.disabled = true;
      try {
        if (signup) {
          if (pw.value.length < 6) throw new Error('Password must be at least 6 characters.');
          if (pw.value !== pw2.value) throw new Error('The two passwords are different.');
          const u = cleanUsername(user.value);
          await signUpWithGmail(u, pw.value, lastCheck.u === u && lastCheck.free);   // opens Google's window right away
        } else await signInUsername(user.value, pw.value);
      } catch (ex) {
        const m = friendlyError(ex); err.textContent = m; toast(m, 'error'); submit.disabled = false;
        if (signup && !location.hash.startsWith('#/login')) {   // the Google step may have moved us away: come back to this form
          sessionStorage.setItem('chessarena:loginMode', 'signup'); sessionStorage.setItem('chessarena:loginErr', m); location.hash = '/login';
        }
      }
    } } },
      h('div.field', h('label', { for: 'au' }, signup ? 'Choose a username' : 'Username'), user, avail),
      h('div.field', h('label', { for: 'ap' }, 'Password'), pw),
      signup && h('div.field', h('label', { for: 'ap2' }, 'Repeat password'), pw2),
      err, submit);
    const forgot = forgotBox();
    card.append(
      h('div.seg', h('button', { 'aria-pressed': String(!signup), on: { click: () => { mode = 'signin'; render(); } } }, 'Sign in'),
        h('button', { 'aria-pressed': String(signup), on: { click: () => { mode = 'signup'; render(); } } }, 'Create account')),
      !signup && h('button.btn.big.google', { on: { click: async () => { try { await signInGoogle(); } catch (ex) { toast(friendlyError(ex), 'error'); } } } }, icon('google'), 'Continue with Google'),
      !signup && h('div.or', h('span', 'or with a username')),
      signup && h('p.note.signup-note', 'Pick a username and password, then choose your Gmail in Google’s window. Each Gmail can have only one account, and you can sign in with either Google or your username.'),
      form,
      !signup && forgot,
      signup && h('p.note', 'Usernames can\'t be changed later. Your Gmail is used to sign in and to recover your account. It is never shown to other players.'));
    if (lastErr && signup) { err.textContent = lastErr; }
    setTimeout(() => user.focus(), 0);
  }
  // Forgot password: a 6-digit code is emailed to the Gmail linked to the username.
  function forgotBox() {
    const box = h('div.forgot-body');
    const step1 = (prefill = '') => {
      const un = h('input.text-in', { placeholder: 'your username', autocapitalize: 'none', spellcheck: false, value: prefill, 'aria-label': 'Username' });
      const e1 = h('p.form-err');
      const btn = h('button.btn.primary', { type: 'button' }, 'Email me a code');
      btn.onclick = async () => {
        e1.textContent = ''; btn.disabled = true;
        try { const r = await api('forgot-start', { username: un.value }); step2(cleanUsername(un.value), r.sentTo); }
        catch (ex) { e1.textContent = ex.message; btn.disabled = false; }
      };
      un.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); btn.click(); } });
      clear(box).append(h('p', 'Type your username. We\'ll email a 6-digit code to the Gmail linked to your account.'), un, e1, btn);
      setTimeout(() => un.focus(), 0);
    };
    const step2 = (u, sentTo) => {
      const code = h('input.text-in.otp', { placeholder: '6-digit code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, 'aria-label': 'Code from the email' });
      const p1 = h('input.text-in', { type: 'password', placeholder: 'New password (6+ characters)', autocomplete: 'new-password', 'aria-label': 'New password' });
      const p2 = h('input.text-in', { type: 'password', placeholder: 'Repeat new password', autocomplete: 'new-password', 'aria-label': 'Repeat new password' });
      const e2 = h('p.form-err');
      const btn = h('button.btn.primary', { type: 'button' }, 'Change password & sign in');
      btn.onclick = async () => {
        e2.textContent = '';
        if (p1.value.length < 6) { e2.textContent = 'Password must be at least 6 characters.'; return; }
        if (p1.value !== p2.value) { e2.textContent = 'The two passwords are different.'; return; }
        btn.disabled = true;
        try {
          await api('forgot-verify', { username: u, code: code.value, password: p1.value });
          toast('Password changed. Signing you in…');
          await signInUsername(u, p1.value);
        } catch (ex) { e2.textContent = ex.message || friendlyError(ex); btn.disabled = false; }
      };
      code.addEventListener('input', () => { code.value = code.value.replace(/\D/g, '').slice(0, 6); });
      clear(box).append(
        h('p', 'We sent a code to ', h('b', sentTo), ' for ', h('b', '@' + u), '. It works for 10 minutes. Check Spam if you don\'t see it.'),
        code, p1, p2, e2, btn,
        h('button.linkish', { type: 'button', on: { click: () => step1(u) } }, 'Didn\'t get it? Send a new code'));
      setTimeout(() => code.focus(), 0);
    };
    step1();
    return h('details.forgot', h('summary', 'Forgot your password?'), box,
      h('div.or', h('span', 'or')),
      h('p.note', 'Forgot your username too? Sign in with the Google account linked to it. Your username is shown on your Profile.'),
      h('button.btn.google', { type: 'button', on: { click: async () => { try { await signInGoogle(); } catch (ex) { toast(friendlyError(ex), 'error'); } } } }, icon('google'), 'Continue with Google'));
  }
  async function api(name, body) {
    let r;
    try { r = await fetch('/api/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    catch { throw new Error('Could not reach the server. Check your internet connection.'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || (r.status === 404 ? 'Password reset by email is not set up on this site yet. Use "Continue with Google" instead.' : 'Something went wrong. Please try again.'));
    return j;
  }

  render();
  const stage = h('div.auth-stage', { role: 'img', 'aria-label': '3D chess board showing the finish of The Immortal Game, Anderssen vs Kieseritzky, London 1851' },
    h('div.stage-hint', matchMedia('(pointer: coarse)').matches ? 'Drag to rotate · pinch to zoom' : 'Drag to rotate · scroll to zoom'));
  main.append(h('div.auth-page', stage,
    h('div.auth', h('h1', `Sign in to ${APP_NAME}`), h('p.muted', 'Keep your rating and games on every device, and play friends online.'), card,
      h('p.muted', { style: { textAlign: 'center' } }, h('a', { href: '#/' }, 'Keep playing as a guest')))));

  // 3D board (loaded only on this page)
  let destroy = null, gone = false;
  import('../three/immortal.js').then(m => {
    if (gone) return;
    try { destroy = m.mountImmortal(stage, { reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches }); stage.classList.add('ready'); }
    catch (e) { console.warn('3D board unavailable', e); stage.classList.add('no-3d'); }
  }).catch(() => stage.classList.add('no-3d'));
  return () => { gone = true; destroy?.(); };
}
