// Online games between two signed-in players, synced in real time through the database.
// One document per game in the "onlineGames" collection.
import { Chess } from 'chess.js';
import { session, usernameOwner, cleanUsername } from './store/index.js';
import { glicko2, inflateRd, START_RD, NEW_VOL } from './rating.js';

export const COLL = 'onlineGames';
export const LAST_KEY = 'chessarena:lastOnline';
const db = () => { const d = session().db; if (!d) throw new Error('Online play needs Firebase to be set up.'); return d; };
const uid = () => session().user?.uid;

export function onlineRating(profile) {
  return profile?.online || { rating: profile?.startRating ?? profile?.rating ?? 1200, rd: START_RD, vol: NEW_VOL, games: 0, wins: 0, losses: 0, draws: 0, peak: null, history: [] };
}
function me(profile) {
  const o = onlineRating(profile);
  return { name: profile.name, username: profile.username, rating: o.rating, rd: Math.round(o.rd), photo: session().user?.photo || null };
}
export const colorOf = (g, id = uid()) => g.white === id ? 'w' : g.black === id ? 'b' : null;
export const opponentOf = (g, id = uid()) => g.players.find(p => p !== id) || null;
export const replay = moves => { const c = new Chess(); for (const m of moves) c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] }); return c; };

/** Remaining time for each side right now (ms) */
export function clocks(g) {
  if (!g.clock) return null;
  const c = { ...g.clock };
  if (g.status === 'active' && g.turnStart) {
    const side = g.moves.length % 2 === 0 ? 'w' : 'b';
    c[side] -= db().now() - g.turnStart;
  }
  return c;
}

/* ---------------- creating and joining ---------------- */
export async function createGame(profile, { tc, rated, color = 'r', invitee = null, inviteeName = null, isPublic = false }) {
  const d = db(), id = d.newId(COLL), u = uid();
  await d.set(`${COLL}/${id}`, {
    status: 'waiting', public: isPublic, invitee, inviteeName, createdBy: u, createdAt: d.SERVER_TIME,
    tcId: tc.id, tc, rated, colorPref: color, players: [u], white: null, black: null, p: { [u]: me(profile) },
    moves: [], fen: new Chess().fen(), clock: tc.base ? { w: tc.base * 1000, b: tc.base * 1000 } : null, turnStart: null,
    drawOffer: null, result: null, reason: null, lastSeen: { [u]: d.SERVER_TIME }, chat: [], rematch: null,
  });
  localStorage.setItem(LAST_KEY, id);
  return id;
}

export async function challenge(profile, username, opts) {
  const name = cleanUsername(username);
  if (name === profile.username) throw new Error("You can't challenge yourself.");
  const other = await usernameOwner(name);
  if (!other) throw new Error(`No player called @${name}.`);
  return createGame(profile, { ...opts, invitee: other, inviteeName: name });
}

export async function joinGame(id, profile) {
  const d = db(), u = uid();
  await d.tx(async t => {
    const g = await t.get(`${COLL}/${id}`);
    if (!g) throw new Error('This game no longer exists.');
    if (g.players.includes(u)) return;
    if (g.status !== 'waiting' || g.players.length !== 1) throw new Error('Someone else already joined this game.');
    if (g.invitee && g.invitee !== u) throw new Error('This challenge was sent to another player.');
    const creator = g.createdBy;
    const creatorWhite = g.colorPref === 'w' || (g.colorPref === 'r' && Math.random() < 0.5);
    t.update(`${COLL}/${id}`, {
      players: [creator, u], white: creatorWhite ? creator : u, black: creatorWhite ? u : creator,
      status: 'active', startedAt: d.SERVER_TIME, lastMoveAt: d.SERVER_TIME,
      [`p.${u}`]: me(profile), [`lastSeen.${u}`]: d.SERVER_TIME,
    });
  });
  localStorage.setItem(LAST_KEY, id);
}

/** Quick match: join someone who is waiting with the same settings, or wait for an opponent. */
export async function quickMatch(profile, { tc, rated }) {
  const id = await findOpenGame(profile, { tc, rated });
  return id || createGame(profile, { tc, rated, color: 'r', isPublic: true });
}
export async function findOpenGame(profile, { tc, rated }, olderThan = Infinity) {
  const d = db(), u = uid();
  const open = await d.list(COLL, { where: [['status', '==', 'waiting'], ['public', '==', true], ['tcId', '==', tc.id], ['rated', '==', rated]], limit: 25 });
  const fresh = open.filter(g => g.createdBy !== u && (g.lastSeen?.[g.createdBy] || 0) > d.now() - 45000 && (g.createdAt || 0) < olderThan)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  for (const g of fresh) { try { await joinGame(g.id, profile); return g.id; } catch { /* taken by someone else */ } }
  return null;
}

