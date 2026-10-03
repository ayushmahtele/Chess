import { h, toast, clear } from '../dom.js';
import { icon } from '../icons.js';
import { LEVELS, START_RD, NEW_VOL, isProvisional, startingRatings, ratingsOf } from '../rating.js';
import { session, cloudEnabled, createCloudProfile, usernameOwner, USERNAME_RE, cleanUsername, friendlyError } from '../store/index.js';
import { localStore } from '../store/local.js';
import { APP_NAME } from '../config.js';
import { musicCard } from './music-panel.js';

const PIECES = { beginner: 'wP', intermediate: 'wN', pro: 'wQ' };

export async function onboardingView(main, _p, ctx) {
  if (ctx.profile) { ctx.go('/'); return; }
  const { user, store } = session();
  const guest = user ? await localStore.exportAll() : null;
  const hasGuest = !!guest?.profile;
  let level = 'beginner', useGuest = hasGuest;

  const nameIn = h('input.text-in', { id: 'nm', maxlength: 24, value: user?.name?.split(' ')[0] || guest?.profile?.name || '', placeholder: 'Your name', autocomplete: 'nickname' });
  const lockedUser = user?.passwordUsername;
  const userIn = h('input.text-in', { id: 'un', maxlength: 20, value: lockedUser || '', placeholder: 'username', autocapitalize: 'none', spellcheck: false, disabled: !!lockedUser });
  const avail = h('small.avail', lockedUser ? 'This is your sign-in username.' : '');
  let t;
  userIn.addEventListener('input', () => {
    clearTimeout(t); const u = cleanUsername(userIn.value);
    if (!USERNAME_RE.test(u)) { avail.textContent = u ? '3–20 characters: letters, numbers and _' : ''; avail.className = 'avail bad'; return; }
    avail.textContent = 'Checking…'; avail.className = 'avail';
    t = setTimeout(async () => { const o = await usernameOwner(u); const taken = o && o !== user.uid; avail.textContent = taken ? `@${u} is taken` : `@${u} is available`; avail.className = 'avail ' + (taken ? 'bad' : 'ok'); }, 350);
  });

  const levelBox = h('div');
  // Level cards act like buttons but keep their text selectable (so it can be copied).
  const pick = (choose, on) => ({ role: 'button', tabindex: 0, 'aria-pressed': String(on), on: {
    click: () => { if (String(getSelection?.() || '').length) return; choose(); renderLevels(); },
    keydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); renderLevels(); } } } });
  function renderLevels() {
    clear(levelBox);
    if (hasGuest) levelBox.append(h('div.levels', { style: { gridTemplateColumns: '1fr 1fr' } },
      h('div.level', pick(() => { useGuest = true; }, useGuest),
        h('div.pc', '↪'), h('b', 'Continue my guest progress'), h('span.rr', `Rating ${guest.profile.rating}${isProvisional(guest.profile.rd) ? '?' : ''}`),
        h('p', `Moves your rating and ${guest.games.length} saved ${guest.games.length > 1 ? 'games' : 'game'} from this browser into your account.`)),
      h('div.level', pick(() => { useGuest = false; }, !useGuest),
        h('div.pc', '✦'), h('b', 'Start fresh'), h('span.rr', 'Choose a level'), h('p', 'Your guest games stay in this browser only.'))));
    if (!useGuest) levelBox.append(h('div.levels', Object.entries(LEVELS).map(([k, L]) => h('div.level', { 'data-k': k, ...pick(() => { level = k; }, k === level) },
      h('div.pc', h('img', { src: `/pieces3d/porcelain/${PIECES[k]}.webp`, alt: '' })), h('b', L.label), h('span.rr', `Starts at ${L.rating} rating`), h('p', L.blurb)))));
  }
  renderLevels();

  const btn = h('button.btn.primary', { style: { height: '50px', padding: '0 28px' }, on: { click: create } }, user ? 'Create my account' : 'Start playing as guest');
  async function create() {
    const name = nameIn.value.trim() || 'Player';
    btn.disabled = true;
    try {
      let profile;
      if (useGuest && hasGuest) profile = { ...guest.profile, name, ratings: ratingsOf(guest.profile) };
      else {
        const L = LEVELS[level];
        profile = { name, level, rating: L.rating, rd: START_RD, vol: NEW_VOL, peak: L.rating, startRating: L.rating,
          games: 0, wins: 0, losses: 0, draws: 0, createdAt: Date.now(), lastPlayed: null, ratingHistory: [{ t: Date.now(), r: L.rating }],
          ratings: startingRatings(L.rating), statsV2: true };
      }
      const nowUser = session().user;                 // read at click time (the page may have been drawn a moment before sign-up finished)
      if (nowUser) {
        await createCloudProfile({ ...profile, username: nowUser.passwordUsername || userIn.value });
        if (useGuest && hasGuest) {
          for (const g of guest.games) { const { id, ...rest } = g; await session().store.addGame(rest); }
          await localStore.deleteAccountData();
        }
      } else await session().store.saveProfile(profile);
      await ctx.refreshProfile(); ctx.go('/'); toast(`Welcome, ${name}!`);
    } catch (e) { toast(friendlyError(e), 'error'); btn.disabled = false; }
  }

  main.append(h('section.onb',
    h('h1', `Welcome to ${APP_NAME}`),
    h('p.muted', hasGuest ? 'You already played here as a guest. Bring that progress into your account, or start fresh.'
      : 'Pick the level that fits you. It sets your starting rating. Your first couple of games move your rating a lot. A pro who loses early will see their rating drop quickly.'),
    musicCard(),
    levelBox,
    user && h('div.field', h('label', { for: 'un' }, 'Username'), userIn, avail, !lockedUser && h('small.muted', 'Friends use this to challenge you online. You can change it later in your Profile.')),
    h('div.field', h('label', { for: 'nm' }, 'Display name'), nameIn),
    h('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' } },
      btn, !user && cloudEnabled && h('a.btn', { href: '#/login', style: { height: '50px' } }, 'Sign in or create an account instead')),
    !user && h('p.muted', { style: { marginTop: '14px', fontSize: '.88rem' } },
      cloudEnabled ? 'Guest games are saved in this browser only. Sign in to keep your rating and games on every device and to play online.'
        : 'Your rating and games are saved in this browser.'),
  ));
}
