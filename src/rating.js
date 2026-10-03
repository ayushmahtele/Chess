// Glicko-2 rating system (the same family of system chess.com uses).
// New accounts start with a high rating deviation (RD), so early wins and
// losses move the rating a lot; as you play more games, RD shrinks and
// changes become smaller.

export const LEVELS = {
  beginner:     { label: 'Beginner',     rating: 800,  blurb: 'I know how the pieces move.' },
  intermediate: { label: 'Intermediate', rating: 1200, blurb: 'I play regularly and know basic tactics.' },
  pro:          { label: 'Pro',          rating: 1600, blurb: 'I know openings, tactics and endgames well.' },
};

export const NEW_RD = 350;   // maximum uncertainty
export const START_RD = 200; // new accounts, every rating (the player already told us their level, so we are fairly, not totally, unsure)
export const START_RD_ONLINE = START_RD;
export const MAX_CHANGE = 150;     // one game can move a rating by at most this much (lucky disconnects, friends throwing games, mislabelled bots)
export const MAX_ONLINE_CHANGE = MAX_CHANGE;
export const BOT_RD = 60;          // the computer's level counts as a fairly certain rating
export const NEW_VOL = 0.06;
const TAU = 0.5;
const SCALE = 173.7178;

export function isProvisional(rd) { return rd > 110; }

/**
 * @param player {rating, rd, vol}
 * @param opp    {rating, rd}
 * @param score  1 win, 0.5 draw, 0 loss
 */
export function glicko2(player, opp, score) {
  const mu = (player.rating - 1500) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.vol;
  const muJ = (opp.rating - 1500) / SCALE;
  const phiJ = opp.rd / SCALE;

  const g = 1 / Math.sqrt(1 + 3 * phiJ * phiJ / (Math.PI * Math.PI));
  const E = 1 / (1 + Math.exp(-g * (mu - muJ)));
  const v = 1 / (g * g * E * (1 - E));
  const delta = v * g * (score - E);

  // volatility update (Illinois algorithm)
  const a = Math.log(sigma * sigma);
  const f = x => {
    const ex = Math.exp(x);
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * Math.pow(phi * phi + v + ex, 2)) - (x - a) / (TAU * TAU);
  };
  let A = a, B;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else { let k = 1; while (f(a - k * TAU) < 0) k++; B = a - k * TAU; }
  let fA = f(A), fB = f(B);
  for (let i = 0; i < 100 && Math.abs(B - A) > 1e-6; i++) {
    const C = A + (A - B) * fA / (fB - fA), fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else fA /= 2;
    B = C; fB = fC;
  }
  const newSigma = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * g * (score - E);

  return {
    rating: Math.max(100, Math.round(newMu * SCALE + 1500)),
    rd: Math.min(NEW_RD, Math.max(45, newPhi * SCALE)),
    vol: newSigma,
  };
}

/** RD slowly grows back when you haven't played for a while (like chess.com). */
export function inflateRd(rd, lastPlayedMs) {
  if (!lastPlayedMs) return rd;
  const days = (Date.now() - lastPlayedMs) / 86400000;
  if (days < 1) return rd;
  return Math.min(NEW_RD, Math.sqrt(rd * rd + 15 * 15 * Math.min(days, 365) / 30));
}

/* ---------------- rating categories (like chess.com) ---------------- */
import { TIME_CONTROLS } from './config.js';
export const CATEGORIES = [
  { id: 'bullet', label: 'Bullet', icon: '⚡' },
  { id: 'blitz', label: 'Blitz', icon: '🔥' },
  { id: 'rapid', label: 'Rapid', icon: '⏱' },
  { id: 'noclock', label: 'No clock', icon: '♾' },
  { id: 'computer', label: 'vs Computer', short: 'Computer', icon: '🤖' },
];
export const ONLINE_CATS = ['bullet', 'blitz', 'rapid', 'noclock'];
export const catInfo = id => CATEGORIES.find(c => c.id === id);
/** Which online rating a time control counts for. */
export function categoryOfTc(tcId) {
  const g = TIME_CONTROLS.find(t => t.id === tcId)?.group;
  return g === 'Bullet' ? 'bullet' : g === 'Blitz' ? 'blitz' : g === 'Rapid' ? 'rapid' : 'noclock';
}
/**
 * All five ratings of a profile. Older profiles (one computer rating + one online rating) are converted:
 * vs Computer keeps the old rating; the four online ratings all start from the old online rating
 * (or the starting level), and from then on change separately.
 */
