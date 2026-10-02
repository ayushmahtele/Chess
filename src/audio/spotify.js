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

const state = { owner: 'guest', link: null, playing: false, controller: null, listeners: new Set() };
const key = () => 'chessarena:spotify:' + state.owner;
const emit = () => state.listeners.forEach(f => f(state));
function readLocal() { try { return JSON.parse(localStorage.getItem(key()) || 'null'); } catch { return null; } }
function writeLocal() { try { if (state.link) localStorage.setItem(key(), JSON.stringify(state.link)); else localStorage.removeItem(key()); } catch {} }
// move the link saved by the earlier version (not tied to an account) to the guest slot once
try { const old = JSON.parse(localStorage.getItem('chessarena:spotify') || 'null'); if (old?.link && !localStorage.getItem('chessarena:spotify:guest')) localStorage.setItem('chessarena:spotify:guest', JSON.stringify(old.link)); localStorage.removeItem('chessarena:spotify'); } catch {}

export const spotify = {
  get link() { return state.link; }, get playing() { return state.playing; },
  on(f) { state.listeners.add(f); return () => state.listeners.delete(f); },
  onPlay: null,          // set by the music player: pause the built-in music
  onSave: null,          // set by the app: save the link to the signed-in profile
  /** Called whenever the signed-in account (or its profile) is known. */
  useAccount(owner, profileLink) {
    const changed = owner !== state.owner;
    state.owner = owner || 'guest';
    const link = (profileLink && profileLink.id ? profileLink : null) || readLocal();
    if (changed || link?.id !== state.link?.id) { state.link = link; writeLocal(); rebuild(); emit(); }
  },
  set(link) { state.link = link; writeLocal(); this.onSave?.(link); rebuild(); emit(); },
  remove() { state.link = null; writeLocal(); this.onSave?.(null); state.playing = false; rebuild(); emit(); },
  pause() { try { state.controller?.pause?.(); } catch {} },
  attach(slot) { slotEl = slot; place(); },
  detach() { slotEl = null; place(); },
};

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
  if (!state.link) { place(); return; }
  host = h('div.sp-host', { 'aria-label': 'Spotify player' });
  const target = h('div'); host.append(target);
  document.body.append(host);
  const { type, id } = state.link;
  loadApi().then(api => {
    if (!host || !host.contains(target)) return;
    api.createController(target, { uri: `spotify:${type}:${id}`, width: '100%', height: 152 }, ctl => {
      state.controller = ctl;
      ctl.addListener('playback_update', e => {
        const playing = !e.data?.isPaused && !e.data?.isBuffering;
        if (playing && !state.playing) spotify.onPlay?.();
        if (playing !== state.playing) { state.playing = playing; emit(); }
      });
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
    const r = slotEl.getBoundingClientRect(), box = slotEl.closest('.drawer')?.getBoundingClientRect() || r;
    host.classList.remove('parked');
    host.style.left = r.left + 'px'; host.style.top = r.top + 'px'; host.style.width = r.width + 'px';
    // hide the parts scrolled out of the panel
    const top = Math.max(0, box.top - r.top), bottom = Math.max(0, r.bottom - box.bottom);
    host.style.clipPath = `inset(${top}px 0 ${bottom}px 0 round 12px)`;
    host.style.pointerEvents = top + bottom >= r.height ? 'none' : '';
    raf = requestAnimationFrame(step);
  };
  step();
}
