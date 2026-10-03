// Game controller: rules (chess.js), clocks, bot moves, saving and rating.
import { Chess } from 'chess.js';
import { think, resetEngine } from './engine-client.js';
import { sfx } from './audio/sfx.js';
import { ratingsOf, rateGame, countResult, BOT_RD, MAX_CHANGE } from './rating.js';
import { session } from './store/index.js';
import { botName } from './config.js';

const SAVE_KEY = 'chessarena:current';

export class Game {
  /**
   * cfg: {mode:'bot'|'local', color:'w'|'b', botElo, tc:{id,base,inc}, rated, playerName, playerRating}
   */
  constructor(cfg, restore) {
    this.cfg = cfg;
    this.chess = new Chess();
    this.listeners = new Set();
    this.token = 0;
    this.status = 'playing';
    this.result = null;
    this.clock = cfg.tc && cfg.tc.base ? { w: cfg.tc.base * 1000, b: cfg.tc.base * 1000 } : null;
    this.turnStart = null;      // clock starts after each side's first move (like online chess)
    this.startedAt = Date.now();
    this.evalScore = 0; this.lines = []; this.thinking = false; this.hint = null;
    this.takebacks = 0; this.hintsUsed = 0;
    this.moveTimes = [];
    if (restore) {
      for (const m of restore.moves) this.chess.move(m);
      this.clock = restore.clock; this.startedAt = restore.startedAt;
      this.takebacks = restore.takebacks || 0; this.hintsUsed = restore.hintsUsed || 0;
      this.turnStart = this.clock && this.chess.history().length >= 2 ? Date.now() : null;
    } else resetEngine();
    this._timer = setInterval(() => this._tick(), 100);
  }

