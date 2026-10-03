import { h, clear, modal, confirmBox, toast, fmtClock } from '../dom.js';
import { icon } from '../icons.js';
import { createBoard, positionOf, pieceUrl } from '../board.js';
import { getPrefs } from '../prefs.js';
import { sfx } from '../audio/sfx.js';
import { TIME_CONTROLS } from '../config.js';
import { session, friendlyError } from '../store/index.js';
import { isProvisional, previewChange, signed } from '../rating.js';
import * as O from '../online.js';

const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const QUICK = ['Good luck!', 'Have fun!', 'Nice move!', 'Good game!', 'Thanks!', 'Oops'];

export async function onlineGameView(main, [id], ctx) {
  const { user, db } = session();
  if (!user) { main.append(h('div.onb', h('h1', 'Sign in to play'), h('p.muted', 'You need an account to join online games.'), h('a.btn.primary', { href: '#/login' }, 'Sign in'))); return; }
  const P = ctx.profile;
  let g = null, pending = null, viewPly = null, orientation = 'w', manualFlip = false;
  let lastMoves = -1, shownOver = false, saved = null, saving = false, lastClaim = 0, alive = true, prevStatus = null;

  const board = createBoard({
    canSelect: (sq, p) => isMyTurn() && viewPly === null && p.color === myColor(),
    legalFrom: sq => isMyTurn() && viewPly === null ? position().moves({ square: sq, verbose: true }) : [],
    autoQueen: () => getPrefs().autoQueen,
    onMove: (from, to, promo) => play(from, to, promo),
  });
  const pbar = () => h('div.pbar', h('div.who', h('span.avatar'), h('div', { style: { minWidth: 0 } }, h('div', h('span.name'), ' ', h('span.rt')), h('div.caps'))), h('div.clock'));
  const topBar = pbar(), botBar = pbar();
  const head = h('div.panel-head');
  const status = h('div.status-line');
  const banner = h('div.banners');
  const moves = h('div.moves', { role: 'list', 'aria-label': 'Moves' });
  const chatLog = h('div.chat-log', { 'aria-live': 'polite' });
  const chatIn = h('input.text-in', { placeholder: 'Message…', maxlength: 140, 'aria-label': 'Chat message' });
  const chat = h('div.chat', chatLog, h('div.quick', QUICK.map(q => h('button.chip', { on: { click: () => say(q) } }, q))),
    h('form.chat-form', { on: { submit: e => { e.preventDefault(); say(chatIn.value); chatIn.value = ''; } } }, chatIn, h('button.btn', { type: 'submit' }, 'Send')));
  const nav = h('div.navrow',
    nb('first', 'First move', () => setView(0)), nb('back', 'Previous move', () => step(-1)),
    nb('fwd', 'Next move', () => step(1)), nb('last', 'Latest move', () => setView(null)));
  const actions = h('div.actions');
  const waitBox = h('div');
  const gameBox = h('div.game.online', h('div.board-col', topBar, board.el, botBar),
    h('aside.panel', head, status, banner, moves, chat, h('div.controls', nav, actions)));
  main.append(waitBox, gameBox);
  function nb(ic, label, fn) { return h('button', { 'aria-label': label, title: label, on: { click: fn } }, icon(ic)); }

  /* ---------- helpers ---------- */
  const myColor = () => g ? O.colorOf(g) : null;
  const oppId = () => g ? O.opponentOf(g) : null;
  const allMoves = () => g ? (pending ? [...g.moves, pending] : g.moves) : [];
  const turn = () => allMoves().length % 2 === 0 ? 'w' : 'b';
  const isMyTurn = () => g?.status === 'active' && !pending && turn() === myColor();
  function position(ply = null) { const ms = allMoves(); return O.replay(ply === null ? ms : ms.slice(0, ply)); }
  function setView(p) { const n = allMoves().length; viewPly = p === null || p >= n ? null : Math.max(0, p); board.clearSelection(); render(); }
  function step(d) { setView((viewPly ?? allMoves().length) + d); }

  async function play(from, to, promotion) {
    if (!isMyTurn()) return;
    const ply = g.moves.length;
    const c = position();
    let m; try { m = c.move({ from, to, promotion }); } catch { sfx.illegal(); return; }
    pending = m.from + m.to + (m.promotion || '');
    moveSound(m, c); render([from, to]);
    try { await O.sendMove(id, ply, from, to, promotion); }
    catch (e) { pending = null; toast(friendlyError(e), 'error'); render(); }
  }
  function moveSound(m, c) {
    if (c.inCheck()) sfx.check(); else if (m.flags.includes('k') || m.flags.includes('q')) sfx.castle();
    else if (m.flags.includes('p')) sfx.promote(); else if (m.captured) sfx.capture(); else sfx.move();
  }
  async function say(text) { text = String(text || '').trim(); if (!text || !g) return; try { await O.sendChat(id, text); } catch (e) { toast(friendlyError(e), 'error'); } }

  /* ---------- rendering ---------- */
  function material(pos) {
    const start = { p: 8, n: 2, b: 2, r: 2, q: 1 }, cnt = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
    for (const p of Object.values(pos)) if (p.type !== 'k') cnt[p.color][p.type]++;
    const lost = c => Object.entries(start).flatMap(([t, n]) => Array(Math.max(0, n - cnt[c][t])).fill(t)).sort((a, b) => VALUES[b] - VALUES[a]);
    const score = c => Object.entries(cnt[c]).reduce((s, [t, n]) => s + n * VALUES[t], 0);
    return { lostW: lost('w'), lostB: lost('b'), diff: score('w') - score('b') };
  }
  function fillBar(el, color, pos) {
    const pid = color === 'w' ? g.white : g.black, info = g.p[pid] || {};
    const who = el.querySelector('.who'), av = who.firstChild;
    const newAv = info.photo ? h('img.avatar', { src: info.photo, alt: '', referrerpolicy: 'no-referrer' }) : h('span.avatar', (info.name || '?')[0].toUpperCase());
    av.replaceWith(newAv);
    const away = pid !== user.uid && g.status === 'active' && (g.lastSeen?.[pid] || 0) < db.now() - 30000;
    who.querySelector('.name').textContent = `${info.name || '?'} @${info.username || ''}`;
    who.querySelector('.rt').textContent = `(${info.rating}${isProvisional(info.rd) ? '?' : ''})${away ? ' · away' : ''}`;
    const m = material(pos), taken = color === 'w' ? m.lostB : m.lostW, adv = color === 'w' ? m.diff : -m.diff;
    clear(who.querySelector('.caps')).append(...taken.map(t => h('img', { src: pieceUrl({ color: color === 'w' ? 'b' : 'w', type: t }, { small: true }), alt: '' })), adv > 0 ? h('span.adv', '+' + adv) : '');
    el.querySelector('.clock').classList.toggle('hidden', !g.clock);
  }
  function renderClocks() {
    if (!g?.clock) return;
    const c = O.clocks(g);
    for (const [el, col] of [[topBar, orientation === 'w' ? 'b' : 'w'], [botBar, orientation]]) {
      const clk = el.querySelector('.clock');
      clk.textContent = fmtClock(Math.max(0, c[col]));
      clk.classList.toggle('active', g.status === 'active' && turn() === col && g.moves.length >= 2);
      clk.classList.toggle('low', c[col] < 20000);
    }
  }
  function renderMoves() {
    clear(moves);
    const ms = allMoves(); if (!ms.length) { moves.append(h('p.muted', { style: { padding: '8px 16px', margin: 0 } }, g.status === 'active' ? (myColor() === 'w' ? 'You play White. Make the first move.' : 'You play Black. White moves first.') : '')); return; }
    const hist = position().history({ verbose: true }), cur = viewPly ?? ms.length;
    for (let i = 0; i < hist.length; i += 2) {
      const mk = j => hist[j] ? h('button.mv', { class: cur === j + 1 ? 'cur' : '', on: { click: () => setView(j + 1) } }, hist[j].san) : h('span');
      moves.append(h('div.mrow', h('span.no', i / 2 + 1 + '.'), mk(i), mk(i + 1)));
    }
    if (g.status === 'over') moves.append(h('div.mres', g.result === '*' ? 'Game aborted' : `${g.result === '1/2-1/2' ? '½-½' : g.result}  (${g.reason})`));
    if (viewPly === null) moves.scrollTop = moves.scrollHeight; else moves.querySelector('.mv.cur')?.scrollIntoView({ block: 'nearest' });
  }
  function renderChat() {
    const list = (g.chat || []).slice(-40);
    clear(chatLog);
    if (!list.length) chatLog.append(h('p.muted', { style: { margin: 0 } }, 'Say hi to your opponent.'));
    for (const c of list) chatLog.append(h('div.msg', { class: c.u === user.uid ? 'mine' : '' }, h('b', c.u === user.uid ? 'You' : '@' + (g.p[c.u]?.username || '?')), ' ', c.m));
    chatLog.scrollTop = chatLog.scrollHeight;
    chat.classList.toggle('hidden', g.players.length < 2);
  }
  function outcomeFor() {
    if (g.result === '*') return 'aborted'; if (g.result === '1/2-1/2') return 'draw';
    return (g.result === '1-0') === (myColor() === 'w') ? 'win' : 'loss';
  }
  const TITLES = { win: 'You won!', loss: 'You lost', draw: 'Draw', aborted: 'Game aborted' };
  function statusText() {
    if (g.status === 'over') return `${TITLES[outcomeFor()]} (${g.reason})`;
    if (viewPly !== null) return `Viewing move ${viewPly} of ${allMoves().length}.`;
    const check = position().inCheck() ? ' Check!' : '';
    if (g.moves.length < 2 && g.status === 'active') {
      const left = Math.max(0, Math.ceil((60000 - (db.now() - (g.lastMoveAt || g.startedAt || db.now()))) / 1000));
      return (isMyTurn() ? `Your move. You have ${left}s to make your first move.` : `Waiting for @${g.p[oppId()]?.username} to move (${left}s).`) + check;
    }
    return (turn() === myColor() ? 'Your move.' : `Waiting for @${g.p[oppId()]?.username}…`) + check;
  }
  function renderBanners() {
    clear(banner);
    if (g.status === 'active') {
      if (g.drawOffer && g.drawOffer !== user.uid) banner.append(h('div.banner', h('span', `@${g.p[g.drawOffer]?.username} offers a draw.`),
        h('button.btn', { on: { click: () => O.declineDraw(id) } }, 'Decline'), h('button.btn.primary', { on: { click: () => O.acceptDraw(id) } }, 'Accept')));
      if (g.drawOffer === user.uid) banner.append(h('div.banner', h('span', 'You offered a draw. Waiting for an answer…')));
      const opp = oppId(), seen = g.lastSeen?.[opp] || 0, gone = db.now() - seen, grace = O.leaveGrace(g);
      if (gone > 30000) {
        const canClaim = gone >= grace, left = Math.ceil((grace - gone) / 1000);
        const wait = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        banner.append(h('div.banner.warn', h('span', canClaim ? `@${g.p[opp]?.username} left the game.`
            : `@${g.p[opp]?.username} seems to be disconnected. ` + (g.moves.length < 2 ? 'The game is cancelled if no first move is played.' : `You can claim the win in ${wait}` + (g.clock ? ' (or when their clock runs out).' : '.'))),
          canClaim && h('button.btn.primary', { on: { click: () => O.claimAbandoned(id) } }, g.moves.length < 2 ? 'Abort game' : 'Claim the win')));
      }
      // what's at stake, like chess.com shows before the game
      if (g.rated && g.moves.length < 2 && g.p[opp]) {
        const pv = previewChange(O.onlineRating(P, g.tcId), g.p[opp].rating, g.p[opp].rd || 200);
        banner.append(h('div.banner.note.rate-preview', h('span.muted', `Rated vs ${g.p[opp].rating}:`),
          h('span.pv.win', 'Win ', h('b', signed(pv.win))), h('span.pv.draw', 'Draw ', h('b', signed(pv.draw))), h('span.pv.loss', 'Loss ', h('b', signed(pv.loss)))));
      }
      // phones pause this page as soon as you switch apps: say so before the game gets going
      if (g.moves.length < 4 && matchMedia('(pointer: coarse)').matches) banner.append(h('div.banner.note', h('span',
        `Stay on this page during the game. If you leave for more than ${O.leaveGrace(g) / 60000} minutes, your opponent can claim the win.`)));
    }
    if (g.status === 'over' && g.rematch?.id && g.rematch.by !== user.uid) banner.append(h('div.banner', h('span', `@${g.p[g.rematch.by]?.username} wants a rematch.`),
      h('button.btn.primary', { on: { click: async () => { try { await O.joinGame(g.rematch.id, P); ctx.go('/play/' + g.rematch.id); } catch (e) { toast(friendlyError(e), 'error'); } } } }, 'Accept rematch')));
    if (g.status === 'over' && g.rematch?.id && g.rematch.by === user.uid) banner.append(h('div.banner', h('span', 'Rematch offered.'), h('a.btn', { href: '#/play/' + g.rematch.id }, 'Open')));
    if (g.status === 'over' && saved) {
      if (saved.ratingAfter != null) { const dlt = saved.ratingAfter - saved.ratingBefore; banner.append(h('div.banner', h('span', `Online rating: ${saved.ratingAfter} `, h('span.delta', { class: dlt >= 0 ? 'up' : 'down' }, (dlt >= 0 ? '+' : '') + dlt)))); }
    }
  }
  function renderActions() {
    clear(actions);
    const A = (ic, label, fn, o = {}) => h('button.btn', { disabled: o.disabled, class: o.kind || '', title: label, on: { click: fn } }, icon(ic), h('span', label));
    const flip = A('flip', 'Flip', () => { orientation = orientation === 'w' ? 'b' : 'w'; manualFlip = true; render(); });
    if (g.status === 'active') {
      const canAbort = g.moves.length < 2;
      actions.append(flip,
        A('half', g.drawOffer === user.uid ? 'Offered' : 'Offer draw', async () => { await O.offerDraw(id); toast('Draw offered'); }, { disabled: g.moves.length < 2 || !!g.drawOffer }),
        canAbort ? A('x', 'Abort', async () => { if (await confirmBox('Abort this game?', 'Aborted games never change your rating.', 'Abort', true)) O.abort(id); })
          : A('flag', 'Resign', async () => { if (!getPrefs().confirmResign || await confirmBox('Resign this game?', 'The game counts as a loss.', 'Resign', true)) O.resign(id); }, { kind: 'danger' }));
    } else {
      const mine = g.rematch?.by === user.uid;
      actions.append(flip,
        A('undo', g.rematch?.id ? (mine ? 'Waiting…' : 'Accept rematch') : 'Rematch', async () => {
          try {
            if (g.rematch?.id && !mine) { await O.joinGame(g.rematch.id, P); ctx.go('/play/' + g.rematch.id); }
            else { const nid = await O.offerRematch(id, P); ctx.go('/play/' + nid); }
          } catch (e) { toast(friendlyError(e), 'error'); }
        }, { kind: 'primary', disabled: g.result === '*' && !g.moves.length && false }),
        A('history', 'Review', () => saved ? ctx.go('/review/' + id) : toast('Saving the game…'), { disabled: !saved }),
        A('board', 'New game', () => ctx.go('/online')));
    }
  }
  function render(anim) {
    if (!g) return;
    if (!manualFlip) orientation = myColor() || 'w';
    const pos = position(viewPly), hv = pos.history({ verbose: true });
    let check = null;
    if (pos.inCheck()) for (const row of pos.board()) for (const x of row) if (x && x.type === 'k' && x.color === pos.turn()) check = x.square;
    const last = hv.length ? [hv.at(-1).from, hv.at(-1).to] : null;
    const p = getPrefs();
    board.set({ position: positionOf(pos), orientation, lastMove: last, check, interactive: viewPly === null && isMyTurn(),
      theme: p.boardTheme, showCoords: p.coords, showHints: p.legalHints, showLast: p.highlightLast, animate: p.animate }, anim);
    const opp = oppId();
    clear(head).append(h('b', opp ? `vs @${g.p[opp]?.username}` : 'Online game'),
      h('span', h('span.tag', TIME_CONTROLS.find(t => t.id === g.tcId)?.label || 'No clock'), ' ', h('span.tag', { class: g.rated ? 'rated' : '' }, g.rated ? 'Rated' : 'Casual')));
    const posFull = positionOf(position(viewPly));
    fillBar(topBar, orientation === 'w' ? 'b' : 'w', posFull); fillBar(botBar, orientation, posFull);
    renderClocks(); renderMoves(); renderChat(); renderBanners(); renderActions();
    status.textContent = statusText();
    nav.children[0].disabled = nav.children[1].disabled = (viewPly ?? allMoves().length) === 0;
    nav.children[2].disabled = nav.children[3].disabled = viewPly === null;
  }

  /* ---------- waiting room ---------- */
  function renderWaiting() {
    gameBox.classList.add('hidden'); clear(waitBox);
    const mine = g.createdBy === user.uid;
    const link = `${location.origin}${location.pathname}#/play/${id}`;
    const tc = TIME_CONTROLS.find(t => t.id === g.tcId)?.label || 'No clock';
    const box = h('div.onb.waiting');
    if (g.status === 'declined') box.append(h('h1', 'Challenge declined'), h('p.muted', `@${g.inviteeName} declined your challenge.`), h('a.btn.primary', { href: '#/online' }, 'Back to online play'));
    else if (mine) {
      box.append(h('div.spinner', { 'aria-hidden': 'true' }),
        h('h1', g.public ? 'Looking for an opponent…' : g.invitee ? `Waiting for @${g.inviteeName}…` : 'Waiting for your friend…'),
        h('p.muted', `${tc} · ${g.rated ? 'Rated' : 'Casual'}`),
        !g.public && h('div.invite', h('input.text-in', { value: link, readonly: true, 'aria-label': 'Invite link', on: { focus: e => e.target.select() } }),
          h('button.btn', { on: { click: async () => { try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { toast('Copy the link from the box', 'error'); } } } }, icon('copy'), 'Copy link'),
          navigator.share && h('button.btn', { on: { click: () => navigator.share({ title: 'Play chess with me', url: link }).catch(() => {}) } }, 'Share')),
        !g.public && h('p.muted', g.invitee ? `@${g.inviteeName} sees your challenge in their Online page. You can also send them this link.` : 'Send this link to a friend. The game starts as soon as they open it and sign in.'),
        h('button.btn', { on: { click: async () => { await O.cancelWaiting(id); ctx.go('/online'); } } }, 'Cancel'));
    } else {
      const from = g.p[g.createdBy];
      const forOther = g.invitee && g.invitee !== user.uid;
      box.append(h('h1', forOther ? 'This challenge is for someone else' : `@${from.username} wants to play`),
        h('p.muted', `${from.name} (${from.rating}) · ${tc} · ${g.rated ? 'Rated' : 'Casual'}`),
        !forOther && h('button.btn.primary', { style: { height: '50px', padding: '0 30px' }, on: { click: async () => { try { await O.joinGame(id, P); } catch (e) { toast(friendlyError(e), 'error'); } } } }, 'Join game'),
        h('a.btn', { href: '#/online' }, 'Back'));
    }
    waitBox.append(box);
  }

  /* ---------- game over ---------- */
  async function finish() {
    if (saving || saved || g.players.length < 2) return;
    saving = true;
    try { saved = await O.saveFinished(g); await ctx.refreshProfile(); } catch (e) { console.error(e); toast('Could not save the game: ' + friendlyError(e), 'error'); }
    saving = false; render();
    if (!shownOver) showOver();
  }
  async function showOver() {
    shownOver = true;
    const o = outcomeFor();
    if (o === 'win') sfx.win(); else if (o === 'loss') sfx.lose(); else sfx.draw();
    let rating = h('p.muted', 'Saved to your history.');
    if (saved?.ratingAfter != null) { const dlt = saved.ratingAfter - saved.ratingBefore; rating = h('div', h('div.big-r', saved.ratingAfter, ' ', h('span.delta', { class: dlt >= 0 ? 'up' : 'down', style: { fontSize: '1.3rem' } }, (dlt >= 0 ? '+' : '') + dlt)), h('p.muted', 'New online rating')); }
    const choice = await modal({ title: TITLES[o], className: 'over-modal', body: h('div', h('p', `By ${g.reason}.`), rating),
      actions: [{ label: 'Review', value: 'review' }, { label: 'Close', value: null }, { label: 'Rematch', value: 'rematch', kind: 'primary' }] });
    if (!alive) return;
    if (choice === 'review' && saved) ctx.go('/review/' + id);
    if (choice === 'rematch') { try { const nid = g.rematch?.id && g.rematch.by !== user.uid ? (await O.joinGame(g.rematch.id, P), g.rematch.id) : await O.offerRematch(id, P); ctx.go('/play/' + nid); } catch (e) { toast(friendlyError(e), 'error'); } }
  }

  /* ---------- live updates ---------- */
  const off = db.watch(`${O.COLL}/${id}`, doc => {
    if (!alive) return;
    if (!doc) { clear(waitBox).append(h('div.onb', h('h1', 'Game not found'), h('p.muted', 'It may have been cancelled.'), h('a.btn.primary', { href: '#/online' }, 'Back to online play'))); gameBox.classList.add('hidden'); return; }
    const before = g;
    g = doc;
    if (pending && g.moves.length > (before?.moves.length ?? 0)) pending = null;
    if (g.status === 'waiting' || g.status === 'declined') { renderWaiting(); prevStatus = g.status; return; }
    if (!g.players.includes(user.uid)) { clear(waitBox).append(h('div.onb', h('h1', 'This game is between other players'), h('a.btn.primary', { href: '#/online' }, 'Back to online play'))); gameBox.classList.add('hidden'); return; }
    clear(waitBox); gameBox.classList.remove('hidden');
    localStorage.setItem(O.LAST_KEY, id);
    if (prevStatus === 'waiting' && g.status === 'active') { sfx.start(); toast(`Game on! You play ${myColor() === 'w' ? 'White' : 'Black'}.`); }
    let anim;
    if (lastMoves >= 0 && g.moves.length > lastMoves && viewPly === null) {
      const lastUci = g.moves.at(-1);
      const byOpp = (g.moves.length % 2 === 1 ? 'w' : 'b') !== myColor();
      if (byOpp) { const c = O.replay(g.moves.slice(0, -1)); const m = c.move({ from: lastUci.slice(0, 2), to: lastUci.slice(2, 4), promotion: lastUci[4] }); moveSound(m, c); anim = [m.from, m.to]; }
    }
    if (before?.chat?.length < g.chat?.length && g.chat.at(-1).u !== user.uid) sfx.tick();
    lastMoves = g.moves.length;
    prevStatus = g.status;
    render(anim);
    if (g.status === 'over') finish();
  }, e => toast('Connection problem: ' + friendlyError(e), 'error'));

  const beat = () => { if (g && (g.status === 'active' || (g.status === 'waiting' && g.createdBy === user.uid))) O.heartbeat(id); };
  const hb = setInterval(beat, 15000); setTimeout(beat, 500);
  const tick = setInterval(async () => {
    if (!g) return;
    if (g.status === 'active') {
      renderClocks();
      if (g.moves.length < 2) status.textContent = statusText();
      const now = Date.now();
      if (now - lastClaim > 2000) {
        const c = O.clocks(g), side = turn();
        if (c && g.turnStart && c[side] <= -300) { lastClaim = now; O.claimTimeout(id).catch(() => {}); }
        else if (g.moves.length < 2 && db.now() - (g.lastMoveAt || g.startedAt || db.now()) > 61000) { lastClaim = now; O.abortIfNoFirstMove(id).catch(() => {}); }
      }
    }
    // quick match: if someone else is also waiting with the same settings, join the older game
    if (g.status === 'waiting' && g.public && g.createdBy === user.uid && Date.now() - lastClaim > 4000) {
      lastClaim = Date.now();
      try { const other = await O.findOpenGame(P, { tc: g.tc, rated: g.rated }, g.createdAt || Infinity); if (other && alive) { await O.cancelWaiting(id); ctx.go('/play/' + other); } } catch {}
    }
  }, 200);
  let slowN = 0;
  const slow = setInterval(() => {
    if (g?.status !== 'active') return;
    const away = db.now() - (g.lastSeen?.[oppId()] || 0) > 25000;
    if (away || ++slowN % 5 === 0) renderBanners();               // every second only while the countdown shows
  }, 1000);
  // Leaving the page mid-game: warn first on computers; on return, say how long you were gone.
  let hiddenAt = 0;
  const onVis = () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    beat();                                                         // tell the opponent you're back straight away
    const away = hiddenAt ? Date.now() - hiddenAt : 0; hiddenAt = 0;
    if (g?.status === 'active' && away > 20000) {
      const s2 = Math.round(away / 1000), grace = O.leaveGrace(g) / 1000;
      toast(away / 1000 >= grace ? `You were away for ${s2} seconds. Your opponent was allowed to claim the win.`
        : `You were away for ${s2} seconds. After ${grace / 60} minutes away, your opponent can claim the win.`, away / 1000 >= grace ? 'error' : undefined);
    }
  };
  const onUnload = e => { if (g?.status === 'active') { e.preventDefault(); e.returnValue = ''; } };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('beforeunload', onUnload);
  const onKey = e => {
    if (e.target.closest('input,textarea,select') || document.querySelector('.modal-wrap')) return;
    if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); } else if (e.key === 'ArrowRight') { step(1); e.preventDefault(); }
  };
  document.addEventListener('keydown', onKey);

  return () => {
    alive = false; off(); clearInterval(hb); clearInterval(tick); clearInterval(slow); document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVis); window.removeEventListener('beforeunload', onUnload);
    if (g && g.status === 'waiting' && g.public && g.createdBy === user.uid) O.cancelWaiting(id);
  };
}
