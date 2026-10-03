// Spotify inside the music panel, through Spotify's official embedded player.
// The player lives in one fixed element that is positioned over a slot in the music panel while the panel is open,
// and parked off-screen (still playing) while it is closed, so closing the panel never stops the music.
// The chosen link is remembered per account (in the profile) and per device.
import { h } from '../dom.js';

const TYPES = ['track', 'album', 'playlist', 'artist', 'episode', 'show'];
export function parseSpotify(text) {
  const s = String(text || '').trim();
  let m = s.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]{22})/);
  if (!m) m = s.match(/^spotify:(track|album|playlist|artist|episode|show):([A-Za-z0-9]{22})$/);
  return m && TYPES.includes(m[1]) ? { type: m[1], id: m[2] } : null;
}
export const spotifyUrl = l => `https://open.spotify.com/${l.type}/${l.id}`;

const MODE_KEY = 'chessthrone:spotify-mode', LOGIN_KEY = 'chessthrone:spotify-login-tried';
const PREVIEW_MAX_MS = 31000;          // Spotify previews are 30 seconds long
const LABEL = { track: 'Song', album: 'Album', playlist: 'Playlist', artist: 'Artist', episode: 'Episode', show: 'Podcast' };
const MAX = 60;
// list: saved Spotify links [{ type, id, name, thumb }]; current: id of the one in the player
const state = { owner: 'guest', list: [], current: null, playing: false, controller: null, listeners: new Set(),
  pos: 0, dur: 0, timeListeners: new Set(), autoplay: false,
  // 'full' = full songs (logged in to Spotify in this browser), 'preview' = 30-second previews, 'unknown' = not played yet
  mode: readMode(), loginTried: readNum(LOGIN_KEY) };
const key = () => 'chessarena:spotify:' + state.owner;
function readMode() { try { return localStorage.getItem(MODE_KEY) || 'unknown'; } catch { return 'unknown'; } }
function readNum(k) { try { return +localStorage.getItem(k) || 0; } catch { return 0; } }
const emitTime = () => state.timeListeners.forEach(f => f({ cur: state.pos / 1000, dur: state.dur / 1000 }));
function setMode(m) { if (m === state.mode) return; state.mode = m; try { localStorage.setItem(MODE_KEY, m); } catch {} emit(); }
const emit = () => state.listeners.forEach(f => f(state));
/** Accepts the old single-link format { type, id } or the list format { list, current }. */
function normalise(d) {
  if (!d) return null;
  if (Array.isArray(d.list)) return { list: d.list.filter(x => x && x.id && x.type).slice(0, MAX), current: d.current || d.list[0]?.id || null };
  if (d.id && d.type) return { list: [{ type: d.type, id: d.id, name: null, thumb: null }], current: d.id };
  return null;
}
function readLocal() { try { return normalise(JSON.parse(localStorage.getItem(key()) || 'null')); } catch { return null; } }
function snapshot() { return { list: state.list, current: state.current }; }
function persist() {
  try { if (state.list.length) localStorage.setItem(key(), JSON.stringify(snapshot())); else localStorage.removeItem(key()); } catch {}
  spotify.onSave?.(state.list.length ? snapshot() : null);
}
// move the link saved by the very first version (not tied to an account) to the guest slot once
try { const old = JSON.parse(localStorage.getItem('chessarena:spotify') || 'null'); if (old?.link && !localStorage.getItem('chessarena:spotify:guest')) localStorage.setItem('chessarena:spotify:guest', JSON.stringify(old.link)); localStorage.removeItem('chessarena:spotify'); } catch {}

/** Real name and cover from Spotify (oEmbed); falls back to "Playlist 2" etc. */
async function fetchInfo(item) {
  try {
    const r = await fetch('https://open.spotify.com/oembed?url=' + encodeURIComponent(spotifyUrl(item)));
    if (!r.ok) return;
    const j = await r.json();
    const it = state.list.find(x => x.id === item.id); if (!it) return;
    if (!it.name && j.title) it.name = j.title;
    if (j.thumbnail_url) it.thumb = j.thumbnail_url;
    persist(); emit();
  } catch { /* offline or blocked: keep the fallback name */ }
}
export const itemName = (item, i) => item.name || `${LABEL[item.type] || 'Spotify'} ${i + 1}`;

