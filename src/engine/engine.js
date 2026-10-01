// Port of engine.py (ChessBoard) — bitboard logic ported to a 64-square array.
export const OPENING_BOOK = {
  "": ["e2e4","d2d4","g1f3","c2c4"],
  "e2e4": ["e7e5","c7c5","e7e6","c7c6","d7d6","g8f6"],
  "e2e4 e7e5": ["g1f3","b1c3","f2f4","f1c4"],
  "e2e4 e7e5 g1f3": ["b8c6","g8f6","d7d6"],
  "e2e4 e7e5 g1f3 b8c6": ["f1b5","f1c4","d2d4","c2c3"],
  "e2e4 e7e5 g1f3 b8c6 f1b5": ["a7a6","g8f6","f7f5"],
  "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6": ["b5a4","b5c6"],
  "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4": ["g8f6","d7d6"],
  "e2e4 e7e5 g1f3 b8c6 f1c4": ["f8c5","g8f6"],
  "e2e4 e7e5 g1f3 b8c6 f1c4 g8f6": ["d2d3","f3g5","d2d4"],
  "e2e4 c7c5": ["g1f3","b1c3","c2c3"],
  "e2e4 c7c5 g1f3": ["d7d6","b8c6","e7e6"],
  "e2e4 c7c5 g1f3 d7d6": ["d2d4","f1b5","c2c3"],
  "e2e4 c7c5 g1f3 d7d6 d2d4": ["c5d4"],
  "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4": ["f3d4"],
  "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4": ["g8f6"],
  "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6": ["b1c3"],
  "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3": ["a7a6","g7g6","e7e6"],
  "e2e4 e7e6": ["d2d4"],
  "e2e4 e7e6 d2d4": ["d7d5"],
  "e2e4 e7e6 d2d4 d7d5": ["e4e5","b1c3","b1d2","e4d5"],
  "e2e4 c7c6": ["d2d4","b1c3"],
  "e2e4 c7c6 d2d4": ["d7d5"],
  "e2e4 c7c6 d2d4 d7d5": ["e4e5","b1c3","e4d5"],
  "d2d4": ["d7d5","g8f6","e7e6","f7f5"],
  "d2d4 d7d5": ["c2c4","g1f3","c1f4"],
  "d2d4 d7d5 c2c4": ["e7e6","c7c6","d5c4"],
  "d2d4 d7d5 c2c4 e7e6": ["b1c3","g1f3"],
  "d2d4 d7d5 c2c4 e7e6 b1c3": ["g8f6","c7c5","f8e7"],
  "d2d4 d7d5 c2c4 c7c6": ["g1f3","b1c3","c4d5"],
  "d2d4 g8f6": ["c2c4","g1f3","c1f4"],
  "d2d4 g8f6 c2c4": ["e7e6","g7g6","c7c5"],
  "d2d4 g8f6 c2c4 e7e6": ["b1c3","g1f3","g2g3"],
  "d2d4 g8f6 c2c4 e7e6 b1c3": ["f8b4","d7d5"],
  "d2d4 g8f6 c2c4 g7g6": ["b1c3","g2g3","f2f3"],
  "d2d4 g8f6 c2c4 g7g6 b1c3": ["d7d5","f8g7"],
  "c2c4": ["e7e5","c7c5","g8f6","e7e6"],
  "c2c4 e7e5": ["b1c3","g2g3"],
  "c2c4 c7c5": ["b1c3","g1f3","g2g3"]
};

/** True if this sequence of moves ("e2e4 e7e5 ...") is in the opening book. */
export function inBook(uciMoves){
  const prev = uciMoves.slice(0, -1).join(' ');
  return !!OPENING_BOOK[prev]?.includes(uciMoves[uciMoves.length - 1]);
}

