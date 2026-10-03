import { h, clear } from '../dom.js';
import { icon } from '../icons.js';
import { music } from '../audio/music.js';
import { spotify, parseSpotify, spotifyUrl, itemName } from '../audio/spotify.js';
import { getPrefs, setPref } from '../prefs.js';

let drawer = null;

export function musicButton() {
  const btn = h('button.icon-btn.music-btn', { title: 'Music and sound', 'aria-label': 'Music and sound', 'aria-haspopup': 'dialog', 'aria-expanded': String(!!drawer),
    on: { click: () => toggle() } }, icon('music'), h('span.eq', { 'aria-hidden': 'true' }, h('i'), h('i'), h('i')));
  btn.classList.toggle('open', !!drawer);
  const sync = () => {
    if (sync.ran && !btn.isConnected) { off1(); off2(); return; }   // button was replaced: stop listening
    sync.ran = true;
    btn.classList.toggle('on', music.playing || spotify.playing);
  };
  const off1 = music.on(sync), off2 = spotify.on(sync); sync();
  return btn;
}

/** Mark the top-bar music button as "open" while the panel is showing, so it is clear where the panel comes from. */
function markButtons(open, ping = false) {
  document.querySelectorAll('.music-btn').forEach(b => {
    b.classList.toggle('open', open); b.setAttribute('aria-expanded', String(open));
    if (ping) { b.classList.remove('ping'); void b.offsetWidth; b.classList.add('ping'); b.addEventListener('animationend', () => b.classList.remove('ping'), { once: true }); }
  });
}
// A small arrow on top of the panel points at the music button, so it is clear where the panel belongs.
function aimNotch() {
  if (!drawer) return;
  const b = [...document.querySelectorAll('.music-btn')].find(x => x.isConnected && x.offsetParent);
  const dr = drawer.getBoundingClientRect(), br = b?.getBoundingClientRect();
  const x = br ? br.left + br.width / 2 : -1;
  if (!br || x < dr.left + 22 || x > dr.right - 22) { drawer._notch?.remove(); drawer._notch = null; return; }
  if (!drawer._notch) { drawer._notch = h('div.drawer-notch', { 'aria-hidden': 'true' }); document.body.append(drawer._notch); }
  drawer._notch.style.left = x + 'px'; drawer._notch.style.top = (dr.top - 7) + 'px';
}

/** Open the music panel from anywhere (e.g. the Ad-free music card). */
export function openMusic() { if (!drawer) toggle(true); }

function toggle(fromElsewhere = false) {
  if (drawer) { close(); return; }
  drawer = h('div.drawer', { role: 'dialog', 'aria-label': 'Music and sound', tabindex: -1 });
  document.body.append(drawer);
  const off = music.on(render);
  const offTime = music.onTime(updateTime), offSpTime = spotify.onTime(updateTime);
  const offSp = spotify.on(render);
  window.addEventListener('resize', aimNotch);
  drawer._off = () => { off(); offTime(); offSpTime(); offSp(); spotify.detach(); window.removeEventListener('resize', aimNotch); drawer._notch?.remove(); };
  drawer.addEventListener('animationend', aimNotch, { once: true });
  render();
  markButtons(true, fromElsewhere);
  aimNotch();
  drawer.focus({ preventScroll: true });
  setTimeout(() => document.addEventListener('pointerdown', outside), 0);
  document.addEventListener('keydown', esc);
}
export function closeMusic() { close(); }