export const spotify = {
  get list() { return state.list; }, get current() { return state.current; }, get playing() { return state.playing; },
  get link() { return state.list.find(x => x.id === state.current) || null; },
  on(f) { state.listeners.add(f); return () => state.listeners.delete(f); },
  onPlay: null,          // set by the music player: pause the built-in music
  onSave: null,          // set by the app: save the list to the signed-in profile
  /** Called whenever the signed-in account (or its profile) is known. */
  useAccount(owner, profileData) {
    const changed = owner !== state.owner;
    state.owner = owner || 'guest';
    const d = normalise(profileData) || readLocal() || { list: [], current: null };
    const same = !changed && d.current === state.current && d.list.length === state.list.length;
    if (same) return;
    const prevCurrent = state.current;
    state.list = d.list; state.current = d.current;
    try { if (state.list.length) localStorage.setItem(key(), JSON.stringify(snapshot())); } catch {}
    if (changed || prevCurrent !== state.current) rebuild();
    emit();
    state.list.filter(x => !x.name || !x.thumb).forEach(fetchInfo);
  },
  /** Add a link (or switch to it if it is already saved). */
  add(link) {
    let it = state.list.find(x => x.id === link.id);
    if (!it) { it = { type: link.type, id: link.id, name: null, thumb: null }; state.list = [it, ...state.list].slice(0, MAX); }
    state.current = it.id; persist(); load(); emit(); fetchInfo(it);
  },
  select(id) { if (id === state.current) return; state.current = id; persist(); load(); emit(); },
  rename(id, name) { const it = state.list.find(x => x.id === id); if (it) { it.name = String(name || '').trim().slice(0, 80) || null; persist(); emit(); } },
  remove(id) {
    state.list = state.list.filter(x => x.id !== id);
    if (state.current === id) { state.current = state.list[0]?.id || null; state.playing = false; rebuild(); }
    persist(); emit();
  },
  set(link) { this.add(link); },          // older name
  pause() { try { state.controller?.pause?.(); } catch {} },
  get mode() { return state.mode; },
  get loginTried() { return state.loginTried; },
  get ready() { return !!state.controller; },
  get position() { return { cur: state.pos / 1000, dur: state.dur / 1000 }; },
  onTime(f) { state.timeListeners.add(f); return () => state.timeListeners.delete(f); },
  /** Play / pause from the music panel's own buttons. */
  toggle() { try { state.controller?.togglePlay?.(); } catch {} },
  seek(sec) { try { state.controller?.seek?.(Math.max(0, sec)); state.pos = Math.max(0, sec) * 1000; emitTime(); } catch {} },
  skip(delta) { this.seek(state.pos / 1000 + delta); },
  /** Next / previous saved Spotify link (the player itself skips songs inside a playlist). */
  step(dir) {
    if (state.list.length < 2) { this.seek(0); return; }
    const i = state.list.findIndex(x => x.id === state.current);
    state.current = state.list[(i + dir + state.list.length) % state.list.length].id;
    persist(); state.autoplay = true; load(); emit();
  },
  /** The person went to Spotify's login page: remember it, and reload the player when they come back. */
  loginStarted() {
    state.loginTried = Date.now();
    try { localStorage.setItem(LOGIN_KEY, String(state.loginTried)); } catch {}
    awaitingReturn = true; emit();
  },
  /** Rebuild the player so it picks up a new Spotify login, then check again. */
  recheck() { setMode('unknown'); rebuild(); },
  attach(slot) { slotEl = slot; place(); },
  detach() { slotEl = null; place(); },
};
// switch the existing player to the current item (smooth), or build a new one
function load() {
  const it = spotify.link;
  state.pos = 0; state.dur = 0; emitTime();
  if (it && state.controller?.loadUri) {
    try {
      state.controller.loadUri(`spotify:${it.type}:${it.id}`); state.playing = false;
      if (state.autoplay) { state.autoplay = false; setTimeout(() => { try { state.controller?.play(); } catch {} }, 600); }
      return;
    } catch {}
  }
  rebuild();
}
// Coming back from Spotify's login page: reload the player so it can use the new login.
let awaitingReturn = false;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !awaitingReturn) return;
  awaitingReturn = false;
  if (spotify.link) spotify.recheck();
});

/* ---------------- the player element ---------------- */
let host = null, slotEl = null, apiPromise = null, raf = 0;
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
function rebuild() {
  try { state.controller?.destroy?.(); } catch {}
  state.controller = null; state.playing = false;
  host?.remove(); host = null;
  const cur = spotify.link;
  if (!cur) { place(); return; }
  host = h('div.sp-host', { 'aria-label': 'Spotify player' });
  const target = h('div'); host.append(target);
  document.body.append(host);
  const { type, id } = cur;
  loadApi().then(api => {
    if (!host || !host.contains(target)) return;
    api.createController(target, { uri: `spotify:${type}:${id}`, width: '100%', height: 152 }, ctl => {
      state.controller = ctl;
      ctl.addListener('ready', () => { if (state.autoplay) { state.autoplay = false; try { ctl.play(); } catch {} } });
      ctl.addListener('playback_update', e => {
        const d = e.data || {};
        const playing = !d.isPaused && !d.isBuffering;
        state.pos = d.position || 0; state.dur = d.duration || 0; emitTime();
        // Full songs only play when this browser is logged in to Spotify; otherwise every song is a 30-second preview.
        if (playing && state.dur > 0 && state.pos > 500) setMode(state.dur > PREVIEW_MAX_MS ? 'full' : 'preview');
        if (playing && !state.playing) spotify.onPlay?.();
        if (playing !== state.playing) { state.playing = playing; emit(); }
      });
      emit();
    });
  }).catch(() => {
    if (!host) return;
    host.textContent = '';
    host.append(h('iframe', { src: `https://open.spotify.com/embed/${type}/${id}?theme=0`, width: '100%', height: 152, title: 'Spotify player',
      allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture', loading: 'lazy' }));
  });
  place();
}
// Keep the player exactly over its slot in the open music panel; park it (still playing) when the panel is closed.
function place() {
  cancelAnimationFrame(raf);
  if (!host) return;
  if (!slotEl || !document.body.contains(slotEl)) { host.classList.add('parked'); host.style.cssText = ''; return; }
  const step = () => {
    if (!host || !slotEl || !document.body.contains(slotEl)) { host?.classList.add('parked'); return; }
    const r = slotEl.getBoundingClientRect(), dr = slotEl.closest('.drawer'), box = dr?.getBoundingClientRect() || r;
    const head = dr?.querySelector('.dhead')?.getBoundingClientRect();     // the panel's sticky title bar stays on top
    const boxTop = head ? Math.max(box.top, head.bottom) : box.top;
    host.classList.remove('parked');
    host.style.left = r.left + 'px'; host.style.top = r.top + 'px'; host.style.width = r.width + 'px';
    // hide the parts scrolled out of the panel
    const top = Math.max(0, boxTop - r.top), bottom = Math.max(0, r.bottom - box.bottom);
    host.style.clipPath = `inset(${top}px 0 ${bottom}px 0 round 12px)`;
    host.style.pointerEvents = top + bottom >= r.height ? 'none' : '';
    raf = requestAnimationFrame(step);
  };
  step();
}