  on(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
  emit(ev) { this.listeners.forEach(f => f(ev)); }

  get turn() { return this.chess.turn(); }
  get plies() { return this.chess.history().length; }
  get isBot() { return this.cfg.mode === 'bot'; }
  get humanToMove() { return this.status === 'playing' && (!this.isBot || this.turn === this.cfg.color); }
  get casual() { return !this.cfg.rated; }

  clockNow() {
    if (!this.clock) return null;
    const c = { ...this.clock };
    if (this.status === 'playing' && this.turnStart) c[this.turn] -= Date.now() - this.turnStart;
    return c;
  }

  canAbort() {
    if (this.status !== 'playing') return false;
    if (this.isBot) return this.chess.history({ verbose: true }).filter(m => m.color === this.cfg.color).length === 0;
    return this.plies < 2;
  }

  legalFrom(sq) { return this.humanToMove ? this.chess.moves({ square: sq, verbose: true }) : []; }

  move(from, to, promotion) {
    if (this.status !== 'playing') return false;
    let m;
    try { m = this.chess.move({ from, to, promotion }); } catch { sfx.illegal(); return false; }
    this._afterMove(m);
    return true;
  }

  _afterMove(m) {
    const mover = m.color;
    if (this.clock) {
      if (this.turnStart) {
        this.clock[mover] -= Date.now() - this.turnStart;
        this.clock[mover] += (this.cfg.tc.inc || 0) * 1000;
      }
      this.turnStart = this.plies >= 2 ? Date.now() : null;
    }
    this.hint = null;
    if (this.chess.inCheck()) sfx.check();
    else if (m.flags.includes('k') || m.flags.includes('q')) sfx.castle();
    else if (m.flags.includes('p')) sfx.promote();
    else if (m.captured) sfx.capture();
    else sfx.move();
    this.emit({ type: 'move', move: m });
    if (this._checkEnd()) return;
    this._persist();
    this._maybeBot();
  }

  start() { sfx.start(); this._persist(); this._maybeBot(); this.emit({ type: 'update' }); }

  async _maybeBot() {
    if (!this.isBot || this.status !== 'playing' || this.turn === this.cfg.color) return;
    const tok = ++this.token;
    this.thinking = true; this.emit({ type: 'update' });
    let timeLimit = 1.5;
    if (this.clock) { const left = this.clockNow()[this.turn]; timeLimit = Math.max(0.1, Math.min(1.5, left / 1000 / 35)); }
    const started = Date.now();
    const r = await think(this.chess, { rating: this.cfg.botElo, timeLimit, mode: 'play' });
    const wait = 300 - (Date.now() - started);
    if (wait > 0) await new Promise(res => setTimeout(res, wait));
    if (tok !== this.token || this.status !== 'playing') return;
    this.thinking = false;
    if (typeof r.eval === 'number' && r.lines?.[0]?.[0] !== 'Book Move') this.evalScore = r.eval;
    this.lines = r.lines || [];
    if (!r.move) return;
    const from = idxToSq(r.move[0]), to = idxToSq(r.move[1]);
    const piece = this.chess.get(from);
    const promo = piece?.type === 'p' && (to[1] === '8' || to[1] === '1') ? 'q' : undefined;
    let m; try { m = this.chess.move({ from, to, promotion: promo }); } catch { m = null; }
    if (!m) { // safety net: should never happen
      const all = this.chess.moves({ verbose: true }); m = this.chess.move(all[0]);
    }
    this._afterMove(m);
  }

  async getHint() {
    if (!this.humanToMove || this.cfg.rated) return null;
    const tok = this.token;
    this.emit({ type: 'hint-start' });
    const r = await think(this.chess, { rating: 2000, timeLimit: 1.0, mode: 'hint' });
    if (tok !== this.token || !this.humanToMove || !r.move) return null;
    this.hintsUsed++;
    this.hint = [idxToSq(r.move[0]), idxToSq(r.move[1])];
    if (typeof r.eval === 'number') this.evalScore = r.eval;
    this.lines = r.lines || [];
    this.emit({ type: 'update' });
    return this.hint;
  }

  takeback() {
    if (this.cfg.rated || this.status !== 'playing' || !this.plies) return false;
    this.token++; this.thinking = false; this.hint = null;
    if (this.isBot) {
      // undo until it's the human's turn again (and at least one human move removed)
      let undone = 0;
      while (this.plies && (undone === 0 || this.turn !== this.cfg.color)) { this.chess.undo(); undone++; }
      if (this.turn !== this.cfg.color) { this._maybeBot(); }
    } else this.chess.undo();
    this.takebacks++;
    if (this.clock && this.plies < 2) this.turnStart = null;
    else if (this.clock) this.turnStart = Date.now();
    this._persist();
    this.emit({ type: 'takeback' });
    return true;
  }

  offerDraw() {
    if (this.status !== 'playing') return false;
    if (this.isBot) {
      const botSide = this.cfg.color === 'w' ? -1 : 1;   // eval is white-positive
      const botView = this.evalScore * botSide;
      const accept = this.plies >= 20 && botView <= 30;
      if (accept) this.finish('1/2-1/2', 'agreement');
      return accept;
    }
    this.finish('1/2-1/2', 'agreement'); // local: the other player confirmed in the UI
    return true;
  }

  resign(color = this.isBot ? this.cfg.color : this.turn) { this.finish(color === 'w' ? '0-1' : '1-0', 'resignation'); }
  abort() { if (this.canAbort()) this.finish('*', 'aborted'); }

  _tick() {
    if (this.status !== 'playing' || !this.clock || !this.turnStart) return;
    const c = this.clockNow();
    const side = this.turn;
    if (c[side] <= 0) {
      this.clock[side] = 0; this.turnStart = null;
      const other = side === 'w' ? 'b' : 'w';
      const canMate = this.chess.board().flat().some(p => p && p.color === other && p.type !== 'k');
      this.finish(canMate ? (side === 'w' ? '0-1' : '1-0') : '1/2-1/2', canMate ? 'timeout' : 'timeout vs insufficient material');
      return;
    }
    if (c[side] < 10000 && this.humanToMove && Math.floor(c[side] / 1000) !== this._lastTick) { this._lastTick = Math.floor(c[side] / 1000); sfx.tick(); }
    this.emit({ type: 'clock' });
  }

  _checkEnd() {
    const c = this.chess;
    if (c.isCheckmate()) return this.finish(c.turn() === 'w' ? '0-1' : '1-0', 'checkmate'), true;
    if (c.isStalemate()) return this.finish('1/2-1/2', 'stalemate'), true;
    if (c.isInsufficientMaterial()) return this.finish('1/2-1/2', 'insufficient material'), true;
    if (c.isThreefoldRepetition()) return this.finish('1/2-1/2', 'threefold repetition'), true;
    if (c.isDrawByFiftyMoves()) return this.finish('1/2-1/2', '50-move rule'), true;
    return false;
  }

  /** Outcome from the human's point of view (bot games) */
  outcomeFor(result) {
    if (result === '*') return 'aborted';
    if (result === '1/2-1/2') return 'draw';
    if (!this.isBot) return result === '1-0' ? 'white' : 'black';
    const won = (result === '1-0') === (this.cfg.color === 'w');
    return won ? 'win' : 'loss';
  }

  async finish(result, reason) {
    if (this.status !== 'playing') return;
    if (this.clock && this.turnStart) this.clock[this.turn] = Math.max(0, this.clock[this.turn] - (Date.now() - this.turnStart));
    this.status = 'over'; this.token++; this.thinking = false; this.turnStart = null;
    clearInterval(this._timer);
    localStorage.removeItem(SAVE_KEY);
    const outcome = this.outcomeFor(result);
    this.result = { result, reason, outcome, ratingBefore: null, ratingAfter: null, saved: false };
    if (outcome === 'win' || outcome === 'white' || outcome === 'black') sfx.win();
    else if (outcome === 'loss') sfx.lose(); else sfx.draw();
    this.emit({ type: 'over' });
    try { await this._save(); } catch (e) { console.error(e); this.result.saveError = e.message || String(e); }
    this.emit({ type: 'saved' });
  }

  async _save() {
    const { store } = session();
    const profile = await store.getProfile();
    const r = this.result;
    const rated = this.cfg.rated && this.isBot && r.outcome !== 'aborted' && profile;
    this.chess.header('Event', this.isBot ? (rated ? 'Rated game vs computer' : 'Casual game vs computer') : 'Two-player game');
    this.chess.header('Site', location.host || 'Chess Throne');
    this.chess.header('Date', new Date(this.startedAt).toISOString().slice(0, 10).replace(/-/g, '.'));
    const you = profile?.name || 'You';
    const botLabel = `${botName(this.cfg.botElo)} (${this.cfg.botElo})`;
    const white = this.isBot ? (this.cfg.color === 'w' ? you : botLabel) : 'White';
    const black = this.isBot ? (this.cfg.color === 'b' ? you : botLabel) : 'Black';
    this.chess.header('White', white, 'Black', black, 'Result', r.result, 'Termination', r.reason);
    if (this.cfg.tc?.base) this.chess.header('TimeControl', `${this.cfg.tc.base}+${this.cfg.tc.inc}`);

    if (rated) {
      const score = r.outcome === 'win' ? 1 : r.outcome === 'draw' ? 0.5 : 0;
      const ratings = ratingsOf(profile);
      const next = rateGame(ratings.computer, this.cfg.botElo, BOT_RD, score, MAX_CHANGE);
      r.ratingBefore = ratings.computer.rating; r.ratingAfter = next.rating;
      ratings.computer = next; profile.ratings = ratings;
      profile.rating = next.rating; profile.rd = next.rd; profile.vol = next.vol;   // older fields kept in step
      profile.peak = Math.max(profile.peak || 0, next.rating);
      profile.ratingHistory = next.history;
    }
    if (profile) {
      profile.games = (profile.games || 0) + 1;
      if (r.outcome === 'win') profile.wins = (profile.wins || 0) + 1;
      else if (r.outcome === 'loss') profile.losses = (profile.losses || 0) + 1;
      else if (r.outcome === 'draw') profile.draws = (profile.draws || 0) + 1;
      if (this.isBot && r.outcome !== 'aborted') { profile.lastPlayed = Date.now(); const rs = ratingsOf(profile); countResult(rs.computer, r.outcome); profile.ratings = rs; }
      await store.saveProfile(profile);
    }
    const record = {
      mode: this.cfg.mode, rated: !!rated, color: this.isBot ? this.cfg.color : null,
      botElo: this.isBot ? this.cfg.botElo : null, timeControl: this.cfg.tc?.id || 'none',
      result: r.result, outcome: r.outcome, reason: r.reason,
      white, black, pgn: this.chess.pgn(), moves: this.chess.history(), plies: this.plies,
      ratingBefore: r.ratingBefore, ratingAfter: r.ratingAfter,
      takebacks: this.takebacks, hintsUsed: this.hintsUsed,
      startedAt: this.startedAt, endedAt: Date.now(), durationMs: Date.now() - this.startedAt,
      clocks: this.clock ? { ...this.clock } : null,
    };
    r.id = await store.addGame(record);
    r.saved = true;
  }

  _persist() {
    if (this.status !== 'playing') return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        cfg: this.cfg, moves: this.chess.history({ verbose: true }).map(m => ({ from: m.from, to: m.to, promotion: m.promotion })),
        clock: this.clockNow(), startedAt: this.startedAt, takebacks: this.takebacks, hintsUsed: this.hintsUsed,
        owner: session().user?.uid || 'guest',
      }));
    } catch {}
  }

  destroy() { this.token++; clearInterval(this._timer); this.listeners.clear(); }

  static savedGame() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; } }
  static discardSaved() { localStorage.removeItem(SAVE_KEY); }
}

export function idxToSq(i) { return 'abcdefgh'[i & 7] + ((i >> 3) + 1); }
