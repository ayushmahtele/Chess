// Background music player.
//  - Built-in tracks are original pieces generated live with Web Audio.
//  - "My songs": players can add audio files they own; files are kept on
//    their own device (IndexedDB) and are never uploaded anywhere.
import { audioCtx, noiseBuffer } from './ctx.js';
import { spotify } from './spotify.js';

const BUILTIN = [
  { id: 'lofi', name: 'Midnight Lo-fi', builtin: true },
  { id: 'calm', name: 'Quiet Study', builtin: true },
  { id: 'tension', name: 'Endgame Tension', builtin: true },
  { id: 'morning', name: 'Sunday Morning', builtin: true },
];

/* ---------- IndexedDB for user songs ---------- */
const DB = 'chessarena-music';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('songs', { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbAll() {
  const db = await idb();
  return new Promise((res, rej) => { const q = db.transaction('songs').objectStore('songs').getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
async function idbPut(v) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('songs', 'readwrite'); t.objectStore('songs').put(v); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
async function idbDel(id) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('songs', 'readwrite'); t.objectStore('songs').delete(id); t.oncomplete = res; t.onerror = () => rej(t.error); }); }

/** "Peter_Paul_Mary_-_Five_Hundred_Miles_(mp3.pm)" -> "Peter Paul Mary - Five Hundred Miles" */
export function prettyName(n) {
  return String(n || 'Song')
    .replace(/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i, '')
    .replace(/[([](?:[^)\]]*(?:mp3|320|128|kbps|lyrics|official|audio|video|hd|hq)[^)\]]*)[)\]]/gi, '')
    .replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Song';
}

/* ---------- tiny synth ---------- */
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

function makeSynth(c, dest) {
  const nb = noiseBuffer(c, 1);
  const voice = (t, midi, dur, { type = 'triangle', gain = 0.12, attack = 0.01, release = 0.3, cutoff = 2500, detune = 0 } = {}) => {
    const o = c.createOscillator(); o.type = type; o.frequency.value = mtof(midi); o.detune.value = detune;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.setValueAtTime(gain, t + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
    o.connect(f).connect(g).connect(dest); o.start(t); o.stop(t + dur + release + 0.05);
  };
  return {
    keys(t, notes, dur, gain = 0.06) { notes.forEach(n => { voice(t, n, dur, { type: 'sine', gain, attack: 0.005, release: 0.6 }); voice(t, n + 12, dur * 0.4, { type: 'triangle', gain: gain * 0.25, attack: 0.003, release: 0.3, cutoff: 1800 }); }); },
    pad(t, notes, dur, gain = 0.035) { notes.forEach(n => { voice(t, n, dur, { type: 'sawtooth', gain, attack: 1.2, release: 1.5, cutoff: 900, detune: -7 }); voice(t, n, dur, { type: 'sawtooth', gain, attack: 1.2, release: 1.5, cutoff: 900, detune: 7 }); }); },
    bass(t, n, dur, gain = 0.16) { voice(t, n, dur, { type: 'triangle', gain, attack: 0.01, release: 0.15, cutoff: 600 }); },
    pluck(t, n, dur, gain = 0.06) { voice(t, n, dur, { type: 'triangle', gain, attack: 0.003, release: 0.25, cutoff: 3000 }); },
    bell(t, n, gain = 0.05) { voice(t, n, 0.05, { type: 'sine', gain, attack: 0.002, release: 1.6 }); voice(t, n + 19, 0.05, { type: 'sine', gain: gain * 0.3, attack: 0.002, release: 0.8 }); },
    kick(t, gain = 0.5) {
      const o = c.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
      const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g).connect(dest); o.start(t); o.stop(t + 0.32);
    },
    hat(t, gain = 0.05) {
      const s = c.createBufferSource(); s.buffer = nb;
      const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
      const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      s.connect(f).connect(g).connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + 0.06);
    },
    snare(t, gain = 0.12) {
      const s = c.createBufferSource(); s.buffer = nb;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7;
      const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      s.connect(f).connect(g).connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + 0.2);
    },
  };
}

