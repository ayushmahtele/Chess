import './style.css';

// Hidden parts of a page are written as `condition && element`. The browser's append() would print
// "false" for those, so skip false/null/undefined everywhere.
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  for (const fn of ['append', 'prepend', 'replaceChildren']) {
    const orig = proto[fn];
    proto[fn] = function (...nodes) { return orig.apply(this, nodes.filter(n => n !== false && n != null)); };
  }
}
import { h, $, clear, toast } from './dom.js';
import { icon } from './icons.js';
import { APP_NAME } from './config.js';
import { applyTheme, getPrefs, onPrefs } from './prefs.js';
import { setSfxVolume } from './audio/sfx.js';
import { initSession, onSession, session, cloudEnabled, friendlyError } from './store/index.js';
import { isProvisional } from './rating.js';
import { avatar } from './avatar.js';
import { spotify } from './audio/spotify.js';
import { musicButton, closeMusic } from './views/music-panel.js';

import { homeView } from './views/home.js';
import { gameView } from './views/game-view.js';
import { historyView } from './views/history.js';
import { reviewView } from './views/review.js';
import { profileView } from './views/profile.js';
import { settingsView } from './views/settings.js';
import { onboardingView } from './views/onboarding.js';
import { loginView } from './views/login.js';
import { onlineLobbyView } from './views/online-lobby.js';
import { onlineGameView } from './views/online-game.js';
import { joinGame, declineChallenge, COLL } from './online.js';
import { TIME_CONTROLS } from './config.js';

document.title = APP_NAME;
applyTheme(); setSfxVolume(getPrefs().sfxVolume);
onPrefs(p => { applyTheme(); setSfxVolume(p.sfxVolume); });

const ROUTES = [
  { re: /^\/?$/, view: homeView, nav: 'play' },
  { re: /^\/game$/, view: gameView, nav: 'play', full: true },
  { re: /^\/history$/, view: historyView, nav: 'history' },
  { re: /^\/review\/(.+)$/, view: reviewView, nav: 'history', full: true },
  { re: /^\/profile$/, view: profileView, nav: 'profile' },
  { re: /^\/settings$/, view: settingsView, nav: 'settings', noProfile: true },
  { re: /^\/welcome$/, view: onboardingView, nav: '', noProfile: true },
  { re: /^\/login$/, view: loginView, nav: '', noProfile: true },
  { re: /^\/online$/, view: onlineLobbyView, nav: 'online' },
  { re: /^\/play\/(.+)$/, view: onlineGameView, nav: 'online', full: true },
];

const app = $('#app');
const userSlot = h('div.top-right');
const navLinks = [['play', '#/', 'Play', 'board'], ['online', '#/online', 'Online', 'globe'], ['history', '#/history', 'History', 'history'], ['profile', '#/profile', 'Profile', 'user'], ['settings', '#/settings', 'Settings', 'gear']];
const nav = h('nav.nav', { 'aria-label': 'Main' }, navLinks.map(([k, href, label]) => h('a', { href, 'data-k': k }, label)));
const tabbar = h('nav.tabbar', { 'aria-label': 'Main' }, navLinks.map(([k, href, label, ic]) => h('a', { href, 'data-k': k }, icon(ic), label)));
const main = h('main', { id: 'main' });
// "Back" button under the logo: returns to the previous page inside the app, or to Play.
const visited = [];
const backBtn = h('button.backbtn', { 'aria-label': 'Go back', title: 'Back', on: { click: () => {
  if (visited.length > 1) history.back(); else location.hash = '/';
} } }, icon('back'), h('span', 'Back'));
app.append(
  h('header.topbar', h('a.logo', { href: '#/' }, h('img', { src: '/favicon.svg', alt: '' }), APP_NAME), nav, userSlot),
  backBtn, main, tabbar);

let profile = null, cleanup = null, routing = 0;
export const ctx = {
  get profile() { return profile; },
  async refreshProfile() { profile = await session().store.getProfile(); renderUser(); return profile; },
  go(path) { if (location.hash === '#' + path) route(); else location.hash = path; },
};