/** Slim "ad-free music" strip: tap it to open the music panel, or use its own Play / Pause button. */
export function musicCard() {
  const btn = h('button.mc-play', { type: 'button', on: { click: () => player.toggle() } });
  const sub = h('span.mc-sub');
  const card = h('div.music-card',
    h('button.mc-open', { type: 'button', 'aria-haspopup': 'dialog', on: { click: openMusic } },
      h('span.mc-icon', { 'aria-hidden': 'true' }, icon('music'), h('span.eq', h('i'), h('i'), h('i'))),
      h('span.mc-text', h('b', 'Ad-free music'), sub),
      h('span.mc-more', h('span', 'All music'), icon('fwd'))),
    btn);
  const sync = () => {
    if (sync.ran && !card.isConnected) { off(); return; }   // card left the page: stop listening
    sync.ran = true;
    const on = player.playing;
    card.classList.toggle('playing', on);
    btn.innerHTML = ''; btn.append(icon(on ? 'pause' : 'play'), h('span', on ? 'Pause' : 'Play'));
    btn.setAttribute('aria-label', on ? 'Pause music' : 'Play music');
    btn.disabled = player.spotify && !spotify.ready;
    sub.textContent = on ? 'Now playing: ' + player.title : player.spotify ? 'Spotify: ' + player.title : 'Built-in tracks, your songs or Spotify';
  };
  const off1 = music.on(sync), off2 = spotify.on(sync), off = () => { off1(); off2(); }; sync();
  return card;
}
function close() { if (!drawer) return; drawer._off(); drawer.remove(); drawer = null; markButtons(false); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', esc); }
const outside = e => { if (drawer && !drawer.contains(e.target) && !e.target.closest('.sp-host') && !e.target.closest('.music-btn') && !e.target.closest('.mc-open')) close(); };
const esc = e => { if (e.key === 'Escape') close(); };

const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

/* One set of controls for everything: they drive Spotify when Spotify was played last, otherwise the built-in tracks and your songs. */
const onSpotify = () => music.source === 'spotify' && !!spotify.link;
export const player = {
  get spotify() { return onSpotify(); },
  get playing() { return onSpotify() ? spotify.playing : music.playing; },
  get title() { return onSpotify() ? itemName(spotify.link, spotify.list.indexOf(spotify.link)) : music.currentTrack.name; },
  toggle() { onSpotify() ? spotify.toggle() : music.toggle(); },
  next() { onSpotify() ? spotify.step(1) : music.next(); },
  prev() { onSpotify() ? spotify.step(-1) : music.prev(); },
  seek(t) { onSpotify() ? spotify.seek(t) : music.seek(t); },
  skip(d) { onSpotify() ? spotify.skip(d) : music.skip(d); },
  get position() { return onSpotify() ? spotify.position : music.position; },
  get canSeek() { return onSpotify() ? spotify.ready && spotify.position.dur > 0 : !music.currentTrack.builtin && music.canSeek; },
};

let dragging = false;
function seekBar() {
  if (!player.canSeek) return null;                 // built-in tracks are endless, so there is nothing to seek
  const { cur: t, dur } = player.position;
  const range = h('input.range.seek', { type: 'range', min: 0, max: dur, step: 0.1, value: t, 'aria-label': 'Song position',
    on: { pointerdown: () => { dragging = true; }, input: e => { drawer.querySelector('.t-cur').textContent = fmt(+e.target.value); },
      change: e => { player.seek(+e.target.value); dragging = false; }, pointerup: () => { dragging = false; } } });
  return h('div.seekbar',
    h('div.seek-row', h('span.t-cur', fmt(t)), range, h('span.t-dur', fmt(dur))),
    h('div.seek-btns',
      [[-30, '« 30s', 'Back 30 seconds'], [-10, '‹ 10s', 'Back 10 seconds'], [10, '10s ›', 'Forward 10 seconds'], [30, '30s »', 'Forward 30 seconds']]
        .map(([d, label, title]) => h('button.chip', { title, 'aria-label': title, on: { click: () => player.skip(d) } }, label))));
}
function updateTime() {
  if (!drawer || dragging) return;
  const r = drawer.querySelector('.seek');
  if (!r) { if (player.canSeek) render(); return; }     // a Spotify song just got its length: show the bar
  const { cur, dur } = player.position;
  if (+r.max !== dur) r.max = dur;
  r.value = cur;
  drawer.querySelector('.t-cur').textContent = fmt(cur);
  drawer.querySelector('.t-dur').textContent = fmt(dur);
  r.style.setProperty('--p', dur ? (cur / dur * 100) + '%' : '0%');
}

/** Tells the person whether Spotify plays full songs here, and what to do if it doesn't. */
function spotifyStatus() {
  const m = spotify.mode, tried = spotify.loginTried;
  if (m === 'full') return h('div.sp-status.ok', h('span.dot'), h('span', h('b', 'Logged in to Spotify'), h('small', 'Full songs play here.')));
  if (m === 'preview' && tried) return h('div.sp-status.warn', h('span.dot'),
    h('span', h('b', 'Still 30-second previews'), h('small', 'If you logged in on Spotify\'s page, this browser is keeping that login away from other websites (common on phones). Use Open in Spotify for full songs, or see the help below.')),
    h('button.linkish', { on: { click: () => spotify.recheck() } }, 'Check again'));
  if (m === 'preview') return h('div.sp-status.warn', h('span.dot'), h('span', h('b', 'Playing 30-second previews'), h('small', 'Log in to Spotify in this browser to hear full songs.')));
  return h('div.sp-status', h('span.dot'), h('span', h('b', 'Not checked yet'), h('small', 'Press play once and this shows whether full songs are on.')));
}

function spotifySection() {
  const link = spotify.link, list = spotify.list;
  const input = h('input.text-in.sp-input', { placeholder: 'Paste a Spotify song or playlist link here', 'aria-label': 'Spotify link' });
  const err = h('p.note.sp-err');
  const go = () => {
    const l = parseSpotify(input.value);
    if (!l) { err.textContent = 'That is not a Spotify link. In Spotify use Share → Copy link, then paste it here.'; return; }
    spotify.add(l); input.value = ''; err.textContent = '';
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  const row = (it, i) => h('div.sp-item', { class: it.id === spotify.current ? 'cur' : '' },
    h('button.sp-pick', { title: 'Play ' + itemName(it, i), on: { click: () => { music.setSource('spotify'); if (music.playing) music.pause(); spotify.select(it.id); } } },
      it.thumb ? h('img.sp-thumb', { src: it.thumb, alt: '', referrerpolicy: 'no-referrer' }) : h('span.sp-thumb.ph', '♫'),
      h('span.sp-name', h('b', itemName(it, i)), h('small', ({ track: 'Song', album: 'Album', playlist: 'Playlist', artist: 'Artist', episode: 'Episode', show: 'Podcast' })[it.type]))),
    h('button.trash', { title: 'Rename', 'aria-label': 'Rename ' + itemName(it, i), on: { click: () => { const n = prompt('Name for this Spotify link:', itemName(it, i)); if (n !== null) spotify.rename(it.id, n); } } }, '✎'),
    h('button.trash', { title: 'Remove', 'aria-label': 'Remove ' + itemName(it, i), on: { click: () => spotify.remove(it.id) } }, icon('trash')));
  return h('div.sp-section',
    h('div.sp-title', h('span.sp-logo', '●'), h('span.sub', 'Spotify')),
    link && h('div.sp-slot'),
    link && spotifyStatus(),
    link && h('div.sp-actions',
      spotify.mode === 'full'
        ? h('a.btn.sp-login.done', { href: SPOTIFY_LOGIN, target: '_blank', rel: 'noopener', title: 'You are logged in. Opens Spotify\'s login page if you want to switch account.' }, '✓ Logged in')
        : h('a.btn.sp-login', { href: SPOTIFY_LOGIN, target: '_blank', rel: 'noopener', title: 'Opens Spotify\'s login page in a new browser tab', on: { click: () => spotify.loginStarted() } }, 'Log in for full songs'),
      h('a.btn', { href: spotifyUrl(link), target: '_blank', rel: 'noopener' }, 'Open in Spotify ↗')),
    list.length > 0 && h('div.sp-list', list.map(row)),
    h('div.sp-row', input, h('button.btn', { on: { click: go } }, 'Add')),
    err,
    link && h('details.sp-help', h('summary', 'Help: full songs and logging in'),
      h('ol',
        h('li', 'Tap ', h('b', 'Log in for full songs'), '. Spotify\'s login page opens in a new tab of this browser. Log in, then come back to this tab. The player reloads by itself and the status above changes to ', h('b', 'Logged in to Spotify'), ' once full songs play.'),
        h('li', 'Still preview after logging in? Your browser is blocking Spotify inside other websites (Incognito always does). In Chrome tap the icon left of the web address → ', h('b', 'Cookies and site data'), ' → allow ', h('b', 'third-party cookies'), ' for this site, then reload.'),
        h('li', 'If ads appear, they come from Spotify itself. Free Spotify accounts include ads, while Spotify Premium removes them.'),
        h('li', 'In mobile, use the ', h('b', 'open in spotify'), ' button inside the player on phones. It belongs to Spotify and opens the Spotify app instead of this browser. Full songs play there, and you can use the phone volume buttons to control the music volume.'))),
    !list.length && h('p.note', 'Add as many playlists, albums or songs as you like. They are saved to your account, so they are here every time, on every device you sign in.'));
}
// Spotify's own login page. accounts.spotify.com opens in the browser (not the Spotify app), so the login cookie
// lands in this browser, which is what the player needs to play full songs.
const SPOTIFY_LOGIN = 'https://accounts.spotify.com/login?continue=' + encodeURIComponent('https://www.spotify.com/account/overview/');

function render() {
  if (!drawer) return;
  const keepScroll = drawer.scrollTop;
  const cur = music.currentTrack;
  const file = h('input', { type: 'file', accept: 'audio/*', multiple: true, class: 'hidden', on: { change: async e => { await music.addFiles(e.target.files); e.target.value = ''; } } });
  const trackRow = t => h('button.track', { class: t.id === music.current && !player.spotify ? 'cur' : '', 'aria-label': (t.id === music.current && music.playing ? 'Pause ' : 'Play ') + t.name, on: { click: () => t.id === music.current && !player.spotify ? music.toggle() : music.play(t.id) } },
    t.id === music.current && music.playing ? icon('pause') : icon('play'),
    h('span.tn', t.name),
    !t.builtin && h('span.trash', { role: 'button', tabindex: 0, 'aria-label': 'Remove ' + t.name, title: 'Remove',
      on: { click: e => { e.stopPropagation(); music.removeSong(t.id); } } }, icon('trash')));
  const sp = player.spotify, playing = player.playing;
  const disc = sp && spotify.link?.thumb ? h('img.disc.cover', { src: spotify.link.thumb, alt: '', referrerpolicy: 'no-referrer' }) : h('div.disc');
  const where = sp ? (spotify.mode === 'full' ? 'Spotify · full songs' : spotify.mode === 'preview' ? 'Spotify · 30-second previews' : 'Spotify')
    : cur.builtin ? 'Built-in track' : 'My songs';
  const noSp = sp ? 'Not available for Spotify' : '';
  clear(drawer).append(
    h('div.dhead', h('h3', 'Music'), h('button.icon-btn.dclose', { title: 'Close', 'aria-label': 'Close music panel', on: { click: close } }, icon('x'))),
    h('div.now', { class: (playing ? 'playing ' : '') + (sp ? 'sp' : '') }, disc,
      h('div', { style: { minWidth: 0 } }, h('div.nt', player.title), h('small.muted', (playing ? 'Playing' : 'Paused') + ' · ' + where))),
    seekBar(),
    h('div.transport',
      h('button.icon-btn', { class: music.shuffle && !sp ? 'on' : '', disabled: sp, title: noSp || 'Shuffle', 'aria-label': 'Shuffle', 'aria-pressed': String(music.shuffle), on: { click: () => { music.shuffle = !music.shuffle; music.emit(); } } }, icon('shuffle')),
      h('button.icon-btn', { title: sp ? 'Previous Spotify link' : 'Previous', 'aria-label': 'Previous', on: { click: () => player.prev() } }, icon('prev')),
      h('button.icon-btn.play', { title: playing ? 'Pause' : 'Play', 'aria-label': playing ? 'Pause' : 'Play', disabled: sp && !spotify.ready, on: { click: () => player.toggle() } }, icon(playing ? 'pause' : 'play')),
      h('button.icon-btn', { title: sp ? 'Next Spotify link' : 'Next', 'aria-label': 'Next', on: { click: () => player.next() } }, icon('next')),
      h('button.icon-btn', { class: music.repeat === 'one' && !sp ? 'on' : '', disabled: sp, title: noSp || (music.repeat === 'one' ? 'Repeat this song' : 'Repeat all'), 'aria-label': 'Repeat mode', on: { click: () => { music.repeat = music.repeat === 'one' ? 'all' : 'one'; music.emit(); } } }, icon('repeat'))),
    h('div.vol', h('label', { for: 'mvol' }, 'Music'), h('input.range', { id: 'mvol', type: 'range', min: 0, max: 1, step: 0.01, value: music.volume, disabled: sp, title: sp ? 'Spotify volume: use your device volume' : '', on: { input: e => music.setVolume(+e.target.value) } })),
    h('div.vol', h('label', { for: 'svol' }, 'Effects'), h('input.range', { id: 'svol', type: 'range', min: 0, max: 1, step: 0.01, value: getPrefs().sfxVolume, on: { input: e => setPref('sfxVolume', +e.target.value) } })),
    sp && h('p.note', { style: { marginTop: '2px' } }, 'Spotify volume: use your device\'s volume. Inside a playlist, use the player below to skip songs.'),
    spotifySection(),
    h('div.sub', 'Built-in tracks'),
    h('div.tracks', music.tracks.filter(t => t.builtin).map(trackRow)),
    h('div.sub', 'My songs'),
    music.userSongs.length ? h('div.tracks', music.tracks.filter(t => !t.builtin).map(trackRow)) : h('p.note', 'Add songs from your device. They stay in this browser on this device and won\'t disappear unless you remove them or clear this site\'s data.'),
    file,
    h('button.btn', { style: { width: '100%', marginTop: '6px' }, on: { click: () => file.click() } }, icon('plus'), 'Add songs'),
  );
  drawer.scrollTop = keepScroll;
  updateTime();
  const slot = drawer.querySelector('.sp-slot');
  if (slot) spotify.attach(slot); else spotify.detach();
}
