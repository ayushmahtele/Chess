const KEY = 'chessarena:prefs';
const DEFAULTS = {
  theme: 'system', boardTheme: 'green', view: '2d', set2d: 'cburnett', set3d: 'wood', board3d: 'lightwood', soundTheme: 'soft', coords: true, legalHints: true, highlightLast: true,
  autoQueen: false, autoFlip: true, confirmResign: true, evalBar: true, animate: true,
  sfxVolume: 0.7, lastSetup: null,
};
let prefs = { ...DEFAULTS };
try { prefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch {}
// Players who had the old bright default move to the new gentle sounds once (they can switch back in Settings).
if (!prefs.soundV2) { if (prefs.soundTheme === 'wood') prefs.soundTheme = 'soft'; prefs.soundV2 = true; try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {} }
const subs = new Set();
export const getPrefs = () => prefs;
export function setPref(k, v) { prefs = { ...prefs, [k]: v }; try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {} subs.forEach(f => f(prefs)); }
export const onPrefs = f => { subs.add(f); return () => subs.delete(f); };
export function applyTheme() {
  const t = prefs.theme;
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
