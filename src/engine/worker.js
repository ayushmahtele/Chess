import { createEngine } from './engine.js';
const { Board } = createEngine();
let board = new Board();

// Opening-book key: chess.js gives UCI-like moves; the engine book uses "e2e4 e7e5 ..."
self.onmessage = (ev) => {
  const d = ev.data;
  if (d.type === 'reset') { board = new Board(); return; }
  const tt = board.tt;
  board.loadFEN(d.fen);
  board.tt = tt;
  board.history = d.uci.map(m => [sqIdx(m.slice(0, 2)), sqIdx(m.slice(2, 4))]);
  const hashes = new Set(d.historyFens.map(f => new Board().loadFEN(f).hash()));
  const r = board.bestMove(d.timeLimit, d.rating, hashes, d.useBook !== false);
  // Weaker bot levels make occasional human-like mistakes
  if (d.mode === 'play' && d.rating < 1000 && Math.random() < (1000 - d.rating) / 1500) {
    board.loadFEN(d.fen);
    const all = board.allLegal(board.whiteToMove);
    if (all.length) r.move = all[Math.floor(Math.random() * all.length)];
  }
  self.postMessage({ id: d.id, result: r });
};
function sqIdx(s) { return (+s[1] - 1) * 8 + (s.charCodeAt(0) - 97); }