/* Each track: bpm + a step function called every 16th note. */
const TRACKS = {
  lofi: {
    bpm: 76,
    // Dm9 – G13 – Cmaj9 – Am7
    chords: [[50, 53, 57, 60, 64], [43, 53, 59, 64, 65], [48, 52, 55, 59, 62], [45, 52, 55, 60, 64]],
    step(s, t, d, st) {
      const bar = Math.floor(st / 16) % 4, i = st % 16, ch = this.chords[bar];
      const swing = (i % 2) ? d * 0.18 : 0;
      if (i === 0) s.keys(t, ch.slice(1), d * 8);
      if (i === 6) s.keys(t + swing, ch.slice(2), d * 4, 0.04);
      if (i === 0 || i === 10) s.bass(t + swing, ch[0] - 12 + 12, d * 3);
      if (i === 0 || i === 7 || i === 10) s.kick(t + swing, 0.35);
      if (i === 4 || i === 12) s.snare(t, 0.07);
      if (i % 2 === 0) s.hat(t + swing, 0.025 + (i % 4 === 2 ? 0.01 : 0));
      if (i === 14 && Math.random() < 0.5) s.bell(t, ch[3] + 12, 0.025);
    },
  },
  calm: {
    bpm: 58,
    // Fmaj7 – Em7 – Dm7 – Cmaj7 (slow pads)
    chords: [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]],
    scale: [60, 62, 64, 67, 69, 72, 74, 76],
    step(s, t, d, st) {
      const bar = Math.floor(st / 16) % 4, i = st % 16, ch = this.chords[bar];
      if (i === 0) { s.pad(t, ch, d * 16); s.bass(t, ch[0] - 12, d * 14, 0.08); }
      if ((i === 4 || i === 10 || i === 13) && Math.random() < 0.65) s.bell(t, this.scale[Math.floor(Math.random() * this.scale.length)] + 12, 0.035);
    },
  },
  tension: {
    bpm: 98,
    // Am – F – Dm – E
    chords: [[45, 57, 60, 64], [41, 57, 60, 65], [38, 57, 62, 65], [40, 56, 59, 64]],
    step(s, t, d, st) {
      const bar = Math.floor(st / 16) % 4, i = st % 16, ch = this.chords[bar];
      if (i % 2 === 0) s.bass(t, ch[0], d * 1.6, 0.12);
      const arp = [ch[1], ch[2], ch[3], ch[2] + 12];
      s.pluck(t, arp[i % 4] + 12, d * 0.9, 0.035);
      if (i === 0) s.pad(t, ch.slice(1), d * 16, 0.02);
      if (i % 4 === 0) s.kick(t, 0.3);
      if (i === 8 && bar === 3) s.snare(t, 0.08);
    },
  },
  morning: {
    bpm: 92,
    // C – G/B – Am – F
    chords: [[48, 60, 64, 67], [47, 59, 62, 67], [45, 57, 60, 64], [41, 57, 60, 65]],
    step(s, t, d, st) {
      const bar = Math.floor(st / 16) % 4, i = st % 16, ch = this.chords[bar];
      const pattern = [0, 3, 6, 8, 11, 14];
      if (pattern.includes(i)) s.keys(t, ch.slice(1), d * 2, 0.035);
      if (i === 0 || i === 8) s.bass(t, ch[0], d * 6, 0.12);
      if (i === 0 || i === 8) s.kick(t, 0.25);
      if (i === 4 || i === 12) s.snare(t, 0.05);
      if (i % 2 === 1) s.hat(t, 0.02);
      const mel = [72, 74, 76, 79, 76, 74];
      if (i === 2 && bar % 2 === 0) s.pluck(t, mel[(st >> 4) % mel.length], d * 3, 0.04);
    },
  },
};

