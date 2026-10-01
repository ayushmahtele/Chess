import { h, clear, toast } from '../dom.js';
import { icon } from '../icons.js';
import { APP_NAME } from '../config.js';
import { session, cloudEnabled, signInGoogle, signInUsername, signUpUsername, friendlyError, USERNAME_RE, cleanUsername, usernameOwner } from '../store/index.js';

export async function loginView(main, _p, ctx) {
  if (session().user) { ctx.go(ctx.profile ? '/' : '/welcome'); return; }
  if (!cloudEnabled) {
    main.append(h('div.onb', h('h1', 'Sign in'), h('p.muted', 'Accounts are not set up on this copy of the site yet. Add the Firebase keys (see README) to enable Google and username sign-in.'), h('a.btn', { href: '#/' }, 'Back')));
    return;
  }
  let mode = 'signin';
  const card = h('div.card.auth-card');
  const err = h('p.form-err', { role: 'alert' });

  function render() {
    clear(card); err.textContent = '';
    const user = h('input.text-in', { id: 'au', autocomplete: 'username', placeholder: 'username', maxlength: 20, autocapitalize: 'none', spellcheck: false });
    const pw = h('input.text-in', { id: 'ap', type: 'password', autocomplete: mode === 'signup' ? 'new-password' : 'current-password', placeholder: 'Password' });
    const pw2 = h('input.text-in', { id: 'ap2', type: 'password', autocomplete: 'new-password', placeholder: 'Repeat password' });
    const avail = h('small.avail');
    let t;
    if (mode === 'signup') user.addEventListener('input', () => {
      clearTimeout(t); const u = cleanUsername(user.value);
      if (!u) { avail.textContent = ''; return; }
      if (!USERNAME_RE.test(u)) { avail.textContent = '3–20 characters: letters, numbers and _'; avail.className = 'avail bad'; return; }
      avail.textContent = 'Checking…'; avail.className = 'avail';
      t = setTimeout(async () => { const taken = await usernameOwner(u); avail.textContent = taken ? `@${u} is taken` : `@${u} is available`; avail.className = 'avail ' + (taken ? 'bad' : 'ok'); }, 350);
    });
    const submit = h('button.btn.primary.big', { type: 'submit' }, mode === 'signin' ? 'Sign in' : 'Create account');
    const form = h('form', { on: { submit: async e => {
      e.preventDefault(); err.textContent = ''; submit.disabled = true;
      try {
        if (mode === 'signup') {
          if (pw.value.length < 6) throw new Error('Password must be at least 6 characters.');
          if (pw.value !== pw2.value) throw new Error('The two passwords are different.');
          await signUpUsername(user.value, pw.value);
        } else await signInUsername(user.value, pw.value);
      } catch (ex) { err.textContent = friendlyError(ex); submit.disabled = false; }
    } } },
      h('div.field', h('label', { for: 'au' }, 'Username'), user, avail),
      h('div.field', h('label', { for: 'ap' }, 'Password'), pw),
      mode === 'signup' && h('div.field', h('label', { for: 'ap2' }, 'Repeat password'), pw2),
      err, submit);
    card.append(
      h('div.seg', h('button', { 'aria-pressed': String(mode === 'signin'), on: { click: () => { mode = 'signin'; render(); } } }, 'Sign in'),
        h('button', { 'aria-pressed': String(mode === 'signup'), on: { click: () => { mode = 'signup'; render(); } } }, 'Create account')),
      h('button.btn.big.google', { on: { click: async () => { try { await signInGoogle(); } catch (ex) { toast(friendlyError(ex), 'error'); } } } }, icon('google'), 'Continue with Google'),
      h('div.or', h('span', 'or with a username')),
      form,
      mode === 'signup' && h('p.note', 'Usernames can\'t be changed later. You can link your Google account after signing up, so you can sign in either way.'));
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