export function createEngine(){
  const PIECES = 'PNBRQKpnbrqk';
  const VALUE = {P:100,N:320,B:330,R:500,Q:900,K:20000};
  const CENTER = new Set([27,28,35,36]);
  const isUp = p => p === p.toUpperCase();

  // Deterministic Zobrist keys so the page and the worker agree on hashes
  let seed = 0x9E3779B9;
  const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0); };
  const Z1 = [], Z2 = [];
  for (let i = 0; i < 12*64 + 1 + 64 + 4; i++){ Z1.push(rnd()); Z2.push(rnd() & 0x1FFFFF); }
  const Z_SIDE = 768, Z_EP = 769, Z_CR = 833;

  const KN = [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]];
  const KG = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  const ROOK_D = [[1,0],[-1,0],[0,1],[0,-1]], BISH_D = [[1,1],[1,-1],[-1,1],[-1,-1]];


  const ABORT = {};

  class Board {
    constructor(){
      this.sq = new Array(64).fill(null);
      const back = 'RNBQKBNR';
      for (let f = 0; f < 8; f++){
        this.sq[f] = back[f]; this.sq[8+f] = 'P';
        this.sq[48+f] = 'p'; this.sq[56+f] = back[f].toLowerCase();
      }
      this.whiteToMove = true; this.ep = null;
      this.cr = [true,true,true,true]; // WK, WQ, BK, BQ
      this.halfmove = 0; this.history = [];
      this.tt = new Map();
      this.deadline = Infinity; this.nodes = 0;
    }
    loadFEN(fen){
      const [pos, side, cast, ep, hm] = fen.split(' ');
      this.sq = new Array(64).fill(null);
      const rows = pos.split('/');
      for (let r = 0; r < 8; r++){ let f = 0;
        for (const ch of rows[r]){ if (/\d/.test(ch)) f += +ch; else { this.sq[(7-r)*8 + f] = ch; f++; } } }
      this.whiteToMove = side === 'w';
      this.cr = [cast.includes('K'), cast.includes('Q'), cast.includes('k'), cast.includes('q')];
      this.ep = ep && ep !== '-' ? (+ep[1]-1)*8 + (ep.charCodeAt(0)-97) : null;
      this.halfmove = +hm || 0;
      return this;
    }
    exportState(){ return {sq:this.sq.slice(), wtm:this.whiteToMove, ep:this.ep, cr:this.cr.slice(), hm:this.halfmove, hist:this.history.map(m=>m.slice())}; }
    loadState(s){ this.sq=s.sq.slice(); this.whiteToMove=s.wtm; this.ep=s.ep; this.cr=s.cr.slice(); this.halfmove=s.hm; this.history=s.hist.map(m=>m.slice()); }
    clone(){ const b = new Board(); b.loadState(this.exportState()); return b; }

    pieceAt(i){ return this.sq[i]; }

    makeMove(s, e){
      const piece = this.sq[s]; if (!piece) return;
      const target = this.sq[e];
      const up = piece.toUpperCase();
      let dbl = false, epCap = false, promo = false;
      if (up === 'P' || target) this.halfmove = 0; else this.halfmove++;
      if (up === 'P'){
        if (Math.abs(e - s) === 16) dbl = true;
        else if (e === this.ep) epCap = true;
        if ((piece === 'P' && e >= 56) || (piece === 'p' && e <= 7)) promo = true;
      }
      if (piece === 'K'){ this.cr[0] = this.cr[1] = false; }
      else if (piece === 'k'){ this.cr[2] = this.cr[3] = false; }
      if (s === 7 || e === 7) this.cr[0] = false;
      if (s === 0 || e === 0) this.cr[1] = false;
      if (s === 63 || e === 63) this.cr[2] = false;
      if (s === 56 || e === 56) this.cr[3] = false;

      this.sq[s] = null; this.sq[e] = piece;
      if (promo) this.sq[e] = piece === 'P' ? 'Q' : 'q';
      if (epCap){ if (piece === 'P') this.sq[e-8] = null; else this.sq[e+8] = null; }
      if (piece === 'K' && Math.abs(s - e) === 2){
        if (e === 6){ this.sq[7] = null; this.sq[5] = 'R'; }
        else if (e === 2){ this.sq[0] = null; this.sq[3] = 'R'; }
      } else if (piece === 'k' && Math.abs(s - e) === 2){
        if (e === 62){ this.sq[63] = null; this.sq[61] = 'r'; }
        else if (e === 58){ this.sq[56] = null; this.sq[59] = 'r'; }
      }
      this.ep = dbl ? ((s + e) >> 1) : null;
      this.history.push([s, e]);
      this.whiteToMove = !this.whiteToMove;
    }

    // Pseudo-legal moves (engine.py: get_legal_moves)
    pseudoMoves(i){
      const p = this.sq[i]; if (!p) return [];
      const white = isUp(p), up = p.toUpperCase();
      const r = i >> 3, c = i & 7, out = [];
      const own = t => this.sq[t] && isUp(this.sq[t]) === white;
      const enemy = t => this.sq[t] && isUp(this.sq[t]) !== white;
      if (up === 'P'){
        const dir = white ? 8 : -8, startRank = white ? 1 : 6;
        const one = i + dir;
        if (one >= 0 && one < 64 && !this.sq[one]){
          out.push(one);
          if (r === startRank && !this.sq[one + dir]) out.push(one + dir);
        }
        for (const dc of [-1, 1]){
          const nc = c + dc; if (nc < 0 || nc > 7) continue;
          const t = i + dir + dc; if (t < 0 || t > 63) continue;
          if (enemy(t) || t === this.ep) out.push(t);
        }
        return out;
      }
      if (up === 'N' || up === 'K'){
        for (const [dr, dc] of (up === 'N' ? KN : KG)){
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
          const t = nr*8 + nc; if (!own(t)) out.push(t);
        }
        return out;
      }
      const dirs = up === 'R' ? ROOK_D : up === 'B' ? BISH_D : ROOK_D.concat(BISH_D);
      for (const [dr, dc] of dirs){
        let nr = r + dr, nc = c + dc;
        while (nr >= 0 && nr <= 7 && nc >= 0 && nc <= 7){
          const t = nr*8 + nc;
          if (this.sq[t]){ if (!own(t)) out.push(t); break; }
          out.push(t); nr += dr; nc += dc;
        }
      }
      return out;
    }

    // Is square attacked by the side `byWhite`?
    attacked(sqi, byWhite){
      const r = sqi >> 3, c = sqi & 7, S = this.sq;
      const P = byWhite ? 'P' : 'p', N = byWhite ? 'N' : 'n', K = byWhite ? 'K' : 'k';
      const B = byWhite ? 'B' : 'b', R = byWhite ? 'R' : 'r', Q = byWhite ? 'Q' : 'q';
      const pr = byWhite ? r - 1 : r + 1;
      if (pr >= 0 && pr <= 7){
        if (c > 0 && S[pr*8 + c - 1] === P) return true;
        if (c < 7 && S[pr*8 + c + 1] === P) return true;
      }
      for (const [dr, dc] of KN){ const nr=r+dr, nc=c+dc; if (nr>=0&&nr<=7&&nc>=0&&nc<=7&&S[nr*8+nc]===N) return true; }
      for (const [dr, dc] of KG){ const nr=r+dr, nc=c+dc; if (nr>=0&&nr<=7&&nc>=0&&nc<=7&&S[nr*8+nc]===K) return true; }
      for (const [dr, dc] of ROOK_D){
        let nr=r+dr, nc=c+dc;
        while (nr>=0&&nr<=7&&nc>=0&&nc<=7){ const x=S[nr*8+nc]; if (x){ if (x===R||x===Q) return true; break; } nr+=dr; nc+=dc; }
      }
      for (const [dr, dc] of BISH_D){
        let nr=r+dr, nc=c+dc;
        while (nr>=0&&nr<=7&&nc>=0&&nc<=7){ const x=S[nr*8+nc]; if (x){ if (x===B||x===Q) return true; break; } nr+=dr; nc+=dc; }
      }
      return false;
    }
    kingSquare(white){ const k = white ? 'K' : 'k'; return this.sq.indexOf(k); }
    inCheck(whiteKing){ const k = this.kingSquare(whiteKing); return k !== -1 && this.attacked(k, !whiteKing); }

    save(){ return [this.sq.slice(), this.whiteToMove, this.ep, this.cr.slice(), this.halfmove, this.history.length]; }
    restore(s){ this.sq=s[0]; this.whiteToMove=s[1]; this.ep=s[2]; this.cr=s[3]; this.halfmove=s[4]; this.history.length=s[5]; }
    restoreCopy(s){ this.restore([s[0].slice(), s[1], s[2], s[3].slice(), s[4], s[5]]); }

    // engine.py: get_strict_legal_moves
    legalMoves(i){
      const p = this.sq[i]; if (!p) return [];
      const white = isUp(p), out = [];
      for (const m of this.pseudoMoves(i)){
        const st = this.save(); this.makeMove(i, m);
        if (!this.inCheck(white)) out.push(m);
        this.restore(st);
      }
      if (p === 'K' && !this.inCheck(true)){
        if (this.cr[0] && !this.sq[5] && !this.sq[6] && !this.attacked(5,false) && !this.attacked(6,false)) out.push(6);
        if (this.cr[1] && !this.sq[1] && !this.sq[2] && !this.sq[3] && !this.attacked(3,false) && !this.attacked(2,false)) out.push(2);
      } else if (p === 'k' && !this.inCheck(false)){
        if (this.cr[2] && !this.sq[61] && !this.sq[62] && !this.attacked(61,true) && !this.attacked(62,true)) out.push(62);
        if (this.cr[3] && !this.sq[57] && !this.sq[58] && !this.sq[59] && !this.attacked(59,true) && !this.attacked(58,true)) out.push(58);
      }
      return out;
    }
    allLegal(white){
      const out = [];
      for (let i = 0; i < 64; i++){ const p = this.sq[i];
        if (p && isUp(p) === white) for (const t of this.legalMoves(i)) out.push([i, t]); }
      return out;
    }
    hasAnyLegal(white){
      for (let i = 0; i < 64; i++){ const p = this.sq[i];
        if (p && isUp(p) === white && this.legalMoves(i).length) return true; }
      return false;
    }
    count(p){ let n = 0; for (let i = 0; i < 64; i++) if (this.sq[i] === p) n++; return n; }
    insufficientMaterial(){
      let minors = 0;
      for (const p of this.sq){ if (!p) continue; const u = p.toUpperCase();
        if (u === 'P' || u === 'R' || u === 'Q') return false; if (u === 'N' || u === 'B') minors++; }
      return minors <= 1;
    }
    hash(){
      let h1 = 0, h2 = 0;
      for (let i = 0; i < 64; i++){ const p = this.sq[i]; if (p){ const k = PIECES.indexOf(p)*64 + i; h1 ^= Z1[k]; h2 ^= Z2[k]; } }
      if (this.whiteToMove){ h1 ^= Z1[Z_SIDE]; h2 ^= Z2[Z_SIDE]; }
      if (this.ep !== null){ h1 ^= Z1[Z_EP+this.ep]; h2 ^= Z2[Z_EP+this.ep]; }
      for (let j = 0; j < 4; j++) if (this.cr[j]){ h1 ^= Z1[Z_CR+j]; h2 ^= Z2[Z_CR+j]; }
      return (h1 >>> 0) * 2097152 + (h2 & 0x1FFFFF);
    }
    static alg(i){ return String.fromCharCode(97 + (i & 7)) + ((i >> 3) + 1); }

    openingMove(){
      const key = this.history.map(([s,e]) => Board.alg(s) + Board.alg(e)).join(' ');
      const opts = OPENING_BOOK[key]; if (!opts) return null;
      const m = opts[Math.floor(Math.random() * opts.length)];
      const s = (+m[1] - 1)*8 + (m.charCodeAt(0) - 97), e = (+m[3] - 1)*8 + (m.charCodeAt(2) - 97);
      return [s, e];
    }
    value(p){ return p ? VALUE[p.toUpperCase()] : 0; }

    orderMoves(moves, key){
      const ent = key === null ? null : this.tt.get(key);
      const ttm = ent && ent.best;
      const scored = moves.map(m => {
        let sc = 0;
        if (ttm && m[0] === ttm[0] && m[1] === ttm[1]) sc += 100000;
        const tgt = this.sq[m[1]], pc = this.sq[m[0]];
        if (tgt) sc += 10*this.value(tgt) - this.value(pc);
        if (pc && pc.toUpperCase() === 'P' && (m[1] >= 56 || m[1] <= 7)) sc += 900;
        return [sc, m];
      });
      scored.sort((a, b) => b[0] - a[0]);
      return scored.map(x => x[1]);
    }

    // engine.py: evaluate (white-positive centipawns)
    evaluate(){
      const S = this.sq; let score = 0, wMat = 0, bMat = 0, pieces = 0, pawns = 0, wk = -1, bk = -1;
      for (let i = 0; i < 64; i++){
        const p = S[i]; if (!p) continue;
        const rank = i >> 3;
        switch (p){
          case 'P': wMat += 100; pawns++; score += rank*2; if (rank === 6) score += 30; if (CENTER.has(i)) score += 20; break;
          case 'p': bMat += 100; pawns++; score -= (7-rank)*2; if (rank === 1) score -= 30; if (CENTER.has(i)) score -= 20; break;
          case 'N': wMat += 320; pieces++; if (CENTER.has(i)) score += 30; break;
          case 'n': bMat += 320; pieces++; if (CENTER.has(i)) score -= 30; break;
          case 'B': wMat += 330; pieces++; if (CENTER.has(i)) score += 20; break;
          case 'b': bMat += 330; pieces++; if (CENTER.has(i)) score -= 20; break;
          case 'R': wMat += 500; pieces++; break;
          case 'r': bMat += 500; pieces++; break;
          case 'Q': wMat += 900; pieces++; break;
          case 'q': bMat += 900; pieces++; break;
          case 'K': wk = i; break;
          case 'k': bk = i; break;
        }
      }
      score += wMat - bMat;
      // development penalties
      if (S[1] === 'N') score -= 15; if (S[6] === 'N') score -= 15;
      if (S[57] === 'n') score += 15; if (S[62] === 'n') score += 15;
      if (S[2] === 'B') score -= 10; if (S[5] === 'B') score -= 10;
      if (S[58] === 'b') score += 10; if (S[61] === 'b') score += 10;

      const isEndgame = pieces <= 2 && pawns < 4;
      const cmd = sq => { const r = sq >> 3, c = sq & 7; return Math.max(3 - r, r - 4) + Math.max(3 - c, c - 4); };
      const md = (a, b) => Math.abs((a>>3)-(b>>3)) + Math.abs((a&7)-(b&7));
      if (isEndgame){
        const diff = wMat - bMat;
        if (diff > 300 && bk !== -1 && wk !== -1){ score += cmd(bk)*10; score += (14 - md(wk, bk))*4; }
        else if (diff < -300 && bk !== -1 && wk !== -1){ score -= cmd(wk)*10; score -= (14 - md(bk, wk))*4; }
      } else {
        if (wk === 2 || wk === 6) score += 40; else if (wk === 1 || wk === 7) score += 20; else if (wk > 7) score -= 40;
        if (bk === 58 || bk === 62) score -= 40; else if (bk === 57 || bk === 63) score -= 20; else if (bk !== -1 && bk < 56) score += 40;
      }
      return score;
    }

    tick(){ if ((++this.nodes & 1023) === 0 && Date.now() > this.deadline) throw ABORT; }

    quiescence(alpha, beta){
      this.tick();
      const stand = this.evaluate();
      if (this.whiteToMove){ if (stand >= beta) return beta; alpha = Math.max(alpha, stand); }
      else { if (stand <= alpha) return alpha; beta = Math.min(beta, stand); }
      let caps = this.allLegal(this.whiteToMove).filter(m => this.sq[m[1]]);
      caps = this.orderMoves(caps, null);
      if (this.whiteToMove){
        let best = stand;
        for (const m of caps){ const st = this.save(); this.makeMove(m[0], m[1]);
          const v = this.quiescence(alpha, beta); this.restore(st);
          best = Math.max(best, v); alpha = Math.max(alpha, v); if (beta <= alpha) break; }
        return best;
      } else {
        let best = stand;
        for (const m of caps){ const st = this.save(); this.makeMove(m[0], m[1]);
          const v = this.quiescence(alpha, beta); this.restore(st);
          best = Math.min(best, v); beta = Math.min(beta, v); if (beta <= alpha) break; }
        return best;
      }
    }

    minimax(depth, alpha, beta, ply){
      this.tick();
      const key = this.hash(), alphaOrig = alpha;
      const ent = this.tt.get(key);
      if (ent && ent.depth >= depth){
        // mate scores are stored relative to this node; convert back to distance from the root
        const ev = ent.eval > 90000 ? ent.eval - ply : ent.eval < -90000 ? ent.eval + ply : ent.eval;
        if (ent.flag === 0) return ev;
        if (ent.flag === 1) alpha = Math.max(alpha, ev);
        else if (ent.flag === 2) beta = Math.min(beta, ev);
        if (alpha >= beta) return ev;
      }
      if (depth === 0) return this.quiescence(alpha, beta);
      const moves = this.orderMoves(this.allLegal(this.whiteToMove), key);
      if (!moves.length){
        if (this.inCheck(this.whiteToMove)) return this.whiteToMove ? -99999 + ply : 99999 - ply;
        return 0;
      }
      let best = null, bestVal;
      if (this.whiteToMove){
        bestVal = -Infinity;
        for (const m of moves){ const st = this.save(); this.makeMove(m[0], m[1]);
          const v = this.minimax(depth-1, alpha, beta, ply+1); this.restore(st);
          if (v > bestVal){ bestVal = v; best = m; } alpha = Math.max(alpha, v); if (beta <= alpha) break; }
      } else {
        bestVal = Infinity;
        for (const m of moves){ const st = this.save(); this.makeMove(m[0], m[1]);
          const v = this.minimax(depth-1, alpha, beta, ply+1); this.restore(st);
          if (v < bestVal){ bestVal = v; best = m; } beta = Math.min(beta, v); if (beta <= alpha) break; }
      }
      let flag = 0; if (bestVal <= alphaOrig) flag = 2; else if (bestVal >= beta) flag = 1;
      if (this.tt.size > 1500000) this.tt.clear();
      const stored = bestVal > 90000 ? bestVal + ply : bestVal < -90000 ? bestVal - ply : bestVal;
      this.tt.set(key, {eval: stored, depth, flag, best});
      return bestVal;
    }

    // engine.py: get_best_move
    bestMove(timeLimit = 1.5, rating = 2000, historyHashes = new Set(), allowBook = true){
      const useBook = allowBook && rating >= 1200;
      let cap = 20;
      if (rating < 800){ cap = 1; timeLimit = Math.min(timeLimit, 0.1); }
      else if (rating < 1400){ cap = 3; timeLimit = Math.min(timeLimit, 0.5); }
      else if (rating < 1800){ cap = 4; timeLimit = Math.min(timeLimit, 1.0); }

      if (useBook){
        const bm = this.openingMove();
        if (bm) return {move: bm, eval: 0, lines: [["Book Move", bm]], depth: 0};
      }
      const start = Date.now();
      this.deadline = start + timeLimit*1000; this.nodes = 0;
      let bestOverall = null, bestValOverall = 0, rootScores = [], reached = 0;

      for (let depth = 1; depth <= cap; depth++){
        const key = this.hash();
        const moves = this.orderMoves(this.allLegal(this.whiteToMove), key);
        if (!moves.length) break;
        let alpha = -Infinity, beta = Infinity;
        let bestVal = this.whiteToMove ? -Infinity : Infinity, bestMove = null, ranOut = false;
        const scores = [];
        const rootState = this.save();
        for (const m of moves){
          if (Date.now() - start > timeLimit*1000){ ranOut = true; break; }
          this.makeMove(m[0], m[1]);
          let v;
          try { v = this.minimax(depth - 1, alpha, beta, 1); }
          catch (err){ if (err !== ABORT) throw err; this.restoreCopy(rootState); ranOut = true; break; }
          if (historyHashes.has(this.hash())){
            if (this.whiteToMove && v > 100) v -= 500;
            else if (!this.whiteToMove && v < -100) v += 500;
          }
          this.restoreCopy(rootState); // back to the root position
          scores.push([v, m]);
          if (this.whiteToMove){ if (v > bestVal){ bestVal = v; bestMove = m; } alpha = Math.max(alpha, v); }
          else { if (v < bestVal){ bestVal = v; bestMove = m; } beta = Math.min(beta, v); }
        }
        if (ranOut){ if (!bestOverall) bestOverall = bestMove || moves[0]; break; }
        bestOverall = bestMove; bestValOverall = bestVal; rootScores = scores; reached = depth;
        this.tt.set(key, {eval: bestVal, depth, flag: 0, best: bestOverall});
      }
      this.deadline = Infinity;
      const white = this.whiteToMove;
      const isBest = m => bestOverall && m[0] === bestOverall[0] && m[1] === bestOverall[1];
      rootScores.sort((a, b) => (white ? b[0] - a[0] : a[0] - b[0]) || (isBest(b[1]) - isBest(a[1])));
      return {move: bestOverall, eval: bestValOverall, lines: rootScores.slice(0, 3), depth: reached};
    }
  }
  return {Board};
}

