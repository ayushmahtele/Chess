import { h, clear, confirmBox, toast, fmtDate } from '../dom.js';
import { icon } from '../icons.js';
import { session, cloudEnabled, signOut, linkGoogle, addPassword, changePassword, claimUsername, friendlyError } from '../store/index.js';
import { onlineRating } from '../online.js';
import { LEVELS, isProvisional } from '../rating.js';

export async function profileView(main, _p, ctx) {
  const P = ctx.profile, { user, store } = session();
  const prov = isProvisional(P.rd);
  const total = (P.wins || 0) + (P.losses || 0) + (P.draws || 0);
  const pct = n => total ? (n / total * 100) : 0;

  const nameIn = h('input.text-in', { value: P.name, maxlength: 24, 'aria-label': 'Display name' });
  const photo = user?.photo ? h('img.avatar', { src: user.photo, alt: '', referrerpolicy: 'no-referrer' }) : h('span.avatar', P.name[0].toUpperCase());

  main.append(h('div.page-head', h('h1', 'Profile')), h('div.profile', { style: { marginTop: '18px' } },
    h('div.side-stack',
      h('div.card',
        h('div.prof-head', photo, h('div', h('h2', { style: { margin: 0 } }, P.name),
          h('div.muted', user ? (P.username ? '@' + P.username : '') + (user.email ? ' · ' + user.email : '') : 'Guest account (this browser only)'),
          h('div.muted', `Joined ${fmtDate(P.createdAt)} · Started as ${LEVELS[P.level]?.label || P.level} (${P.startRating})`))),
        h('div.rating-big', h('span.n', P.rating), prov && h('span.q', '?')),
        h('p.muted', { style: { margin: '4px 0 0' } }, prov
          ? 'Provisional rating: it moves a lot until you have played more rated games.'
          : `Established rating. Peak ${P.peak}.`),
        h('div.stats-row',
          h('div.stat', h('b', P.peak || P.rating), h('span', 'Peak')), h('div.stat', h('b', P.games || 0), h('span', 'Games')),
          h('div.stat', h('b', Math.round(P.rd)), h('span', 'Deviation')), h('div.stat', h('b', total ? Math.round(pct(P.wins)) + '%' : '–'), h('span', 'Win rate'))),
        h('div.wdl', h('i', { style: { width: pct(P.wins) + '%', background: 'var(--win)' } }), h('i', { style: { width: pct(P.draws) + '%', background: 'var(--draw)' } }), h('i', { style: { width: pct(P.losses) + '%', background: 'var(--red)' } })),
        h('small.muted', `${P.wins || 0} won · ${P.draws || 0} drawn · ${P.losses || 0} lost (aborted games not counted)`)),
      h('div.card', h('h2', 'Account'),
        h('div.field', h('label', 'Display name'), h('div', { style: { display: 'flex', gap: '8px' } }, nameIn,
          h('button.btn', { on: { click: async () => { P.name = nameIn.value.trim() || P.name; await store.saveProfile(P); await ctx.refreshProfile(); toast('Name updated'); } } }, 'Save'))),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
          user ? h('button.btn', { on: { click: async () => { await signOut(); toast('Signed out'); ctx.go('/'); } } }, 'Sign out')
            : cloudEnabled && h('a.btn.primary', { href: '#/login' }, 'Sign in or create an account'),
          h('button.btn.danger', { on: { click: resetAll } }, 'Delete all my data'))),
      user && methodsCard()),
    h('div.side-stack',
      h('div.card', h('h2', 'Rating vs computer'), graph(P.ratingHistory || [])),
      user && onlineCard())));

  function onlineCard() {
    const o = onlineRating(P);
    return h('div.card', h('h2', 'Online rating'),
      h('div.rating-big', h('span.n', o.rating), isProvisional(o.rd) && h('span.q', '?')),
      h('div.stats-row', h('div.stat', h('b', o.peak || o.rating), h('span', 'Peak')), h('div.stat', h('b', o.games || 0), h('span', 'Games')),
        h('div.stat', h('b', o.wins || 0), h('span', 'Won')), h('div.stat', h('b', o.losses || 0), h('span', 'Lost'))),
      (o.history || []).length >= 2 && h('div', { style: { marginTop: '14px' } }, graph(o.history)));
  }

  function methodsCard() {
    const hasG = user.providers.includes('google.com'), hasPw = user.providers.includes('password');
    const pwIn = h('input.text-in', { type: 'password', placeholder: 'New password (6+ characters)', autocomplete: 'new-password', 'aria-label': 'New password' });
    const curIn = h('input.text-in', { type: 'password', placeholder: 'Current password', autocomplete: 'current-password', 'aria-label': 'Current password' });
    const unIn = h('input.text-in', { placeholder: 'username', autocapitalize: 'none', 'aria-label': 'Username' });
    const run = fn => async () => { try { await fn(); } catch (e) { toast(friendlyError(e), 'error'); } };
    return h('div.card', h('h2', 'Sign-in methods'),
      h('p.muted', { style: { marginTop: 0 } }, 'Link both so you can sign in either way. Your rating and games stay the same.'),
      h('div.methods',
        h('div.method', h('span.mi', icon('google')), h('div.md', h('b', 'Google'), h('small', hasG ? `Linked${user.email ? ' to ' + user.email : ''}` : 'Not linked yet')),
          hasG ? h('span.ok-dot', '✓') : h('button.btn.primary', { on: { click: run(async () => { await linkGoogle(); toast('Google account linked'); ctx.go('/profile'); }) } }, 'Link Google')),
        h('div.method', h('span.mi', '@'), h('div.md', h('b', 'Username & password'),
          h('small', !P.username ? 'Choose a username first' : hasPw ? `Sign in as @${P.username}` : `Add a password to also sign in as @${P.username}`)),
          hasPw ? h('span.ok-dot', '✓') : null),
        !P.username && h('div', { style: { display: 'flex', gap: '8px' } }, unIn,
          h('button.btn', { on: { click: run(async () => { await claimUsername(unIn.value); await ctx.refreshProfile(); toast('Username saved'); ctx.go('/profile'); }) } }, 'Save username')),
        P.username && !hasPw && h('div', { style: { display: 'flex', gap: '8px' } }, pwIn,
          h('button.btn', { on: { click: run(async () => { if (pwIn.value.length < 6) throw new Error('Password must be at least 6 characters.'); await addPassword(P.username, pwIn.value); toast('Password added'); ctx.go('/profile'); }) } }, 'Add password')),
        hasPw && h('details', h('summary', 'Change password'), h('div', { style: { display: 'grid', gap: '8px', marginTop: '8px' } }, curIn, pwIn,
          h('button.btn', { on: { click: run(async () => { if (pwIn.value.length < 6) throw new Error('Password must be at least 6 characters.'); await changePassword(curIn.value, pwIn.value); curIn.value = pwIn.value = ''; toast('Password changed'); }) } }, 'Change password')))));
  }

  async function resetAll() {
    if (!(await confirmBox('Delete all your data?', 'Your rating, profile and every saved game will be permanently deleted. You will choose a level again.', 'Delete everything', true))) return;
    try { await store.deleteAccountData(); await ctx.refreshProfile(); toast('All data deleted'); ctx.go('/welcome'); }
    catch (e) { toast('Could not delete: ' + e.message, 'error'); }
  }
}

