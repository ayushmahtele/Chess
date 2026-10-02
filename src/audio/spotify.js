// Spotify: play a pasted Spotify link through Spotify's official embedded player.
// Full songs play when the listener is logged in to Spotify in this browser (otherwise Spotify gives previews).
import { h } from '../dom.js';

const KEY = 'chessarena:spotify';
const TYPES = ['track', 'album', 'playlist', 'artist', 'episode', 'show'];

/** "https://open.spotify.com/intl-en/playlist/37i9…?si=…" or "spotify:playlist:37i9…" -> { type, id } */
export function parseSpotify(text) {
  const s = String(text || '').trim();
  let m = s.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]{22})/);
  if (!m) m = s.match(/^spotify:(track|album|playlist|artist|episode|show):([A-Za-z0-9]{22})$/);
  return m && TYPES.includes(m[1]) ? { type: m[1], id: m[2] } : null;
}

const state = { link: null, open: false, small: false, playing: false, controller: null, listeners: new Set() };
try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || '{}'), { playing: false, controller: null, listeners: new Set() }); } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ link: state.link, open: state.open, small: state.small })); } catch {} };
const emit = () => state.listeners.forEach(f => f(state));
export const spotify = {
  get link() { return state.link; }, get open() { return state.open; }, get playing() { return state.playing; },
  on(f) { state.listeners.add(f); return () => state.listeners.delete(f); },
  set(link) { state.link = link; state.open = true; state.small = false; save(); mount(); emit(); },
  close() { state.open = false; state.playing = false; save(); unmount(); emit(); },
  show() { if (state.link) { state.open = true; save(); mount(); emit(); } },
  pause() { try { state.controller?.pause?.(); } catch {} },
  onPlay: null,            // set by the music player: pause the built-in music
};

/* ---------------- floating mini-player ---------------- */
let dock = null, holder = null, apiPromise = null;
function loadApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    window.onSpotifyIframeApiReady = api => resolve(api);
    const sc = document.createElement('script');
    sc.src = 'https://open.spotify.com/embed/iframe-api/v1'; sc.async = true; sc.onerror = reject;
    document.head.append(sc);
    setTimeout(() => reject(new Error('timeout')), 12000);
  });
  return apiPromise;
}
function mount() {
  if (!state.open || !state.link) return;
  if (!dock) {
    holder = h('div.sp-body');
    dock = h('div.spotify-dock', { role: 'region', 'aria-label': 'Spotify player' },
      h('div.sp-head',
        h('span.sp-logo', { 'aria-hidden': 'true' }, '●'), h('b', 'Spotify'),
        h('button.sp-btn', { title: 'Smaller / larger', 'aria-label': 'Resize Spotify player', on: { click: () => { state.small = !state.small; save(); resize(); } } }, '⇕'),
        h('button.sp-btn', { title: 'Close Spotify', 'aria-label': 'Close Spotify', on: { click: () => spotify.close() } }, '✕')),
      holder);
    document.body.append(dock);
  }
  const { type, id } = state.link;
  holder.textContent = '';
  const target = h('div');
  holder.append(target);
  state.controller = null;
  const height = () => (state.small ? 80 : 152);
  loadApi().then(api => {
    api.createController(target, { uri: `spotify:${type}:${id}`, width: '100%', height: height() }, ctl => {
      state.controller = ctl;
      ctl.addListener('playback_update', e => {
        const playing = !e.data?.isPaused && !e.data?.isBuffering;
        if (playing && !state.playing) spotify.onPlay?.();
        state.playing = playing; emit();
      });
    });
  }).catch(() => {
    // Fallback: plain embed (no automatic pausing of the built-in music)
    holder.textContent = '';
    holder.append(h('iframe', { src: `https://open.spotify.com/embed/${type}/${id}?theme=0`, width: '100%', height: height(), allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture', loading: 'lazy', title: 'Spotify player', style: { border: '0', borderRadius: '12px' } }));
  });
  resize();
}
function resize() {
  if (!dock) return;
  dock.classList.toggle('small', state.small);
  const f = dock.querySelector('iframe'); if (f) f.style.height = (state.small ? 80 : 152) + 'px';
}
function unmount() { try { state.controller?.destroy?.(); } catch {} state.controller = null; dock?.remove(); dock = null; holder = null; }

// restore after a page reload (stays paused until you press play — browsers block autoplay)
if (state.open && state.link) setTimeout(mount, 800);
