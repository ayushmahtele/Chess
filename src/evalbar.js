// Shared evaluation helpers (scores are centipawns, positive = White is better).
export const MATE = 90000;
export const isMate = v => Math.abs(v) > MATE;

/** Text like "+1.4", "-0.3", "M3", "#" */
export function scoreText(v, { sign = true } = {}) {
  if (v == null) return '…';
  if (Math.abs(v) >= 100000) return '#';
  if (isMate(v)) return (sign ? (v > 0 ? '+' : '-') : '') + 'M' + Math.ceil((99999 - Math.abs(v)) / 2);
  const p = v / 100;
  return (sign && p > 0 ? '+' : '') + (Math.abs(p) >= 10 ? p.toFixed(0) : p.toFixed(1));
}

/** Winning chances for White, 0–100 (same curve Lichess uses). */
export function winPct(v) {
  if (isMate(v)) return v > 0 ? 100 : 0;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * v)) - 1);
}

/** Bar fill for White, 0–100. Fills up smoothly and is nearly full around ±10. */
export function barPct(v) {
  if (v == null) return 50;
  if (isMate(v)) return v > 0 ? 100 : 0;
  return Math.max(3, Math.min(97, 50 + 50 * (2 / (1 + Math.exp(-0.0045 * v)) - 1)));
}

/** Update an .evalbar element */
export function paintBar(bar, v, orientation) {
  bar.classList.toggle('flip', orientation === 'b');
  bar.querySelector('.fill').style.height = barPct(v) + '%';
  const num = bar.querySelector('.num');
  num.textContent = scoreText(v, { sign: false }).replace('-', '');
  const white = v == null || v >= 0;
  const atBottom = white === (orientation === 'w');
  num.style.top = atBottom ? '' : '4px'; num.style.bottom = atBottom ? '4px' : '';
  num.style.color = white ? '#222' : '#ddd';
}

/** Classify a move by how much winning chance the mover lost. */
export function classify(before, after, color) {
  const sgn = color === 'w' ? 1 : -1;
  const drop = sgn * (winPct(before) - winPct(after));
  if (drop >= 30) return { tag: '??', name: 'Blunder', drop };
  if (drop >= 20) return { tag: '?', name: 'Mistake', drop };
  if (drop >= 10) return { tag: '?!', name: 'Inaccuracy', drop };
  return { tag: '', name: '', drop: Math.max(0, drop) };
}
/** Per-move accuracy from the win-chance drop (Lichess formula). */
export const moveAccuracy = drop => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * drop) - 3.1669));

/* ---------------- Move and position symbols (standard chess annotation) ---------------- */
export const MOVE_KINDS = {
  brilliant:   { sym: '!!', name: 'Brilliant move',   cls: 'k-brilliant',   about: 'A strong move that sacrifices material' },
  great:       { sym: '!',  name: 'Good move',        cls: 'k-great',       about: 'The best reply that punishes the opponent\'s error' },
  best:        { sym: '★',  name: 'Best move',        cls: 'k-best',        about: 'The move the engine would play' },
  book:        { sym: '📖', name: 'Book move',        cls: 'k-book',        about: 'A known opening move' },
  interesting: { sym: '!?', name: 'Interesting move', cls: 'k-interesting', about: 'A risky sacrifice that is not clearly bad' },
  inaccuracy:  { sym: '?!', name: 'Weak move',        cls: 'k-inaccuracy',  about: 'Inaccuracy: a better move was available' },
  mistake:     { sym: '?',  name: 'Bad move',         cls: 'k-mistake',     about: 'Mistake: gives away a good part of the advantage' },
  blunder:     { sym: '??', name: 'Blunder',          cls: 'k-blunder',     about: 'Throws away the game or a lot of material' },
};

/** Position symbol for an evaluation (and material imbalance for "unclear"). */
export function positionSymbol(v, materialDiff = 0) {
  if (v == null) return null;
  if (isMate(v)) return v > 0 ? { sym: '+-', text: 'White has a winning position' } : { sym: '-+', text: 'Black has a winning position' };
  const p = v / 100, a = Math.abs(p);
  if (a < 0.7 && Math.abs(materialDiff) >= 2) return { sym: '∞', text: 'Unclear position' };
  if (a < 0.5) return { sym: '=', text: 'Equal position' };
  if (a < 1.5) return p > 0 ? { sym: '⩲', text: 'White has a slightly better position' } : { sym: '⩱', text: 'Black has a slightly better position' };
  if (a < 3) return p > 0 ? { sym: '±', text: 'White has the better position' } : { sym: '∓', text: 'Black has the better position' };
  return p > 0 ? { sym: '+-', text: 'White has a winning position' } : { sym: '-+', text: 'Black has a winning position' };
}

export const NOTATION_KEY = [
  ['x', 'Capture'], ['+', 'Check'], ['#', 'Checkmate'], ['O-O', 'King-side castling'], ['O-O-O', 'Queen-side castling'],
  ['=Q', 'Pawn promotes (to a queen)'], ['1-0', 'White wins'], ['0-1', 'Black wins'], ['½-½', 'Draw'],
];
export const POSITION_KEY = [
  ['⩲', 'White has a slightly better position'], ['±', 'White has the better position'], ['+-', 'White has a winning position'],
  ['⩱', 'Black has a slightly better position'], ['∓', 'Black has the better position'], ['-+', 'Black has a winning position'],
  ['=', 'Equal position'], ['∞', 'Unclear position'],
];