export async function cancelWaiting(id) { try { await db().del(`${COLL}/${id}`); } catch {} if (localStorage.getItem(LAST_KEY) === id) localStorage.removeItem(LAST_KEY); }
export const declineChallenge = id => db().update(`${COLL}/${id}`, { status: 'declined' });

/* ---------------- playing ---------------- */
function endState(chess) {
  if (chess.isCheckmate()) return { result: chess.turn() === 'w' ? '0-1' : '1-0', reason: 'checkmate' };
  if (chess.isStalemate()) return { result: '1/2-1/2', reason: 'stalemate' };
  if (chess.isInsufficientMaterial()) return { result: '1/2-1/2', reason: 'insufficient material' };
  if (chess.isThreefoldRepetition()) return { result: '1/2-1/2', reason: 'threefold repetition' };
  if (chess.isDrawByFiftyMoves()) return { result: '1/2-1/2', reason: '50-move rule' };
  return null;
}
const hasMatingMaterial = (chess, color) => chess.board().flat().some(p => p && p.color === color && p.type !== 'k');

export async function sendMove(id, ply, from, to, promotion) {
  const d = db(), u = uid();
  return d.tx(async t => {
    const g = await t.get(`${COLL}/${id}`);
    if (!g || g.status !== 'active') throw new Error('The game is over.');
    if (g.moves.length !== ply) throw new Error('The position changed. Try again.');
    const color = colorOf(g, u), side = ply % 2 === 0 ? 'w' : 'b';
    if (color !== side) throw new Error("It's not your turn.");
    const chess = replay(g.moves);
    const m = chess.move({ from, to, promotion });           // throws if illegal
    const patch = { moves: [...g.moves, m.from + m.to + (m.promotion || '')], fen: chess.fen(), drawOffer: null, lastMoveAt: d.SERVER_TIME };
    if (g.clock) {
      const clock = { ...g.clock };
      if (g.turnStart) {
        clock[side] -= d.now() - g.turnStart;
        if (clock[side] <= 0) {        // flagged before moving
          const other = side === 'w' ? 'b' : 'w';
          t.update(`${COLL}/${id}`, { clock: { ...clock, [side]: 0 }, turnStart: null, ...over(hasMatingMaterial(replay(g.moves), other) ? (side === 'w' ? '0-1' : '1-0') : '1/2-1/2', 'timeout', d) });
          return 'timeout';
        }
        clock[side] += (g.tc.inc || 0) * 1000;
      }
      patch.clock = clock;
      patch.turnStart = patch.moves.length >= 2 ? d.SERVER_TIME : null;
    }
    const end = endState(chess);
    if (end) Object.assign(patch, over(end.result, end.reason, d), { turnStart: null });
    t.update(`${COLL}/${id}`, patch);
    return m;
  });
}
const over = (result, reason, d) => ({ status: 'over', result, reason, endedAt: d.SERVER_TIME, drawOffer: null });

async function finishIf(id, check) {
  const d = db();
  return d.tx(async t => {
    const g = await t.get(`${COLL}/${id}`);
    if (!g || g.status !== 'active') return false;
    const r = check(g); if (!r) return false;
    t.update(`${COLL}/${id}`, { ...over(r.result, r.reason, d), turnStart: null, ...(r.extra || {}) });
    return true;
  });
}
export const resign = id => finishIf(id, g => ({ result: colorOf(g) === 'w' ? '0-1' : '1-0', reason: 'resignation' }));
export const abort = id => finishIf(id, g => g.moves.length < 2 ? { result: '*', reason: 'aborted' } : null);
export const acceptDraw = id => finishIf(id, g => g.drawOffer && g.drawOffer !== uid() ? { result: '1/2-1/2', reason: 'agreement' } : null);
export const offerDraw = id => db().update(`${COLL}/${id}`, { drawOffer: uid() });
export const declineDraw = id => db().update(`${COLL}/${id}`, { drawOffer: null });
export const heartbeat = id => db().update(`${COLL}/${id}`, { [`lastSeen.${uid()}`]: db().SERVER_TIME }).catch(() => {});
export const sendChat = (id, text) => db().push(`${COLL}/${id}`, 'chat', { u: uid(), m: String(text).slice(0, 140), t: Date.now() });

/** Called by either player when the side to move has run out of time. */
export const claimTimeout = id => finishIf(id, g => {
  const c = clocks(g); if (!c || !g.turnStart) return null;
  const side = g.moves.length % 2 === 0 ? 'w' : 'b';
  if (c[side] > -250) return null;
  const other = side === 'w' ? 'b' : 'w';
  const win = hasMatingMaterial(replay(g.moves), other);
  return { result: win ? (side === 'w' ? '0-1' : '1-0') : '1/2-1/2', reason: win ? 'timeout' : 'timeout vs insufficient material', extra: { clock: { ...g.clock, [side]: 0 } } };
});
/** Nobody made their first move within a minute: abort. */
export const abortIfNoFirstMove = id => finishIf(id, g => g.moves.length < 2 && db().now() - (g.lastMoveAt || g.startedAt || 0) > 60000 ? { result: '*', reason: 'first move not played' } : null);
/** Opponent closed the game for over a minute. */
export const claimAbandoned = id => finishIf(id, g => {
  const opp = opponentOf(g); if ((g.lastSeen?.[opp] || 0) > db().now() - 60000) return null;
  if (g.moves.length < 2) return { result: '*', reason: 'aborted' };
  return { result: colorOf(g) === 'w' ? '1-0' : '0-1', reason: 'opponent left' };
});