function graph(points) {
  const W = 640, H = 220, pad = { l: 44, r: 12, t: 12, b: 26 };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.classList.add('graph'); svg.setAttribute('role', 'img');
  if (points.length < 2) {
    const wrap = h('div.empty', 'Play rated games against the computer to see your rating graph.');
    return wrap;
  }
  const rs = points.map(p => p.r), lo = Math.floor((Math.min(...rs) - 30) / 50) * 50, hi = Math.ceil((Math.max(...rs) + 30) / 50) * 50;
  const x = i => pad.l + i * (W - pad.l - pad.r) / (points.length - 1);
  const y = r => pad.t + (hi - r) * (H - pad.t - pad.b) / (hi - lo);
  let grid = '';
  const stepv = Math.max(50, Math.ceil((hi - lo) / 4 / 50) * 50);
  for (let r = lo; r <= hi; r += stepv) grid += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(r)}" y2="${y(r)}"/><text x="${pad.l - 8}" y="${y(r) + 4}" text-anchor="end">${r}</text>`;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.r).toFixed(1)}`).join('');
  const area = line + `L${x(points.length - 1)},${H - pad.b}L${x(0)},${H - pad.b}Z`;
  svg.setAttribute('aria-label', `Rating graph from ${rs[0]} to ${rs.at(-1)}`);
  svg.innerHTML = grid + `<path class="a" d="${area}"/><path class="l" d="${line}"/>` +
    `<text x="${pad.l}" y="${H - 6}">${fmtDate(points[0].t)}</text><text x="${W - pad.r}" y="${H - 6}" text-anchor="end">${fmtDate(points.at(-1).t)}</text>`;
  return svg;
}
