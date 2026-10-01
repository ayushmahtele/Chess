import { h, clear, modal, confirmBox, toast, fmtClock } from '../dom.js';
import { icon } from '../icons.js';
import { createBoard, positionOf, pieceUrl } from '../board.js';
import { Chess } from 'chess.js';
import { Game } from '../game.js';
import { getPrefs } from '../prefs.js';
import { botName } from '../config.js';
import { isProvisional } from '../rating.js';
import { session } from '../store/index.js';
import { paintBar, scoreText } from '../evalbar.js';
import { avatar as makeAvatar } from '../avatar.js';

let game = null;
export const activeGame = () => game;
export function startGame(cfg, restore) {
  if (game) game.destroy();
  game = new Game(cfg, restore);
  game._fresh = true;
}

const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 };
function material(pos) {
  const start = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const cnt = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  for (const p of Object.values(pos)) if (p.type !== 'k') cnt[p.color][p.type]++;
  const lost = c => Object.entries(start).flatMap(([t, n]) => Array(Math.max(0, n - cnt[c][t])).fill(t)).sort((a, b) => VALUES[b] - VALUES[a]);
  const score = c => Object.entries(cnt[c]).reduce((s, [t, n]) => s + n * VALUES[t], 0);
  return { lostW: lost('w'), lostB: lost('b'), diff: score('w') - score('b') };
}

