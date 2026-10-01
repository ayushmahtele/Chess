// Talks to the engine running in a Web Worker so the page never freezes.
let worker = null, nextId = 1;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./engine/worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); p(e.data.result); } };
  }
  return worker;
}

/**
 * @param chess chess.js instance (position to search)
 * @param opts {rating, timeLimit, mode:'play'|'hint'|'analysis'}
 */
export function think(chess, { rating = 2000, timeLimit = 1.5, mode = 'play' } = {}) {
  const hist = chess.history({ verbose: true });
  const uci = hist.map(m => m.from + m.to);
  const historyFens = hist.map(m => m.after);
  return new Promise(resolve => {
    const id = nextId++;
    pending.set(id, resolve);
    getWorker().postMessage({ id, fen: chess.fen(), uci, historyFens, rating, timeLimit, mode, useBook: mode === 'play' });
  });
}
export function resetEngine() { getWorker().postMessage({ type: 'reset' }); }
