import { h, clear, toast, fmtDate } from '../dom.js';
import { icon } from '../icons.js';
import { TIME_CONTROLS } from '../config.js';
import { session, cloudEnabled, friendlyError, cleanUsername } from '../store/index.js';
import { isProvisional, ratingsOf, categoryOfTc, ONLINE_CATS, catInfo, plural } from '../rating.js';
import { onlineRating, quickMatch, challenge, createGame, joinGame, declineChallenge, COLL, LAST_KEY } from '../online.js';

const tcLabel = id => TIME_CONTROLS.find(t => t.id === id)?.label || 'No clock';

export async function onlineLobbyView(main, _p, ctx) {
  const { user, db } = session();
  const P = ctx.profile;
  if (!cloudEnabled || !user) {
    main.append(h('div.onb', h('h1', 'Play online'), h('p.muted', cloudEnabled
      ? 'Sign in to play friends and other players online. Your games and online rating are saved to your account.'
      : 'Online play needs accounts, which are not set up on this copy of the site yet (see the README).'),
      cloudEnabled && h('a.btn.primary', { href: '#/login' }, 'Sign in or create an account')));
    return;
  }
  const settings = { tc: '5+0', rated: true, color: 'r' };
  try { Object.assign(settings, JSON.parse(localStorage.getItem('chessarena:onlineSetup') || '{}')); } catch {}
  const saveSettings = () => localStorage.setItem('chessarena:onlineSetup', JSON.stringify(settings));
  const tcObj = () => { const t = TIME_CONTROLS.find(x => x.id === settings.tc); return { id: t.id, base: t.base, inc: t.inc }; };

  const setup = h('div');
  function renderSetup() {
    clear(setup).append(
      h('div.field', h('span.lbl', 'Time control'),
        h('div.tc-group', [...new Set(TIME_CONTROLS.map(t => t.group))].map(g => [h('span.g', g), h('div.chip-group', TIME_CONTROLS.filter(t => t.group === g).map(t =>
          h('button.chip', { 'aria-pressed': String(settings.tc === t.id), on: { click: () => { settings.tc = t.id; saveSettings(); renderSetup(); renderRatings(); } } }, t.label)))]))),
      h('label.switch', h('span', h('b', 'Rated'), h('small', 'Changes your online rating')),
        h('input.toggle', { type: 'checkbox', checked: settings.rated, on: { change: e => { settings.rated = e.target.checked; saveSettings(); } } })));
  }
  renderSetup();

  const busy = (btn, fn) => async () => { btn.disabled = true; try { await fn(); } catch (e) { toast(friendlyError(e), 'error'); } btn.disabled = false; };
  const quickBtn = h('button.btn.primary.big', icon('play'), 'Find an opponent');
  quickBtn.onclick = busy(quickBtn, async () => { const id = await quickMatch(P, { tc: tcObj(), rated: settings.rated }); ctx.go('/play/' + id); });

  const friendIn = h('input.text-in', { placeholder: 'friend’s username', autocapitalize: 'none', spellcheck: false, 'aria-label': 'Friend’s username' });
  const colorSel = h('select.select', { 'aria-label': 'Your colour', on: { change: e => { settings.color = e.target.value; saveSettings(); } } },
    [['r', 'Random colour'], ['w', 'I play White'], ['b', 'I play Black']].map(([v, l]) => h('option', { value: v, selected: settings.color === v }, l)));
  const chBtn = h('button.btn.primary', 'Send challenge');
  chBtn.onclick = busy(chBtn, async () => {
    if (!cleanUsername(friendIn.value)) throw new Error('Type your friend’s username.');
    const id = await challenge(P, friendIn.value, { tc: tcObj(), rated: settings.rated, color: settings.color });
    ctx.go('/play/' + id);
  });
  friendIn.addEventListener('keydown', e => { if (e.key === 'Enter') chBtn.click(); });
  const linkBtn = h('button.btn', icon('copy'), 'Create invite link');
  linkBtn.onclick = busy(linkBtn, async () => { const id = await createGame(P, { tc: tcObj(), rated: settings.rated, color: settings.color }); ctx.go('/play/' + id); });

  const incoming = h('div.glist');
  const ratingCard = h('div.card');
  function renderRatings() {
    const R = ratingsOf(P), sel = categoryOfTc(settings.tc);
    clear(ratingCard).append(h('h2', 'Online ratings'),
      h('div.rtiles', ONLINE_CATS.map(id => h('div.rtile', { class: id === sel ? 'sel' : '' }, h('span.rl', catInfo(id).icon + ' ' + catInfo(id).label),
        h('b', R[id].rating, isProvisional(R[id].rd) ? h('span.q', '?') : ''), h('small', plural(R[id].games || 0, 'game'))))),
      h('p.muted', { style: { margin: '10px 0 0', fontSize: '.85rem' } }, `This game counts for your ${catInfo(sel).icon} ${catInfo(sel).label} rating. Each time control has its own rating, separate from vs Computer.`));
  }
  renderRatings();
  const resume = h('div.resume-slot');

  main.append(h('div.page-head', h('div', h('h1', 'Play online'), h('p.muted', { style: { margin: '6px 0 0' } }, `Signed in as @${P.username}`))),
    h('div.home', { style: { marginTop: '18px' } },
      h('div.side-stack',
        h('div.card', h('h2', 'Game settings'), setup),
        h('div.card', h('h2', 'Quick match'), h('p.muted','Play against the next person looking for a game with the same settings.'), quickBtn),
        h('div.card', h('h2', 'Challenge a friend'),
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, friendIn, colorSel, chBtn),
          h('p.muted', { style: { margin: '14px 0 8px' } }, 'Or send a link that anyone with an account can open and play:'), linkBtn)),
      h('div.side-stack', resume,
        h('div.card', h('h2', 'Challenges for you'), incoming),
        ratingCard)));

  const last = localStorage.getItem(LAST_KEY);
  if (last) db.get(`${COLL}/${last}`).then(g => {
    if (g && g.status === 'active' && g.players.includes(user.uid)) resume.append(h('div.card.resume', h('h2', 'Game in progress'),
      h('p.muted', `Against @${g.p[g.players.find(p => p !== user.uid)]?.username}`), h('a.btn.primary', { href: '#/play/' + g.id }, 'Back to the game')));
  }).catch(() => {});

  const off = db.watchQuery(COLL, { where: [['invitee', '==', user.uid], ['status', '==', 'waiting']] }, list => {
    clear(incoming);
    if (!list.length) { incoming.append(h('p.muted', 'No challenges right now. When a friend challenges you, it shows up here and as a pop-up on every page.')); return; }
    for (const g of list) {
      const from = g.p[g.createdBy];
      incoming.append(h('div.grow', { style: { gridTemplateColumns: '1fr auto' } },
        h('div', h('div.t', `@${from.username} (${from.rating})`), h('div.s', `${tcLabel(g.tcId)} · ${g.rated ? 'Rated' : 'Casual'} · ${fmtDate(g.createdAt || Date.now())}`)),
        h('div', { style: { display: 'flex', gap: '6px' } },
          h('button.btn', { on: { click: () => declineChallenge(g.id).catch(e => toast(friendlyError(e), 'error')) } }, 'Decline'),
          h('button.btn.primary', { on: { click: async () => { try { await joinGame(g.id, P); ctx.go('/play/' + g.id); } catch (e) { toast(friendlyError(e), 'error'); } } } }, 'Accept'))));
    }
  }, e => { clear(incoming).append(h('p.muted', 'Could not load challenges: ' + friendlyError(e))); });
  return () => off();
}