export function ratingsOf(profile) {
  const r = { ...(profile?.ratings || {}) };
  if (!r.computer) r.computer = { rating: profile?.rating ?? 1200, rd: profile?.rd ?? START_RD, vol: profile?.vol ?? NEW_VOL,
    peak: profile?.peak ?? profile?.rating ?? 1200, history: profile?.ratingHistory || [], lastPlayed: profile?.lastPlayed || null };
  const base = profile?.online || { rating: profile?.startRating ?? profile?.rating ?? 1200, rd: START_RD_ONLINE, vol: NEW_VOL };
  for (const c of ONLINE_CATS) if (!r[c]) r[c] = { rating: base.rating, rd: base.rd ?? START_RD_ONLINE, vol: base.vol ?? NEW_VOL,
    peak: base.rating, history: [{ t: profile?.createdAt || Date.now(), r: base.rating }], lastPlayed: base.lastPlayed || null };
  return r;
}
/** New accounts: every category starts at the chosen level. */
export function startingRatings(rating) {
  const now = Date.now(), r = {};
  for (const c of CATEGORIES) r[c.id] = { rating, rd: START_RD, vol: NEW_VOL, peak: rating, history: [{ t: now, r: rating }], lastPlayed: null };
  return r;
}
/** Overall = average of the four online ratings (vs Computer not included). */
export function overallOf(profile) {
  const r = ratingsOf(profile), n = ONLINE_CATS.length;
  return { rating: Math.round(ONLINE_CATS.reduce((s, c) => s + r[c].rating, 0) / n), rd: ONLINE_CATS.reduce((s, c) => s + r[c].rd, 0) / n };
}
/** Apply one rated result to a category entry; returns the updated entry. maxChange limits the jump (online games). */
export function rateGame(entry, oppRating, oppRd, score, maxChange = Infinity) {
  const next = glicko2({ rating: entry.rating, rd: inflateRd(entry.rd, entry.lastPlayed), vol: entry.vol }, { rating: oppRating, rd: oppRd }, score);
  next.rating = Math.max(entry.rating - maxChange, Math.min(entry.rating + maxChange, next.rating));
  return { ...entry, ...next, peak: Math.max(entry.peak || 0, next.rating), lastPlayed: Date.now(),
    history: [...(entry.history || []), { t: Date.now(), r: next.rating }].slice(-300) };
}

/** Count a finished game in a category (kept on the profile, so deleting History doesn't change it). */
export function countResult(entry, outcome, rated = false) {
  if (outcome === 'aborted') return entry;
  const add = o => {
    o.games = (o.games || 0) + 1;
    if (outcome === 'win') o.wins = (o.wins || 0) + 1; else if (outcome === 'loss') o.losses = (o.losses || 0) + 1; else o.draws = (o.draws || 0) + 1;
  };
  add(entry);                                    // every game of this type
  if (rated) add(entry.rated = entry.rated || {}); // only the games that changed this rating
  return entry;
}
export const plural = (n, word) => `${n} ${n === 1 ? word : word + 's'}`;

/**
 * What one game would do to a rating, shown before the game like chess.com: { win: +12, draw: 0, loss: -12 }.
 * Uses exactly the same maths as the real update.
 */
export function previewChange(entry, oppRating, oppRd) {
  const d = score => rateGame(entry, oppRating, oppRd, score, MAX_CHANGE).rating - entry.rating;
  return { win: d(1), draw: d(0.5), loss: d(0) };
}
export const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n);
