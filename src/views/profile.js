import { h, clear, confirmBox, toast, fmtDate } from '../dom.js';
import { icon } from '../icons.js';
import { session, cloudEnabled, signOut, linkGoogle, addPassword, changePassword, claimUsername, friendlyError } from '../store/index.js';
import { avatar, avatarSrc } from '../avatar.js';
import { openPhotoEditor } from './photo-editor.js';
import { LEVELS, isProvisional, ratingsOf, overallOf, categoryOfTc, CATEGORIES, ONLINE_CATS, catInfo } from '../rating.js';

export async function profileView(main, _p, ctx) {
  const P = ctx.profile, { user, store } = session();
  const R = ratingsOf(P), O = overallOf(P);
  let games = null, sel = 'overall';
  // Wins / draws / losses come from the saved games, so they always match History.
  function statsFor(cat) {
    const list = (games || []).filter(g => g.outcome !== 'aborted' && (cat === 'overall' ? g.mode === 'online'
      : cat === 'computer' ? g.mode === 'bot' : g.mode === 'online' && categoryOfTc(g.timeControl) === cat));
    const w = list.filter(g => g.outcome === 'win').length, d = list.filter(g => g.outcome === 'draw').length, l = list.filter(g => g.outcome === 'loss').length;
    return { n: list.length, w, d, l };
  }
  const pctOf = (x, t) => t ? x / t * 100 : 0;
  const wdl = st => [h('div.wdl', h('i', { style: { width: pctOf(st.w, st.n) + '%', background: 'var(--win)' } }), h('i', { style: { width: pctOf(st.d, st.n) + '%', background: 'var(--draw)' } }), h('i', { style: { width: pctOf(st.l, st.n) + '%', background: 'var(--red)' } })),
    h('small.muted', `${st.w} won · ${st.d} drawn · ${st.l} lost · ${st.n ? Math.round(pctOf(st.w, st.n)) + '% win rate' : 'no games yet'} (aborted games not counted)`)];
  const overallStats = h('div');
  const ratingsCard = h('div.card');
  function renderOverallStats() {
    const st = statsFor('overall');
    clear(overallStats).append(
      h('div.stats-row', h('div.stat', h('b', games ? st.n : '…'), h('span', 'Games')), h('div.stat', h('b', games ? st.w : '…'), h('span', 'Won')),
        h('div.stat', h('b', games ? st.d : '…'), h('span', 'Drawn')), h('div.stat', h('b', games ? st.l : '…'), h('span', 'Lost'))),
      ...wdl(st));
  }
  renderOverallStats();

  const nameIn = h('input.text-in', { value: P.name, maxlength: 24, 'aria-label': 'Display name' });
  const photo = h('button.avatar-edit', { title: 'Change profile picture', 'aria-label': 'Change profile picture', on: { click: async () => {
    const result = await openPhotoEditor(avatarSrc(P, user));
    if (result === null) return;
    try { P.photo = result; await store.saveProfile(P); await ctx.refreshProfile(); toast(result === 'none' ? 'Profile picture removed' : 'Profile picture updated'); ctx.go('/profile'); }
    catch (e) { toast('Could not save the picture: ' + (e.message || e), 'error'); }
  } } }, avatar(P, user), h('span.cam', { 'aria-hidden': 'true' }, '📷'));

  main.append(h('div.page-head', h('h1', 'Profile')), h('div.profile', { style: { marginTop: '18px' } },
    h('div.side-stack',
      h('div.card',
        h('div.prof-head', photo, h('div', h('h2', { style: { margin: 0 } }, P.name),
          h('div.muted', user ? (P.username ? '@' + P.username : '') + (user.email ? ' · ' + user.email : '') : 'Guest account (this browser only)'),
          h('div.muted', `Joined ${fmtDate(P.createdAt)} · Started as ${LEVELS[P.level]?.label || P.level} (${P.startRating})`))),
        h('div.rlabel-big', 'Overall rating'),
        h('div.rating-big', h('span.n', O.rating), isProvisional(O.rd) && h('span.q', '?')),
        h('p.muted', { style: { margin: '4px 0 0' } }, 'The average of your ⚡ Bullet, 🔥 Blitz, ⏱ Rapid and ♾ No clock ratings. Games against the computer are not included.'),
        overallStats),
      h('div.card', h('h2', 'Account'),
        h('div.field', h('label', 'Display name'), h('div', { style: { display: 'flex', gap: '8px' } }, nameIn,
          h('button.btn', { on: { click: async () => { P.name = nameIn.value.trim() || P.name; await store.saveProfile(P); await ctx.refreshProfile(); toast('Name updated'); } } }, 'Save'))),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
          user ? h('button.btn', { on: { click: async () => { await signOut(); toast('Signed out'); ctx.go('/'); } } }, 'Sign out')
            : cloudEnabled && h('a.btn.primary', { href: '#/login' }, 'Sign in or create an account'),
          h('button.btn.danger', { on: { click: resetAll } }, 'Delete all my data'))),
      user && methodsCard()),
    h('div.side-stack', ratingsCard)));

  function ratingsCard_render() {
    const body = [];
    if (sel === 'overall') {
      body.push(h('div.rtiles.big', CATEGORIES.map(c => { const st = statsFor(c.id);
        return h('button.rtile', { on: { click: () => { sel = c.id; ratingsCard_render(); } } }, h('span.rl', c.icon + ' ' + c.label),
          h('b', R[c.id].rating, isProvisional(R[c.id].rd) ? h('span.q', '?') : ''), h('small', games ? `${st.n} ${st.n === 1 ? 'game' : 'games'}` : '…')); })),
        h('p.muted', { style: { margin: '12px 0 0', fontSize: '.85rem' } }, 'Each type of game has its own rating. They all started at your level and change only when you play rated games of that type. Tap one for its details.'));
    } else {
      const e = R[sel], st = statsFor(sel), prov = isProvisional(e.rd);
      body.push(
        h('div.rating-big', h('span.n', e.rating), prov && h('span.q', '?'), h('span.muted', prov ? 'provisional' : '')),
        h('div.stats-row', h('div.stat', h('b', e.peak || e.rating), h('span', 'Peak')), h('div.stat', h('b', games ? st.n : '…'), h('span', 'Games')),
          h('div.stat', h('b', games ? st.w : '…'), h('span', 'Won')), h('div.stat', h('b', games ? st.l : '…'), h('span', 'Lost'))),
        ...wdl(st),
        h('div', { style: { marginTop: '14px' } }, graph(e.history || [])),
        h('p.muted', { style: { margin: '10px 0 0', fontSize: '.85rem' } }, sel === 'computer' ? 'Changes only with rated games against the computer.'
          : `Changes only with rated online ${catInfo(sel).label === 'No clock' ? 'games without a clock' : catInfo(sel).label + ' games'} (${({ bullet: '1 min, 2 | 1', blitz: '3 min, 3 | 2, 5 min', rapid: '10 min, 15 | 10, 30 min', noclock: 'no clock' })[sel]}).`));
    }
    clear(ratingsCard).append(h('h2', 'Ratings'),
      h('div.chip-group.timefilter', [['overall', 'Overall'], ...CATEGORIES.map(c => [c.id, c.icon + ' ' + c.label])].map(([k, l]) =>
        h('button.chip', { 'aria-pressed': String(sel === k), on: { click: () => { sel = k; ratingsCard_render(); } } }, l))),
      ...body);
  }
  ratingsCard_render();
  store.listGames().then(gs => { games = gs; renderOverallStats(); ratingsCard_render(); }).catch(() => { games = []; renderOverallStats(); ratingsCard_render(); });

  function methodsCard() {
    const hasG = user.providers.includes('google.com'), hasPw = user.providers.includes('password');
    const pwIn = h('input.text-in', { type: 'password', placeholder: 'New password (6+ characters)', autocomplete: 'new-password', 'aria-label': 'New password' });
    const pw2In = h('input.text-in', { type: 'password', placeholder: 'Repeat new password', autocomplete: 'new-password', 'aria-label': 'Repeat new password' });
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
        hasPw && h('details', h('summary', 'Change password'), h('div', { style: { display: 'grid', gap: '8px', marginTop: '8px' } },
          h('p.muted', { style: { margin: 0, fontSize: '.85rem' } }, hasG ? 'No old password needed. If asked, confirm with your Google account.' : 'No old password needed. Tip: link Google above so you can always recover your account.'),
          pwIn, pw2In,
          h('button.btn', { on: { click: run(async () => {
            if (pwIn.value.length < 6) throw new Error('Password must be at least 6 characters.');
            if (pwIn.value !== pw2In.value) throw new Error('The two passwords are different.');
            await changePassword(pwIn.value); pwIn.value = pw2In.value = ''; toast('Password changed');
          }) } }, 'Change password'))),
        !hasG && h('p.muted', { style: { fontSize: '.85rem', margin: '4px 0 0' } }, 'Without a linked Google account, a forgotten password can\'t be recovered. Link Google to be safe.')));
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
