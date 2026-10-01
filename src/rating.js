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
export const START_RD = 250; // new accounts (self-chosen level)
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