class MusicPlayer {
  constructor() {
    this.volume = 0.5; this.playing = false; this.current = 'lofi';
    this.shuffle = false; this.repeat = 'all'; // 'all' | 'one'
    this.source = 'local';                     // what the panel's controls drive: 'local' (built-in + your songs) or 'spotify'
    this.userSongs = []; this.listeners = new Set(); this.timeListeners = new Set();
    this._timer = null; this._audio = null; this._url = null;
    try { Object.assign(this, JSON.parse(localStorage.getItem('chessarena:music') || '{}')); } catch {}
    this.playing = false;
    this.loadSongs();
  }
  persist() { try { localStorage.setItem('chessarena:music', JSON.stringify({ volume: this.volume, current: this.current, shuffle: this.shuffle, repeat: this.repeat, source: this.source })); } catch {} }
  on(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  emit() { this.persist(); this.listeners.forEach(f => f(this)); }

  get tracks() { return [...BUILTIN, ...this.userSongs.map(s => ({ id: s.id, name: s.name, builtin: false }))]; }
  get currentTrack() { return this.tracks.find(t => t.id === this.current) || this.tracks[0]; }

  async loadSongs() {
    try { this.userSongs = (await idbAll()).map(s => ({ id: s.id, name: prettyName(s.name), added: s.added })).sort((a, b) => a.added - b.added); }
    catch { this.userSongs = []; }
    this.emit();
  }
  async addFiles(files) {
    try { await navigator.storage?.persist?.(); } catch {}   // keep songs: stop the browser clearing them automatically
    for (const f of files) {
      if (!f.type.startsWith('audio/')) continue;
      const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await idbPut({ id, name: f.name.replace(/\.[^.]+$/, ''), blob: f, added: Date.now() });
    }
    await this.loadSongs();
  }
  async removeSong(id) {
    if (this.current === id) { this.stop(); this.current = 'lofi'; }
    await idbDel(id); await this.loadSongs();
  }

  setVolume(v) {
    this.volume = v;
    if (this._gain) this._gain.gain.setTargetAtTime(v * 0.9, audioCtx().currentTime, 0.05);
    if (this._audio) this._audio.volume = v;
    this.persist();
  }
  /** Big play/pause button and the icon next to the current song. */
  toggle() { this.playing ? this.pause() : this.resume(); }
  pause() {
    if (this._audio) { this._audio.pause(); this.playing = false; this._session(); this.emit(); return; }   // your own song: keep the position
    this.stop(); this.emit();
  }
  setSource(src) { if (this.source !== src) { this.source = src; this.emit(); } }
  async resume() {
    spotify.pause(); this.source = 'local';
    if (this._audio && this.currentTrack.id === this.current && !this.currentTrack.builtin) {
      try { await this._audio.play(); this.playing = true; } catch (e) { console.warn(e); }
      this._session(); this.emit(); return;
    }
    return this.play(this.current);
  }
  stop() {
    this.playing = false;
    clearInterval(this._timer); this._timer = null;
    if (this._gain) { const g = this._gain; g.gain.setTargetAtTime(0, audioCtx().currentTime, 0.15); setTimeout(() => g.disconnect(), 800); this._gain = null; }
    if (this._audio) { this._audio.pause(); this._audio.src = ''; this._audio = null; }
    if (this._url) { URL.revokeObjectURL(this._url); this._url = null; }
    this._time();
  }
  async play(id = this.current) {
    spotify.pause(); this.source = 'local';
    if (id === this.current && this._audio && !this.playing) return this.resume();
    this.stop();
    this.current = id; this.playing = true;
    const track = this.currentTrack; this.current = track.id;
    if (track.builtin) this._playSynth(track.id);
    else await this._playFile(track.id);
    this._session();
    this.emit();
  }

  /* ---------- seeking (your own songs only) ---------- */
  get canSeek() { return !!this._audio && isFinite(this._audio.duration); }
  get position() { return this._audio ? { cur: this._audio.currentTime || 0, dur: isFinite(this._audio.duration) ? this._audio.duration : 0 } : { cur: 0, dur: 0 }; }
  seek(sec) { if (this._audio) { this._audio.currentTime = Math.max(0, Math.min(sec, (this._audio.duration || 0) - 0.05)); this._time(); } }
  skip(delta) { if (this._audio) this.seek(this._audio.currentTime + delta); }
  onTime(cb) { this.timeListeners.add(cb); return () => this.timeListeners.delete(cb); }
  _time() { this.timeListeners.forEach(f => f(this.position)); }

  /* Media keys, headphone buttons and the phone lock screen */
  _session() {
    const ms = navigator.mediaSession; if (!ms) return;
    try {
      ms.metadata = new MediaMetadata({ title: this.currentTrack.name, artist: this.currentTrack.builtin ? 'Chess Throne' : 'My songs' });
      ms.playbackState = this.playing ? 'playing' : 'paused';
      ms.setActionHandler('play', () => this.resume());
      ms.setActionHandler('pause', () => this.pause());
      ms.setActionHandler('nexttrack', () => this.next());
      ms.setActionHandler('previoustrack', () => this.prev());
      ms.setActionHandler('seekforward', () => this.skip(10));
      ms.setActionHandler('seekbackward', () => this.skip(-10));
      ms.setActionHandler('seekto', d => this.seek(d.seekTime));
    } catch {}
  }
  next() { this.play(this._neighbor(1)); }
  prev() { this.play(this._neighbor(-1)); }
  _neighbor(dir) {
    const list = this.tracks, i = list.findIndex(t => t.id === this.current);
    if (this.shuffle && list.length > 1) { let j; do { j = Math.floor(Math.random() * list.length); } while (j === i); return list[j].id; }
    return list[(i + dir + list.length) % list.length].id;
  }
  _playSynth(id) {
    const c = audioCtx(), T = TRACKS[id];
    const gain = c.createGain(); gain.gain.value = 0;
    const comp = c.createDynamicsCompressor();
    gain.connect(comp).connect(c.destination);
    gain.gain.setTargetAtTime(this.volume * 0.9, c.currentTime, 0.4);
    this._gain = gain;
    const synth = makeSynth(c, gain);
    const d = 60 / T.bpm / 4;
    let nextT = c.currentTime + 0.1, step = 0;
    const tick = () => {
      while (nextT < c.currentTime + 0.2) { T.step(synth, nextT, d, step); nextT += d; step++; }
    };
    tick(); this._timer = setInterval(tick, 50);
  }
  async _playFile(id) {
    const db = await idb();
    const rec = await new Promise(res => { const q = db.transaction('songs').objectStore('songs').get(id); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
    if (!rec || !this.playing) return;
    this._url = URL.createObjectURL(rec.blob);
    const a = new Audio(this._url); a.volume = this.volume;
    a.onended = () => { if (this.repeat === 'one') { a.currentTime = 0; a.play(); } else this.next(); };
    a.ontimeupdate = () => this._time();
    a.onloadedmetadata = () => { this._time(); this.emit(); };
    this._audio = a;
    try { await a.play(); } catch (e) { console.warn(e); this.playing = false; }
  }
}

export const music = new MusicPlayer();
spotify.onPlay = () => { music.source = 'spotify'; if (music.playing) music.pause(); else music.emit(); };
