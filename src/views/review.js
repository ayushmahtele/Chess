import { h, clear, confirmBox, toast, fmtDate, fmtDuration, modal } from '../dom.js';
import { icon } from '../icons.js';
import { createBoard, positionOf } from '../board.js';
import { Chess } from 'chess.js';
import { session } from '../store/index.js';
import { getPrefs } from '../prefs.js';
import { think } from '../engine-client.js';
import { inBook } from '../engine/engine.js';
import { TIME_CONTROLS } from '../config.js';
import { describeResult } from './game-view.js';
import {
  paintBar, scoreText, barPct, classify, moveAccuracy, winPct,
  MOVE_KINDS, positionSymbol, NOTATION_KEY, POSITION_KEY,
} from '../evalbar.js';

const CACHE = id => 'chessarena:eval:v2:' + id;
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const KIND_ORDER = ['brilliant', 'great', 'best', 'book', 'interesting', 'inaccuracy', 'mistake', 'blunder'];

export async function reviewView(main, [id], ctx) {
  const store = session().store;
  let g;
  try { g = await store.getGame(id); } catch { g = null; }
  if (!g) { main.append(h('div.empty', h('p', 'This game was not found. It may have been deleted.'), h('a.btn', { href: '#/history' }, 'Back to history'))); return; }

  const full = new Chess();
  try { full.loadPgn(g.pgn); } catch { g.moves.forEach(m => full.move(m)); }
  const hv = full.history({ verbose: true });
  let ply = hv.length, orientation = g.color || 'w', bestShown = null, token = 0, alive = true;

  // For every position (0 = start): evaluation (white-positive centipawns) and the engine's best move
  let evals = new Array(hv.length + 1).fill(null);
  let bests = new Array(hv.length + 1).fill(null);
  let deepDone = false;
  try {
    const c = JSON.parse(localStorage.getItem(CACHE(id)));
    if (c?.evals?.length === evals.length) { evals = c.evals; bests = c.bests; deepDone = !!c.deep; }
  } catch {}

  const board = createBoard({ canSelect: () => false, legalFrom: () => [], autoQueen: () => true, onMove: () => {} });
  const evalbar = h('div.evalbar', { 'aria-label': 'Evaluation bar' }, h('div.fill'), h('span.num'));
  const ahead = h('div.ahead', { 'aria-live': 'polite' });
  const graph = h('div.egraph', { title: 'Evaluation through the game. Click to jump to a move.' });
  const progress = h('div.eprog');
  const summary = h('div.esum');
  const moves = h('div.moves');
  const lines = h('div.lines.hidden');
  const nav = h('div.navrow',
    nb('first', 'First move', () => go(0)), nb('back', 'Previous move', () => go(ply - 1)),
    nb('fwd', 'Next move', () => go(ply + 1)), nb('last', 'Last move', () => go(hv.length)));
  function nb(ic, label, fn) { return h('button', { 'aria-label': label, title: label, on: { click: fn } }, icon(ic)); }

  const d = describeResult(g, g);
  const tc = TIME_CONTROLS.find(t => t.id === g.timeControl)?.label || 'No clock';
  const resultSym = g.result === '1/2-1/2' ? '½-½' : g.result;
  const meta = h('dl.meta',
    h('dt', 'Result'), h('dd', `${g.result === '*' ? 'Aborted' : resultSym} · ${d.title}`),
    h('dt', 'Ended by'), h('dd', g.reason),
    h('dt', 'White'), h('dd', g.white), h('dt', 'Black'), h('dd', g.black),
    h('dt', 'Type'), h('dd', `${g.mode === 'bot' ? (g.rated ? 'Rated' : 'Casual') + ' vs computer' : g.mode === 'online' ? (g.rated ? 'Rated' : 'Casual') + ' online' : 'Two players, same device'} · ${tc}`),
    g.ratingAfter != null && [h('dt', 'Rating'), h('dd', `${g.ratingBefore} → ${g.ratingAfter} (${g.ratingAfter - g.ratingBefore >= 0 ? '+' : ''}${g.ratingAfter - g.ratingBefore})`)],
    h('dt', 'Played'), h('dd', `${fmtDate(g.endedAt)} · ${fmtDuration(g.durationMs)}`),
    (g.takebacks || g.hintsUsed) ? [h('dt', 'Help used'), h('dd', `${g.takebacks || 0} takebacks, ${g.hintsUsed || 0} hints`)] : null);

  const A = (ic, label, fn, kind) => h('button.btn', { class: kind || '', on: { click: fn } }, icon(ic), h('span', label));
  const actions = h('div.actions',
    A('bulb', 'Best move', showBest),
    A('flip', 'Flip', () => { orientation = orientation === 'w' ? 'b' : 'w'; render(); }),
    A('copy', 'Copy PGN', async () => { try { await navigator.clipboard.writeText(annotatedPgn()); toast('PGN copied with symbols'); } catch { toast('Copy failed', 'error'); } }),
    A('download', 'Download', () => {
      const a = h('a', { href: URL.createObjectURL(new Blob([annotatedPgn()], { type: 'application/x-chess-pgn' })), download: `game-${new Date(g.endedAt).toISOString().slice(0, 10)}.pgn` });
      document.body.append(a); a.click(); a.remove();
    }),
    A('trash', 'Delete', async () => {
      if (!(await confirmBox('Delete this game?', 'It will be removed from your history.', 'Delete', true))) return;
      await store.deleteGame(id); localStorage.removeItem(CACHE(id)); toast('Game deleted'); ctx.go('/history');
    }, 'danger'),
    h('button.btn', { on: { click: showKey } }, h('span', { style: { fontWeight: 900, fontSize: '1rem' } }, '!?'), h('span', 'Symbols')));

  const panes = { moves: h('div.pane', graph, progress, moves, lines), report: h('div.pane.hidden', summary, h('p.muted.pane-note', 'The report appears when the analysis finishes.')), info: h('div.pane.hidden', meta) };
  const tabBtns = Object.entries({ moves: 'Moves', report: 'Report', info: 'Info' }).map(([k, label]) =>
    h('button', { role: 'tab', 'aria-selected': String(k === 'moves'), on: { click: () => {
      for (const [n, el] of Object.entries(panes)) el.classList.toggle('hidden', n !== k);
      tabBtns.forEach(b => b.setAttribute('aria-selected', String(b === tabBtns.find(x => x.textContent === label))));
      if (k === 'moves') moves.querySelector('.mv.cur')?.scrollIntoView({ block: 'nearest' });
    } } }, label));
  main.append(h('div.review',
    h('div.evalcol', evalbar),
    h('div.board-col', board.el, ahead),
    h('aside.panel', h('div.panel-head', h('b', 'Game review'), h('span.tag', d.title)), h('div.tabs', { role: 'tablist' }, tabBtns),
      panes.moves, panes.report, panes.info, h('div.controls', nav, actions))));

  const sq = i => 'abcdefgh'[i & 7] + ((i >> 3) + 1);
  const posAt = p => p === 0 ? new Chess() : new Chess(hv[p - 1].after);
  const current = () => posAt(ply);
  function go(p) { ply = Math.max(0, Math.min(hv.length, p)); bestShown = null; token++; render(); }

  async function showBest() {
    const t = ++token, c = current();
    if (c.isGameOver()) { toast('The game is over in this position.'); return; }
    toast('Looking for the best move…');
    const r = await think(c, { rating: 2000, timeLimit: 1.5, mode: 'analysis' });
    if (t !== token || !alive) return;
    bestShown = r; render();
  }

  /* ---------- classification ---------- */
  function materialDiff(c) {
    let d = 0; for (const row of c.board()) for (const p of row) if (p) d += (p.color === 'w' ? 1 : -1) * VAL[p.type]; return d;
  }
  // How much material the mover leaves en prise with this move (in pawns), after anything it captured.
  function sacrificed(i) {
    const m = hv[i];
    if (m.piece === 'p' || m.piece === 'k') return 0;
    const after = new Chess(m.after);
    const takers = after.moves({ verbose: true }).filter(x => x.to === m.to);
    if (!takers.length) return 0;
    const cheapest = Math.min(...takers.map(x => VAL[x.piece]));
    const defended = after.isAttacked(m.to, m.color);
    const loss = defended ? VAL[m.piece] - cheapest : VAL[m.piece];
    return loss - (m.captured ? VAL[m.captured] : 0);
  }
  const kinds = [];
  function kindOf(i) {
    if (kinds[i] !== undefined) return kinds[i];
    const m = hv[i];
    const uci = hv.slice(0, i + 1).map(x => x.from + x.to);
    if (i < 20 && hv.slice(0, i + 1).every((_, j) => inBook(uci.slice(0, j + 1)))) return (kinds[i] = 'book');
    if (evals[i] == null || evals[i + 1] == null) return null;
    const q = classify(evals[i], evals[i + 1], m.color);
    const mine = v => m.color === 'w' ? winPct(v) : 100 - winPct(v);
    const sac = sacrificed(i);
    let k = null;
    if (q.drop < 3 && sac >= 2 && mine(evals[i + 1]) >= 50 && mine(evals[i]) < 97) k = 'brilliant';
    else if (q.tag === '??') k = 'blunder';
    else if (q.tag === '?') k = 'mistake';
    else if (sac >= 1 && q.drop >= 3 && q.drop < 10) k = 'interesting';
    else if (q.tag === '?!') k = 'inaccuracy';
    else if (bests[i] && bests[i] === m.from + m.to) {
      const prevBad = i > 0 && evals[i - 1] != null && classify(evals[i - 1], evals[i], hv[i - 1].color).drop >= 20;
      k = prevBad ? 'great' : 'best';
    }
    if (deepDone) kinds[i] = k;
    return k;
  }
  const kic = (k, extra = '') => h('span.kic', { class: MOVE_KINDS[k].cls + extra, title: MOVE_KINDS[k].name }, MOVE_KINDS[k].sym);

  /* ---------- who is ahead ---------- */
  function renderAhead(v) {
    clear(ahead);
    const c = current();
    if (c.isCheckmate()) { ahead.append(h('span.possym', c.turn() === 'w' ? '0-1' : '1-0'), `Checkmate. ${c.turn() === 'w' ? 'Black' : 'White'} wins.`); }
    else if (c.isDraw()) { ahead.append(h('span.possym', '½-½'), 'Draw.'); }
    else if (v == null) ahead.append('Analysing this position…');
    else {
      const ps = positionSymbol(v, materialDiff(c));
      ahead.append(h('span.possym', { title: ps.text }, ps.sym), `${ps.text} (${scoreText(v)})`);
    }
    if (ply > 0) {
      const k = kindOf(ply - 1);
      if (k) ahead.append(h('span.mvq', kic(k), `${hv[ply - 1].san} is a ${MOVE_KINDS[k].name.toLowerCase()}`));
    }
  }

  /* ---------- summary like chess.com ---------- */
  function renderSummary() {
    clear(summary);
    panes.report.querySelector('.pane-note').classList.toggle('hidden', !!hv.length && evals.every(v => v != null));
    if (!hv.length || evals.some(v => v == null)) return;
    const acc = { w: [], b: [] }, cnt = { w: {}, b: {} };
    hv.forEach((m, i) => {
      acc[m.color].push(moveAccuracy(classify(evals[i], evals[i + 1], m.color).drop));
      const k = kindOf(i); if (k) cnt[m.color][k] = (cnt[m.color][k] || 0) + 1;
    });
    const avg = a => a.length ? (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1) : '–';
    summary.append(h('div.ktable',
      h('div.khead', h('span', g.white), h('span'), h('span', g.black)),
      h('div.krow.acc', h('span.l', avg(acc.w)), h('span.m', h('b', 'Accuracy')), h('span.r', avg(acc.b))),
      KIND_ORDER.map(k => h('div.krow', h('span.l', cnt.w[k] || 0), h('span.m', kic(k), MOVE_KINDS[k].name), h('span.r', cnt.b[k] || 0)))));
  }

  function drawGraph() {
    const n = evals.length;
    if (n < 2) { graph.classList.add('hidden'); return; }
    const W = 100 * (n - 1), pts = evals.map((v, i) => `${i * 100},${100 - barPct(v ?? 0)}`).join(' ');
    graph.innerHTML = `<svg viewBox="0 0 ${W} 100" preserveAspectRatio="none" aria-hidden="true">
      <rect class="bk" x="0" y="0" width="${W}" height="100"/>
      <polygon class="wh" points="0,100 ${pts} ${W},100"/>
      <line class="mid" x1="0" x2="${W}" y1="50" y2="50"/>
      <line class="cur" x1="${ply * 100}" x2="${ply * 100}" y1="0" y2="100"/></svg>`;
    const dots = h('div.dots');
    hv.forEach((m, i) => {
      const k = kindOf(i); if (!['brilliant', 'great', 'mistake', 'blunder'].includes(k)) return;
      dots.append(h('i', { class: MOVE_KINDS[k].cls, style: { background: 'var(--k)', left: ((i + 1) / (n - 1) * 100) + '%', top: (100 - barPct(evals[i + 1])) + '%' } }));
    });
    graph.append(dots);
  }
  graph.addEventListener('click', e => {
    const r = graph.getBoundingClientRect();
    go(Math.round((e.clientX - r.left) / r.width * (evals.length - 1)));
  });

  /* ---------- PGN with symbols (e.g. "12. Nxe5!! Qd7?") ---------- */
  function annotatedPgn() {
    const c = new Chess();
    try { c.loadPgn(g.pgn); } catch {}
    const headers = c.getHeaders ? c.getHeaders() : c.header();
    const head = Object.entries(headers).map(([k, v]) => `[${k} "${v}"]`).join('\n');
    const suffix = { brilliant: '!!', great: '!', interesting: '!?', inaccuracy: '?!', mistake: '?', blunder: '??' };
    let body = '';
    hv.forEach((m, i) => {
      if (m.color === 'w') body += `${i / 2 + 1}. `;
      body += m.san + (suffix[kindOf(i)] || '') + ' ';
    });
    return `${head}\n\n${body}${g.result}\n`;
  }

  function showKey() {
    const table = rows => h('table', h('tbody', rows.map(([a, b]) => h('tr', h('td', a), h('td', b)))));
    modal({
      title: 'Symbols', className: 'keymodal',
      body: h('div',
        h('h3', 'Move quality'),
        h('table', h('tbody', KIND_ORDER.map(k => h('tr', h('td', kic(k)), h('td', h('b', MOVE_KINDS[k].name), h('div.muted', MOVE_KINDS[k].about)))))),
        h('h3', 'Position'), table(POSITION_KEY),
        h('h3', 'Notation'), table(NOTATION_KEY)),
      actions: [{ label: 'Close', value: true, kind: 'primary' }],
    });
  }

  function render() {
    const c = current(), p = getPrefs();
    let check = null;
    if (c.inCheck()) for (const row of c.board()) for (const x of row) if (x && x.type === 'k' && x.color === c.turn()) check = x.square;
    const k = ply > 0 ? kindOf(ply - 1) : null;
    board.set({ position: positionOf(c), orientation, lastMove: ply ? [hv[ply - 1].from, hv[ply - 1].to] : null, check,
      hint: bestShown?.move ? [sq(bestShown.move[0]), sq(bestShown.move[1])] : null,
      badge: k ? { sq: hv[ply - 1].to, cls: MOVE_KINDS[k].cls, sym: MOVE_KINDS[k].sym, title: MOVE_KINDS[k].name } : null,
      theme: p.boardTheme, showCoords: p.coords, showLast: p.highlightLast, animate: p.animate, interactive: false });

    clear(moves);
    for (let i = 0; i < hv.length; i += 2) {
      const mk = j => {
        if (!hv[j]) return h('span');
        const kk = kindOf(j);
        return h('button.mv', { class: ply === j + 1 ? 'cur' : '', title: kk ? MOVE_KINDS[kk].name : '', on: { click: () => go(j + 1) } },
          kk ? kic(kk) : null, hv[j].san);
      };
      moves.append(h('div.mrow', h('span.no', i / 2 + 1 + '.'), mk(i), mk(i + 1)));
    }
    if (!hv.length) moves.append(h('p.muted', { style: { padding: '8px 16px', margin: 0 } }, 'No moves were played.'));
    moves.append(h('div.mres', g.result === '*' ? 'Game aborted' : `${resultSym}  (${g.reason})`));
    moves.querySelector('.mv.cur')?.scrollIntoView({ block: 'nearest' });

    nav.children[0].disabled = nav.children[1].disabled = ply === 0;
    nav.children[2].disabled = nav.children[3].disabled = ply === hv.length;
    lines.classList.toggle('hidden', !bestShown);
    if (bestShown) clear(lines).append(...bestShown.lines.map(([v, m]) => h('div', `${typeof v === 'string' ? v : scoreText(v)}  ${sq(m[0])}${sq(m[1])}`)));

    const v = bestShown ? bestShown.eval : evals[ply];
    paintBar(evalbar, v, orientation);
    evalbar.classList.toggle('pending', v == null);
    renderAhead(v);
    drawGraph(); renderSummary();
  }

  /* ---------- analyse the whole game in the background ---------- */
  function terminal(c) {
    if (c.isCheckmate()) return c.turn() === 'w' ? -100000 : 100000;
    if (c.isDraw()) return 0;
    return null;
  }
  async function analyseAll() {
    if (deepDone && evals.every(v => v != null)) return;
    const todo = evals.map((v, i) => v == null ? i : -1).filter(i => i >= 0);
    todo.sort((a, b) => (b === ply) - (a === ply));
    let done = evals.length - todo.length;
    for (const i of todo) {
      if (!alive) return;
      progress.textContent = `Analysing the game… ${Math.round(done / evals.length * 100)}%`;
      const c = posAt(i);
      let v = terminal(c), best = null;
      if (v === null) {
        const r = await think(c, { rating: 2000, timeLimit: 0.35, mode: 'analysis' });
        v = r.eval; best = r.move ? sq(r.move[0]) + sq(r.move[1]) : null;
      }
      if (!alive) return;
      evals[i] = v; bests[i] = best; done++;
      render();
    }
    // Second pass: look deeper at sacrifices and suspected mistakes so tactics aren't misjudged
    if (!deepDone) {
      const deep = new Set();
      hv.forEach((m, i) => {
        if (classify(evals[i], evals[i + 1], m.color).drop >= 10 || sacrificed(i) >= 1) { deep.add(i); deep.add(i + 1); }
      });
      let n = 0;
      for (const i of deep) {
        if (!alive) return;
        progress.textContent = `Double-checking key moves… ${n}/${deep.size}`;
        const c = posAt(i);
        if (terminal(c) === null) {
          const r = await think(c, { rating: 2000, timeLimit: 1.6, mode: 'analysis' });
          if (!alive) return;
          evals[i] = r.eval; bests[i] = r.move ? sq(r.move[0]) + sq(r.move[1]) : bests[i];
        }
        n++; kinds.length = 0; render();
      }
      deepDone = true;
    }
    progress.textContent = '';
    kinds.length = 0;
    try { localStorage.setItem(CACHE(id), JSON.stringify({ evals, bests, deep: true })); } catch {}
    render();
  }

  const onKey = e => {
    if (document.querySelector('.modal-wrap')) return;
    if (e.key === 'ArrowLeft') go(ply - 1); else if (e.key === 'ArrowRight') go(ply + 1);
    else if (e.key === 'ArrowUp') go(0); else if (e.key === 'ArrowDown') go(hv.length); else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  render();
  analyseAll();
  return () => { alive = false; token++; document.removeEventListener('keydown', onKey); };
}
