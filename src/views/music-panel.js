import { h, clear } from '../dom.js';
import { icon } from '../icons.js';
import { music } from '../audio/music.js';
import { spotify, parseSpotify } from '../audio/spotify.js';
import { getPrefs, setPref } from '../prefs.js';

let drawer = null;

export function musicButton() {
  const btn = h('button.icon-btn', { title: 'Music and sound', 'aria-label': 'Music and sound', on: { click: toggle } }, icon('music'));
  const sync = () => btn.classList.toggle('on', music.playing);
  sync(); music.on(sync);
  return btn;
}

function toggle() {
  if (drawer) { close(); return; }
  drawer = h('div.drawer', { role: 'dialog', 'aria-label': 'Music and sound' });
  document.body.append(drawer);
  const off = music.on(render);
  const offTime = music.onTime(updateTime);
  drawer._off = () => { off(); offTime(); };
  render();
  setTimeout(() => document.addEventListener('pointerdown', outside), 0);
  document.addEventListener('keydown', esc);
}
export function closeMusic() { close(); }
function close() { if (!drawer) return; drawer._off(); drawer.remove(); drawer = null; document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', esc); }
const outside = e => { if (drawer && !drawer.contains(e.target) && !e.target.closest('.icon-btn[title="Music and sound"]')) close(); };
const esc = e => { if (e.key === 'Escape') close(); };

const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
let dragging = false;
function seekBar() {
  const cur = music.currentTrack;
  if (cur.builtin || !music.canSeek) return null;      // built-in tracks are endless, so there is nothing to seek
  const { cur: t, dur } = music.position;
  const range = h('input.range.seek', { type: 'range', min: 0, max: dur, step: 0.1, value: t, 'aria-label': 'Song position',
    on: { pointerdown: () => { dragging = true; }, input: e => { drawer.querySelector('.t-cur').textContent = fmt(+e.target.value); },
      change: e => { music.seek(+e.target.value); dragging = false; }, pointerup: () => { dragging = false; } } });
  return h('div.seekbar',
    h('div.seek-row', h('span.t-cur', fmt(t)), range, h('span.t-dur', fmt(dur))),
    h('div.seek-btns',
      [[-30, '« 30s', 'Back 30 seconds'], [-10, '‹ 10s', 'Back 10 seconds'], [10, '10s ›', 'Forward 10 seconds'], [30, '30s »', 'Forward 30 seconds']]
        .map(([d, label, title]) => h('button.chip', { title, 'aria-label': title, on: { click: () => music.skip(d) } }, label))));
}
function updateTime({ cur, dur }) {
  if (!drawer || dragging) return;
  const r = drawer.querySelector('.seek'); if (!r) return;
  if (+r.max !== dur) r.max = dur;
  r.value = cur;
  drawer.querySelector('.t-cur').textContent = fmt(cur);
  drawer.querySelector('.t-dur').textContent = fmt(dur);
  r.style.setProperty('--p', dur ? (cur / dur * 100) + '%' : '0%');
}

function spotifySection() {
  const input = h('input.text-in.sp-input', { placeholder: 'Paste a Spotify link (playlist, album, song…)', 'aria-label': 'Spotify link', value: '' });
  const err = h('p.note.sp-err');
  const go = () => {
    const link = parseSpotify(input.value);
    if (!link) { err.textContent = 'That is not a Spotify link. In Spotify use Share → Copy link, then paste it here.'; return; }
    spotify.set(link); input.value = ''; err.textContent = '';
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  return h('div.sp-section',
    h('div.sub', 'Spotify'),
    h('div.sp-row', input, h('button.btn', { on: { click: go } }, 'Play')),
    err,
    spotify.link && !spotify.open && h('button.btn.ghost', { style: { width: '100%', marginTop: '6px' }, on: { click: () => spotify.show() } }, 'Show my Spotify player again'),
    h('p.note', 'Plays in a small Spotify player that stays while you play. Full songs need you to be logged in to Spotify in this browser; otherwise Spotify plays previews. Use Spotify’s own player for its volume.'));
}

function render() {
  if (!drawer) return;
  const cur = music.currentTrack;
  const file = h('input', { type: 'file', accept: 'audio/*', multiple: true, class: 'hidden', on: { change: async e => { await music.addFiles(e.target.files); e.target.value = ''; } } });
  const trackRow = t => h('button.track', { class: t.id === music.current ? 'cur' : '', 'aria-label': (t.id === music.current && music.playing ? 'Pause ' : 'Play ') + t.name, on: { click: () => t.id === music.current ? music.toggle() : music.play(t.id) } },
    t.id === music.current && music.playing ? icon('pause') : icon('play'),
    h('span.tn', t.name),
    !t.builtin && h('span.trash', { role: 'button', tabindex: 0, 'aria-label': 'Remove ' + t.name, title: 'Remove',
      on: { click: e => { e.stopPropagation(); music.removeSong(t.id); } } }, icon('trash')));
  clear(drawer).append(
    h('h3', 'Music'),
    h('div.now', { class: music.playing ? 'playing' : '' }, h('div.disc'),
      h('div', { style: { minWidth: 0 } }, h('div.nt', cur.name), h('small.muted', music.playing ? 'Playing' : 'Paused'))),
    seekBar(),
    h('div.transport',
      h('button.icon-btn', { class: music.shuffle ? 'on' : '', title: 'Shuffle', 'aria-label': 'Shuffle', 'aria-pressed': String(music.shuffle), on: { click: () => { music.shuffle = !music.shuffle; music.emit(); } } }, icon('shuffle')),
      h('button.icon-btn', { title: 'Previous', 'aria-label': 'Previous track', on: { click: () => music.prev() } }, icon('prev')),
      h('button.icon-btn.play', { title: music.playing ? 'Pause' : 'Play', 'aria-label': music.playing ? 'Pause' : 'Play', on: { click: () => music.toggle() } }, icon(music.playing ? 'pause' : 'play')),
      h('button.icon-btn', { title: 'Next', 'aria-label': 'Next track', on: { click: () => music.next() } }, icon('next')),
      h('button.icon-btn', { class: music.repeat === 'one' ? 'on' : '', title: music.repeat === 'one' ? 'Repeat this song' : 'Repeat all', 'aria-label': 'Repeat mode', on: { click: () => { music.repeat = music.repeat === 'one' ? 'all' : 'one'; music.emit(); } } }, icon('repeat'))),
    h('div.vol', h('label', { for: 'mvol' }, 'Music'), h('input.range', { id: 'mvol', type: 'range', min: 0, max: 1, step: 0.01, value: music.volume, on: { input: e => music.setVolume(+e.target.value) } })),
    h('div.vol', h('label', { for: 'svol' }, 'Effects'), h('input.range', { id: 'svol', type: 'range', min: 0, max: 1, step: 0.01, value: getPrefs().sfxVolume, on: { input: e => setPref('sfxVolume', +e.target.value) } })),
    h('div.sub', 'Built-in tracks'),
    h('div.tracks', music.tracks.filter(t => t.builtin).map(trackRow)),
    h('div.sub', 'My songs'),
    music.userSongs.length ? h('div.tracks', music.tracks.filter(t => !t.builtin).map(trackRow)) : h('p.note', 'Add songs you own from your device. They stay on this device and are never uploaded.'),
    file,
    h('button.btn', { style: { width: '100%', marginTop: '6px' }, on: { click: () => file.click() } }, icon('plus'), 'Add songs'),
    spotifySection(),
  );
  updateTime(music.position);
}
