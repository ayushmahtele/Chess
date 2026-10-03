import { h, toast, fmtDate } from '../dom.js';
import { icon } from '../icons.js';
import { TIME_CONTROLS, BOT_LEVELS, botName } from '../config.js';
import { getPrefs, setPref } from '../prefs.js';
import { isProvisional, ratingsOf } from '../rating.js';
import { session } from '../store/index.js';
import { Game } from '../game.js';
import { startGame, activeGame } from './game-view.js';
import { gameRow } from './history.js';
import { pieceUrl } from '../board.js';

export async function homeView(main, _p, ctx) {
  const P = ctx.profile;
  const last = getPrefs().lastSetup || {};
  const setup = {
    mode: last.mode || 'bot', tc: last.tc || '10+0', color: last.color || 'w',
    botElo: last.botElo || Math.min(2000, Math.max(400, Math.round(ratingsOf(P).computer.rating / 200) * 200)),
    rated: last.rated ?? true,
  };

  const form = h('div');
  function renderForm() {
    form.innerHTML = '';
    const tcGroups = [...new Set(TIME_CONTROLS.map(t => t.group))];
    const isBot = setup.mode === 'bot';
    form.append(...[
      h('div.mode-tabs',
        modeBtn('bot', '🤖', 'Play the computer', 'Rated or casual'),
        modeBtn('local', '👥', 'Two players', 'Pass and play on one device'),
        h('a.mode', { href: '#/online' }, h('span.mi', '🌐'), h('span', h('b', 'Play online'), h('span', 'Friends or quick match')))),
      h('div.field', h('span.lbl', 'Time control'),
        h('div.tc-group', tcGroups.map(g => [h('span.g', g), h('div.chip-group', TIME_CONTROLS.filter(t => t.group === g).map(t =>
          h('button.chip', { 'aria-pressed': String(setup.tc === t.id), on: { click: () => { setup.tc = t.id; renderForm(); } } }, t.label)))]))),
      isBot && h('div.field', h('label', { for: 'elo' }, 'Computer strength'),
        h('div.bot-pick', h('div.elo', setup.botElo), h('div', h('div.nm', botName(setup.botElo)),
          h('small.muted', setup.botElo < 1000 ? 'Makes beginner mistakes' : setup.botElo < 1400 ? 'Sees simple tactics' : setup.botElo < 1800 ? 'Solid club player' : 'Plays its strongest'))),
        h('input.range', { id: 'elo', type: 'range', min: 400, max: 2000, step: 100, value: setup.botElo, on: { input: e => { setup.botElo = +e.target.value; renderFormLight(); } } })),
      isBot && h('div.field', h('span.lbl', 'Play as'),
        h('div.color-pick', [['w', 'White', 'wK'], ['r', 'Random', null], ['b', 'Black', 'bK']].map(([c, label, img]) =>
          h('button', { 'aria-pressed': String(setup.color === c), on: { click: () => { setup.color = c; renderForm(); } } },
            img ? h('img', { src: pieceUrl({ color: img[0], type: img[1].toLowerCase() }, { small: true }), alt: '' }) : h('span', { style: { fontSize: '1.4rem' } }, '🎲'), label)))),
      isBot && h('label.switch', h('span', h('b', 'Rated game'), h('small', setup.rated ? 'Your rating changes. No takebacks, hints or evaluation bar.' : 'Practice freely with takebacks, hints and the evaluation bar.')),
        h('input.toggle', { type: 'checkbox', checked: setup.rated, on: { change: e => { setup.rated = e.target.checked; renderForm(); } } })),
      h('div', { style: { marginTop: '20px' } }, h('button.btn.primary.big', { on: { click: start } }, icon('play'), 'Start game')),
    ].filter(Boolean));
  }
  function renderFormLight() {
    form.querySelector('.bot-pick .elo').textContent = setup.botElo;
    form.querySelector('.bot-pick .nm').textContent = botName(setup.botElo);
  }
  const modeBtn = (m, ic, t, s) => h('button.mode', { 'aria-pressed': String(setup.mode === m), on: { click: () => { setup.mode = m; renderForm(); } } },
    h('span.mi', ic), h('span', h('b', t), h('span', s)));

  async function start() {
    if (activeGame() && activeGame().status === 'playing') {
      toast('Finish or resign your current game first.'); ctx.go('/game'); return;
    }
    setPref('lastSetup', { ...setup });
    const tc = TIME_CONTROLS.find(t => t.id === setup.tc);
    const color = setup.color === 'r' ? (Math.random() < .5 ? 'w' : 'b') : setup.color;
    startGame({ mode: setup.mode, color, botElo: setup.botElo, tc: { id: tc.id, base: tc.base, inc: tc.inc }, rated: setup.mode === 'bot' && setup.rated });
    ctx.go('/game');
  }
  renderForm();

  // side column
  const side = h('div.side-stack');
  const saved = Game.savedGame();
  const owner = session().user?.uid || 'guest';
  if (activeGame()?.status === 'playing') {
    side.append(h('div.card.resume', h('h2', 'Game in progress'), h('p.muted', 'You have an unfinished game.'),
      h('a.btn.primary', { href: '#/game' }, 'Back to the game')));
  } else if (saved && saved.owner === owner) {
    side.append(h('div.card.resume', h('h2', 'Unfinished game'),
      h('p.muted', `${saved.cfg.mode === 'bot' ? 'Against ' + botName(saved.cfg.botElo) + ' (' + saved.cfg.botElo + ')' : 'Two-player game'}, ${saved.moves.length} moves played.`),
      h('div', { style: { display: 'flex', gap: '8px' } },
        h('button.btn.primary', { on: { click: () => { startGame(saved.cfg, saved); ctx.go('/game'); } } }, 'Resume'),
        h('button.btn', { on: { click: () => { Game.discardSaved(); ctx.go('/'); } } }, 'Discard'))));
  }
  const R = ratingsOf(P);
  const tile = id => { const c = { bullet: '⚡ Bullet', blitz: '🔥 Blitz', rapid: '⏱ Rapid', noclock: '♾ No clock', computer: '🤖 vs Computer' }[id];
    return h('a.rtile', { href: '#/profile' }, h('span.rl', c), h('b', R[id].rating, isProvisional(R[id].rd) ? h('span.q', '?') : '')); };
  side.append(h('div.card',
    h('h2', 'Your ratings'),
    h('div.rtiles', ['rapid', 'blitz', 'bullet', 'noclock', 'computer'].map(tile)),
    h('p.muted', { style: { margin: '10px 0 0', fontSize: '.85rem' } }, 'Each type of game has its own rating. Games against the computer change only your 🤖 vs Computer rating.')));

  const recent = h('div.card', h('h2', 'Recent games'), h('p.muted', 'Loading…'));
  side.append(recent);
  session().store.listGames().then(gs => {
    recent.lastChild.remove();
    if (!gs.length) recent.append(h('p.muted', 'Your finished and aborted games will show up here.'));
    else recent.append(h('div.glist', gs.slice(0, 4).map(g => gameRow(g))), h('a.btn.ghost', { href: '#/history', style: { marginTop: '10px' } }, 'See all games'));
  }).catch(e => { recent.lastChild.textContent = 'Could not load games: ' + e.message; });

  main.append(h('div.home',
    h('section.home-hero', h('div.hero-row', h('img.hero-king', { src: '/pieces3d/wood/wK.webp', alt: '' }), h('h1', `Ready to play, ${P.name}?`)), h('p', 'Challenge the computer at your level, play a friend on this device, or take on players online.'), h('div.card', form)),
    side));
}