/* ---------------- rematch ---------------- */
export async function offerRematch(id, profile) {
  const d = db(), u = uid();
  return d.tx(async t => {
    const g = await t.get(`${COLL}/${id}`);
    if (g.rematch?.id) return g.rematch.id;
    const nid = d.newId(COLL), opp = opponentOf(g);
    t.set(`${COLL}/${nid}`, {
      status: 'waiting', public: false, invitee: opp, inviteeName: g.p[opp].username, createdBy: u, createdAt: d.SERVER_TIME,
      tcId: g.tcId, tc: g.tc, rated: g.rated, colorPref: colorOf(g) === 'w' ? 'b' : 'w', players: [u], white: null, black: null,
      p: { [u]: me(profile) }, moves: [], fen: new Chess().fen(), clock: g.tc.base ? { w: g.tc.base * 1000, b: g.tc.base * 1000 } : null,
      turnStart: null, drawOffer: null, result: null, reason: null, lastSeen: { [u]: d.SERVER_TIME }, chat: [], rematch: null,
    });
    t.update(`${COLL}/${id}`, { rematch: { by: u, id: nid } });
    return nid;
  });
}

/* ---------------- saving the finished game (once per player) ---------------- */
export async function saveFinished(g) {
  const d = db(), u = uid(), path = `users/${u}/games/${g.id}`;
  return d.tx(async t => {
    const existing = await t.get(path);
    if (existing) return existing;
    const profile = await t.get(`users/${u}`);
    if (!profile) return null;
    delete profile.id;
    const color = colorOf(g, u), opp = opponentOf(g, u);
    const outcome = g.result === '*' ? 'aborted' : g.result === '1/2-1/2' ? 'draw' : ((g.result === '1-0') === (color === 'w') ? 'win' : 'loss');
    const rated = g.rated && outcome !== 'aborted';
    const o = { ...onlineRating(profile) };
    let ratingBefore = null, ratingAfter = null;
    if (rated) {
      const score = outcome === 'win' ? 1 : outcome === 'draw' ? 0.5 : 0;
      const next = glicko2({ rating: o.rating, rd: inflateRd(o.rd, o.lastPlayed), vol: o.vol }, { rating: g.p[opp].rating, rd: g.p[opp].rd || 200 }, score);
      ratingBefore = o.rating; ratingAfter = next.rating;
      Object.assign(o, next, { peak: Math.max(o.peak || 0, next.rating), history: [...(o.history || []), { t: Date.now(), r: next.rating }].slice(-300) });
    }
    if (outcome !== 'aborted') {
      o.games = (o.games || 0) + 1; o.lastPlayed = Date.now();
      if (outcome === 'win') o.wins = (o.wins || 0) + 1; else if (outcome === 'loss') o.losses = (o.losses || 0) + 1; else o.draws = (o.draws || 0) + 1;
    }
    profile.online = o;
    const chess = replay(g.moves);
    const label = id => `${g.p[id].name} (@${g.p[id].username})`;
    chess.setHeader('Event', g.rated ? 'Rated online game' : 'Casual online game');
    chess.setHeader('Site', location.host || 'Chess Arena');
    chess.setHeader('White', label(g.white)); chess.setHeader('Black', label(g.black));
    chess.setHeader('Result', g.result); chess.setHeader('Termination', g.reason);
    if (g.tc?.base) chess.setHeader('TimeControl', `${g.tc.base}+${g.tc.inc}`);
    const record = {
      mode: 'online', onlineId: g.id, rated, color, opponent: g.p[opp].username, opponentName: g.p[opp].name,
      timeControl: g.tcId, result: g.result, outcome, reason: g.reason,
      white: label(g.white), black: label(g.black), pgn: chess.pgn(), moves: chess.history(), plies: g.moves.length,
      ratingBefore, ratingAfter, takebacks: 0, hintsUsed: 0,
      startedAt: g.startedAt || g.createdAt, endedAt: g.endedAt || Date.now(), durationMs: (g.endedAt || Date.now()) - (g.startedAt || g.createdAt || Date.now()),
      clocks: g.clock || null,
    };
    t.set(path, record);
    t.set(`users/${u}`, profile);
    return record;
  });
}
