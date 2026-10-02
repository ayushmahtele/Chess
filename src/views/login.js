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
    const forgot = h('details.forgot', h('summary', 'Forgot your password or username?'),
      h('p', 'Your Gmail is your key. Sign in with the Google account linked to your Chess Arena account. Your username is shown on your Profile, and you can set a new password there under ', h('b', 'Sign-in methods → Change password'), ' (no old password needed).'),
      h('button.btn.google', { type: 'button', on: { click: async () => { try { await signInGoogle(); } catch (ex) { toast(friendlyError(ex), 'error'); } } } }, icon('google'), 'Continue with Google'));
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