export async function gameView(main, _p, ctx) {
  if (!game) {
    const saved = Game.savedGame();
    if (saved && saved.owner === (session().user?.uid || 'guest')) startGame(saved.cfg, saved);
    else { ctx.go('/'); return; }
  }
  const G = game;
  const P = ctx.profile;
  const prefs = getPrefs();
  let viewPly = null;              // null = live position
  let orientation = G.isBot ? G.cfg.color : (prefs.autoFlip ? G.turn : 'w');
  let manualFlip = false;

  const board = createBoard({
    canSelect: (sq, p) => viewPly === null && G.humanToMove && p.color === G.turn,
    legalFrom: sq => G.legalFrom(sq),
    autoQueen: () => getPrefs().autoQueen,
    onMove: (from, to, promo) => { G.move(from, to, promo); },
  });

  // ---------- layout ----------
  const evalbar = h('div.evalbar', h('div.fill'), h('span.num'));
  const pbar = () => h('div.pbar', h('div.who', h('span.avatar'), h('div', { style: { minWidth: 0 } }, h('div', h('span.name'), ' ', h('span.rt')), h('div.caps'))), h('div.clock'));
  const topBar = pbar(), botBar = pbar();
  const status = h('div.status-line');
  const moves = h('div.moves', { role: 'list', 'aria-label': 'Moves' });
  const lines = h('div.lines');
  const nav = h('div.navrow',
    navBtn('first', 'First move', () => setView(0)), navBtn('back', 'Previous move', () => step(-1)),
    navBtn('fwd', 'Next move', () => step(1)), navBtn('last', 'Latest move', () => setView(null)));
  const actions = h('div.actions');
  const tcLabel = G.cfg.tc?.base ? `${G.cfg.tc.base / 60} min${G.cfg.tc.inc ? ' + ' + G.cfg.tc.inc + 's' : ''}` : 'No clock';
  const panel = h('aside.panel',
    h('div.panel-head', h('b', G.isBot ? `vs ${botName(G.cfg.botElo)}` : 'Two players'),
      h('span', h('span.tag', tcLabel), ' ', G.isBot && h('span.tag', { class: G.cfg.rated ? 'rated' : '' }, G.cfg.rated ? 'Rated' : 'Casual'))),
    status, moves, lines, h('div.controls', nav, actions));
  main.append(h('div.game', evalbar, h('div.board-col', topBar, board.el, botBar), panel));

  function navBtn(ic, label, fn) { return h('button', { 'aria-label': label, title: label, on: { click: fn } }, icon(ic)); }

  // ---------- helpers ----------
  const hist = () => G.chess.history({ verbose: true });
  function positionAt(ply) {
    const hv = hist();
    if (ply === null || ply >= hv.length) return { chess: G.chess, last: hv.length ? [hv.at(-1).from, hv.at(-1).to] : null };
    const c = new Chess(ply === 0 ? undefined : hv[ply - 1].after);
    return { chess: c, last: ply ? [hv[ply - 1].from, hv[ply - 1].to] : null };
  }
  function setView(p) {
    const n = G.plies;
    viewPly = p === null || p >= n ? null : Math.max(0, p);
    board.clearSelection(); render();
  }
  function step(d) { const cur = viewPly ?? G.plies; setView(cur + d); }

  function kingSq(chess) {
    if (!chess.inCheck()) return null;
    for (const row of chess.board()) for (const p of row) if (p && p.type === 'k' && p.color === chess.turn()) return p.square;
    return null;
  }

  function fillBar(el, color, pos) {
    const [avatar, info] = el.querySelector('.who').children;
    const nameEl = info.querySelector('.name'), rtEl = info.querySelector('.rt'), capsEl = info.querySelector('.caps');
    const isHuman = !G.isBot || color === G.cfg.color;
    if (G.isBot) {
      if (isHuman) {
        avatar.replaceWith(makeAvatar(P, session().user));
        nameEl.textContent = P.name; rtEl.textContent = `(${P.rating}${isProvisional(P.rd) ? '?' : ''})`;
      } else {
        avatar.textContent = '🤖'; nameEl.textContent = botName(G.cfg.botElo); rtEl.textContent = `(${G.cfg.botElo})`;
      }
    } else {
      avatar.textContent = color === 'w' ? '♔' : '♚'; nameEl.textContent = color === 'w' ? 'White' : 'Black'; rtEl.textContent = '';
    }
    const m = material(pos);
    const taken = color === 'w' ? m.lostB : m.lostW;
    const adv = color === 'w' ? m.diff : -m.diff;
    clear(capsEl).append(...taken.map(t => h('img', { src: pieceUrl({ color: color === 'w' ? 'b' : 'w', type: t }, { small: true }), alt: '' })), adv > 0 ? h('span.adv', '+' + adv) : '');
    const think = el.querySelector('.thinking'); if (think) think.remove();
    if (G.thinking && !isHuman && G.status === 'playing') info.append(h('div.thinking', 'Thinking…'));
    const clk = el.querySelector('.clock');
    clk.classList.toggle('hidden', !G.clock);
  }

  function renderClocks() {
    const c = G.clockNow(); if (!c) return;
    const bottom = orientation, top = bottom === 'w' ? 'b' : 'w';
    for (const [el, col] of [[topBar, top], [botBar, bottom]]) {
      const clk = el.querySelector('.clock');
      clk.textContent = fmtClock(c[col]);
      clk.classList.toggle('active', G.status === 'playing' && G.turn === col && G.plies >= 2);
      clk.classList.toggle('low', c[col] < 20000);
    }
  }

  function renderMoves() {
    clear(moves);
    const hv = hist(), cur = viewPly ?? hv.length;
    for (let i = 0; i < hv.length; i += 2) {
      const mk = j => hv[j] ? h('button.mv', { class: cur === j + 1 ? 'cur' : '', on: { click: () => setView(j + 1) } }, hv[j].san) : h('span');
      moves.append(h('div.mrow', { role: 'listitem' }, h('span.no', i / 2 + 1 + '.'), mk(i), mk(i + 1)));
    }
    if (!hv.length) moves.append(h('p.muted', { style: { padding: '8px 16px', margin: 0 } }, G.isBot && G.cfg.color === 'b' ? 'The computer plays first.' : 'Make your first move.'));
    const curEl = moves.querySelector('.mv.cur');
    if (viewPly === null) moves.scrollTop = moves.scrollHeight; else curEl?.scrollIntoView({ block: 'nearest' });
  }

  function statusText() {
    if (G.status === 'over') {
      const r = G.result; return describeResult(r, G).title + ` (${r.reason})`;
    }
    if (viewPly !== null) return `Viewing move ${viewPly} of ${G.plies}. Press the last-move button to return.`;
    if (G.thinking) return 'The computer is thinking…';
    const side = G.turn === 'w' ? 'White' : 'Black';
    const check = G.chess.inCheck() ? ' Check!' : '';
    if (G.isBot) return (G.turn === G.cfg.color ? 'Your move.' : 'Waiting for the computer.') + check;
    return `${side} to move.${check}`;
  }

  function renderActions() {
    clear(actions);
    const A = (ic, label, fn, opts = {}) => h('button.btn', { disabled: opts.disabled, class: opts.kind || '', title: label, on: { click: fn } }, icon(ic), h('span', label));
    if (G.status === 'playing') {
      const casual = !G.cfg.rated;
      actions.append(
        A('flip', 'Flip', () => { orientation = orientation === 'w' ? 'b' : 'w'; manualFlip = true; render(); }),
        A('undo', 'Takeback', () => { if (G.takeback()) { viewPly = null; } }, { disabled: !casual || !G.plies || G.thinking }),
        A('bulb', 'Hint', async () => { const hnt = await G.getHint(); if (!hnt) toast('No hint available right now.'); }, { disabled: !casual || !G.humanToMove || viewPly !== null }),
        A('half', 'Offer draw', offerDraw, { disabled: G.plies < 2 }),
        G.canAbort() ? A('x', 'Abort', abort) : A('flag', 'Resign', resign, { kind: 'danger' }),
        A('board', 'New game', newGame),
      );
    } else {
      actions.append(
        A('flip', 'Flip', () => { orientation = orientation === 'w' ? 'b' : 'w'; render(); }),
        A('undo', 'Rematch', rematch, { kind: 'primary' }),
        A('board', 'New game', () => { game = null; ctx.go('/'); }),
      );
    }
  }

  function renderEval() {
    const show = (G.isBot && !G.cfg.rated && prefs.evalBar) || (G.status === 'over' && G.isBot);
    evalbar.style.visibility = show ? 'visible' : 'hidden';
    if (show) paintBar(evalbar, G.evalScore, orientation);
  }

  function renderLines() {
    const show = G.isBot && (!G.cfg.rated || G.status === 'over') && G.lines.length;
    lines.classList.toggle('hidden', !show);
    if (!show) return;
    clear(lines).append(...G.lines.map(([v, m]) => {
      const mv = idx(m[0]) + idx(m[1]);
      const sc = typeof v === 'string' ? v : scoreText(v);
      return h('div', `${sc}  ${mv}`);
    }));
  }
  const idx = i => 'abcdefgh'[i & 7] + ((i >> 3) + 1);

  function render(anim) {
    if (!G.isBot && prefs.autoFlip && !manualFlip && G.status === 'playing') orientation = G.turn;
    const { chess, last } = positionAt(viewPly);
    const pos = positionOf(chess);
    const p = getPrefs();
    board.set({
      position: pos, orientation, lastMove: last, check: kingSq(chess),
      interactive: viewPly === null && G.humanToMove,
      hint: viewPly === null ? G.hint : null,
      theme: p.boardTheme, showCoords: p.coords, showHints: p.legalHints, showLast: p.highlightLast, animate: p.animate,
    }, anim);
    const bottom = orientation, top = bottom === 'w' ? 'b' : 'w';
    fillBar(topBar, top, pos); fillBar(botBar, bottom, pos);
    renderClocks(); renderMoves(); renderActions(); renderEval(); renderLines();
    status.textContent = statusText();
    nav.children[0].disabled = nav.children[1].disabled = (viewPly ?? G.plies) === 0;
    nav.children[2].disabled = nav.children[3].disabled = viewPly === null;
  }

  // ---------- actions ----------
  async function resign() {
    if (getPrefs().confirmResign && !(await confirmBox('Resign this game?', G.isBot ? 'The game counts as a loss.' : `${G.turn === 'w' ? 'White' : 'Black'} resigns.`, 'Resign', true))) return;
    G.resign();
  }
  async function abort() {
    if (await confirmBox('Abort this game?', 'Aborted games are saved to your history but never change your rating.', 'Abort', true)) G.abort();
  }
  async function offerDraw() {
    if (G.isBot) {
      if (!G.offerDraw()) toast('The computer declined your draw offer.');
    } else {
      const side = G.turn === 'w' ? 'Black' : 'White';
      const ok = await confirmBox('Draw offered', `${G.turn === 'w' ? 'White' : 'Black'} offers a draw. ${side}, do you accept?`, 'Accept draw');
      if (ok) G.offerDraw(); else toast('Draw declined.');
    }
  }
  async function newGame() {
    if (G.status === 'playing' && G.plies > 0) {
      if (!(await confirmBox('Leave this game?', G.canAbort() ? 'This game will be aborted.' : (G.isBot ? 'You will resign this game.' : 'The current player resigns.'), 'Leave game', true))) return;
      if (G.canAbort()) G.abort(); else G.resign();
    } else if (G.status === 'playing') G.abort();
    game = null; ctx.go('/');
  }
  function rematch() {
    const cfg = { ...G.cfg };
    if (cfg.mode === 'bot') cfg.color = cfg.color === 'w' ? 'b' : 'w';
    startGame(cfg); ctx.go('/game');
  }

  async function showOver() {
    const r = G.result;
    const d = describeResult(r, G);
    const ratingEl = h('div');
    const body = h('div', h('p', `${d.sub} by ${r.reason}.`), ratingEl);
    const fillRating = () => {
      clear(ratingEl);
      if (r.saveError) ratingEl.append(h('p', { style: { color: 'var(--red)' } }, 'Could not save this game: ' + r.saveError));
      else if (!r.saved) ratingEl.append(h('p.muted', 'Saving game…'));
      else if (r.ratingAfter != null) {
        const delta = r.ratingAfter - r.ratingBefore;
        ratingEl.append(h('div.big-r', r.ratingAfter, ' ', h('span.delta', { class: delta >= 0 ? 'up' : 'down', style: { fontSize: '1.3rem' } }, (delta >= 0 ? '+' : '') + delta)), h('p.muted', 'New rating'));
      } else ratingEl.append(h('p.muted', r.outcome === 'aborted' ? 'Saved to your history. Rating unchanged.' : 'Saved to your history.'));
    };
    fillRating();
    const off = G.on(ev => { if (ev.type === 'saved') { fillRating(); ctx.refreshProfile(); } });
    const choice = await modal({ title: d.title, body, className: 'over-modal',
      actions: [{ label: 'Review', value: 'review' }, { label: 'New game', value: 'new' }, { label: 'Rematch', value: 'rematch', kind: 'primary' }] });
    off();
    if (choice === 'rematch') rematch();
    else if (choice === 'new') { game = null; ctx.go('/'); }
    else if (choice === 'review') {
      if (r.saved && r.id) { game = null; ctx.go('/review/' + r.id); }
      else setView(0);
    }
  }

  // ---------- wire up ----------
  const off = G.on(ev => {
    if (ev.type === 'clock') { renderClocks(); return; }
    if (ev.type === 'move') { if (viewPly !== null) viewPly = null; render([ev.move.from, ev.move.to]); return; }
    if (ev.type === 'over') { render(); showOver(); return; }
    if (ev.type === 'saved') { renderActions(); return; }
    render();
  });
  const onKey = e => {
    if (e.target.closest('input,textarea,select') || document.querySelector('.modal-wrap')) return;
    if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { step(1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setView(0); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { setView(null); e.preventDefault(); }
    else if (e.key === 'f') { orientation = orientation === 'w' ? 'b' : 'w'; manualFlip = true; render(); }
  };
  document.addEventListener('keydown', onKey);
  render();
  if (G._fresh) { G._fresh = false; G.start(); }
  else if (G.status === 'over') { /* already finished */ }
  else G._maybeBot();

  return () => { off(); document.removeEventListener('keydown', onKey); };
}

export function describeResult(r, g) {
  const o = r.outcome;
  if (o === 'aborted') return { title: 'Game aborted', sub: 'Nobody won' };
  if (o === 'draw') return { title: 'Draw', sub: 'The game is drawn' };
  if (o === 'win') return { title: 'You won!', sub: 'You won' };
  if (o === 'loss') return { title: 'You lost', sub: g.mode === 'online' ? `@${g.opponent} won` : `${botName(g.cfg?.botElo ?? g.botElo)} won` };
  return { title: o === 'white' ? 'White wins' : 'Black wins', sub: o === 'white' ? 'White won' : 'Black won' };
}