spotify.onSave = async link => {
  try { const p = await session().store.getProfile(); if (p) { p.spotify = link; await session().store.saveProfile(p); profile = p; } } catch (e) { console.warn('Could not save Spotify link', e); }
};
function renderUser() {
  spotify.useAccount(session().user?.uid || 'guest', profile?.spotify);
  clear(userSlot);
  userSlot.append(musicButton());
  const { user } = session();
  if (profile) {
    const pic = avatar(profile, user);
    userSlot.append(h('a.user-chip', { href: '#/profile', title: 'Your profile' }, pic,
      h('span.nm', profile.name), h('span.r', profile.rating + (isProvisional(profile.rd) ? '?' : ''))));
  }
  if (!user && cloudEnabled) userSlot.append(h('a.btn', { href: '#/login' }, h('span', 'Sign in')));
}

async function route() {
  const my = ++routing;
  closeMusic();
  const path = location.hash.replace(/^#/, '') || '/';
  const r = ROUTES.find(x => x.re.test(path)) || ROUTES[0];
  const params = path.match(r.re)?.slice(1) || [];
  if (visited.at(-1) !== path) { if (visited.at(-2) === path) visited.pop(); else visited.push(path); }
  backBtn.classList.toggle('hidden', path === '/' || path === '');
  document.querySelectorAll('.nav a, .tabbar a').forEach(a => a.classList.toggle('active', a.dataset.k === r.nav));
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  clear(main).append(h('div.loading', 'Loading…'));
  try { profile = await session().store.getProfile(); }
  catch (e) { console.error(e); toast('Could not load your profile: ' + e.message, 'error'); profile = null; }
  if (my !== routing) return;
  renderUser();
  if (!profile && !r.noProfile) { location.hash = '/welcome'; return; }
  clear(main);
  main.style.maxWidth = r.full ? '1500px' : '';
  main.classList.toggle('full', !!r.full);
  document.body.classList.toggle('in-game', !!r.full);
  document.body.classList.toggle('has-back', path !== '/' && path !== '');
  cleanup = await r.view(main, params, ctx) || null;
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
onSession(() => { route(); watchChallenges(); });

/* Pop-up when a friend challenges you, on every page */
const pop = h('div.challenge-pop', { 'aria-live': 'polite' });
document.body.append(pop);
let stopWatch = null, watchedUid = null;
function watchChallenges() {
  const { user, db } = session();
  if (user?.uid === watchedUid) return;
  stopWatch?.(); stopWatch = null; clear(pop); watchedUid = user?.uid || null;
  if (!user || !db) return;
  const seen = new Set();
  stopWatch = db.watchQuery(COLL, { where: [['invitee', '==', user.uid], ['status', '==', 'waiting']] }, list => {
    clear(pop);
    if (location.hash.startsWith('#/online') || !profile) return;
    for (const g of list.slice(0, 3)) {
      const from = g.p[g.createdBy], tc = TIME_CONTROLS.find(t => t.id === g.tcId)?.label || 'No clock';
      if (!seen.has(g.id)) { seen.add(g.id); import('./audio/sfx.js').then(m => m.sfx.start()); }
      pop.append(h('div.card', h('b', `@${from.username} challenges you`), h('div.muted', `${from.name} (${from.rating}) · ${tc} · ${g.rated ? 'Rated' : 'Casual'}`),
        h('div.row',
          h('button.btn', { on: { click: () => declineChallenge(g.id).catch(e => toast(friendlyError(e), 'error')) } }, 'Decline'),
          h('button.btn.primary', { on: { click: async () => { try { await joinGame(g.id, profile); ctx.go('/play/' + g.id); } catch (e) { toast(friendlyError(e), 'error'); } } } }, 'Accept'))));
    }
  }, () => {});
}
window.addEventListener('hashchange', () => { if (location.hash.startsWith('#/online')) clear(pop); });
initSession();
