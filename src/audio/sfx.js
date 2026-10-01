// Board sounds, synthesised with Web Audio (no audio files, no licensing issues).
// Designed to be easy on the ears: soft attacks (no instant clicks), high frequencies filtered out,
// gentle peaks. Several styles; "soft" is the default.
import { audioCtx, noiseBuffer } from './ctx.js';
import { getPrefs } from '../prefs.js';

let volume = 0.7, out = null, noise = null, outCtx = null;
export function setSfxVolume(v) { volume = v; if (out) out.gain.value = v; }

function setup() {
  const c = audioCtx();
  if (outCtx !== c) {                // (re)build the output chain for this audio context
    outCtx = c;
    out = c.createGain(); out.gain.value = volume;
    // No compressor: browsers add automatic make-up gain to it, which made sounds louder and "pumpy".
    const tame = c.createBiquadFilter(); tame.type = 'lowpass'; tame.frequency.value = 6000; tame.Q.value = 0.5;   // nothing piercing reaches the ears
    out.connect(tame).connect(c.destination);
    noise = noiseBuffer(c, 0.5);
  }
  return c;
}
const jitter = (x, amt = 0.03) => x * (1 + (Math.random() * 2 - 1) * amt);

/* ---------------- building blocks ---------------- */
// a sine "body" with a soft (non-clicky) attack and exponential decay, optionally gliding in pitch
function body(t, f, { gain = 0.3, attack = 0.004, decay = 0.08, glide = 1, type = 'sine', lp = 0 } = {}) {
  const c = setup();
  const o = c.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f, t); if (glide !== 1) o.frequency.exponentialRampToValueAtTime(f * glide, t + decay);
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  let node = o.connect(g);
  if (lp) { const f2 = c.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = lp; f2.Q.value = 0.4; node = node.connect(f2); }
  node.connect(out); o.start(t); o.stop(t + attack + decay + 0.05);
}
// filtered noise "contact" — low-passed and with a soft attack so it never clicks
function contact(t, { freq = 900, gain = 0.12, attack = 0.003, decay = 0.03, lp = 2200 } = {}) {
  const c = setup();
  const n = c.createBufferSource(); n.buffer = noise;
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 0.8;
  const l = c.createBiquadFilter(); l.type = 'lowpass'; l.frequency.value = lp;
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  n.connect(bp).connect(l).connect(g).connect(out); n.start(t, Math.random() * 0.4); n.stop(t + attack + decay + 0.03);
}
// warm chime (sine + a little octave), used for check / promotion / game end
function chime(t, f, gain = 0.1, dur = 0.7) {
  body(t, f, { gain, attack: 0.012, decay: dur });
  body(t, f * 2, { gain: gain * 0.18, attack: 0.012, decay: dur * 0.4 });
}
const N = { C4: 261.63, D4: 293.66, E4: 329.63, G4: 392, A4: 440, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A3: 220, G3: 196, E3: 164.81, C3: 130.81 };
const jingle = (notes, gap, gain, last = 1.1) => { const t = setup().currentTime; notes.forEach((f, i) => chime(t + i * gap, f, gain, i === notes.length - 1 ? last : 0.6)); };
const common = {   // gentle shared sounds for game events
  start() { jingle([N.C4, N.E4, N.G4], 0.1, 0.09); },
  win() { jingle([N.C4, N.E4, N.G4, N.C5], 0.11, 0.1, 1.4); },
  lose() { jingle([N.A3, N.E3, N.C3], 0.16, 0.1, 1.4); },
  draw() { jingle([N.G3, N.G3], 0.18, 0.09); },
  illegal() { body(setup().currentTime, 150, { gain: 0.12, attack: 0.006, decay: 0.09, glide: 0.8, lp: 600 }); },
};

/* ---------------- styles ---------------- */
// Soft wood: rounded "tok" of a weighted piece on a wooden board
const soft = {
  ...common,
  tap(t, k = 1) {
    const f = jitter(330 * k);
    contact(t, { freq: 700 * k, gain: 0.07, decay: 0.022, lp: 1800 });
    body(t, f, { gain: 0.28, attack: 0.003, decay: 0.07, glide: 0.92, lp: 1600 });
    body(t, f * 2.1, { gain: 0.06, attack: 0.003, decay: 0.035, lp: 1800 });
    body(t, jitter(115), { gain: 0.22, attack: 0.004, decay: 0.09, glide: 0.8 });
  },
  move() { soft.tap(setup().currentTime); },
  capture() { const t = setup().currentTime; soft.tap(t, 0.9); body(t + 0.035, 95, { gain: 0.2, attack: 0.005, decay: 0.12, glide: 0.75 }); },
  castle() { const t = setup().currentTime; soft.tap(t, 1); soft.tap(t + 0.16, 0.86); },
  check() { const t = setup().currentTime; soft.tap(t); chime(t + 0.04, N.E5, 0.06, 0.45); },
  promote() { const t = setup().currentTime; soft.tap(t); chime(t + 0.05, N.C5, 0.07, 0.4); chime(t + 0.17, N.G5, 0.06, 0.6); },
  tick() { body(setup().currentTime, 520, { gain: 0.05, attack: 0.004, decay: 0.03, lp: 1500 }); },
};
// Felt pads: muffled and very quiet, like pieces with felt bottoms
const felt = {
  ...common,
  tap(t, k = 1) {
    body(t, jitter(170 * k), { gain: 0.32, attack: 0.006, decay: 0.08, glide: 0.7, lp: 520 });
    contact(t, { freq: 380, gain: 0.05, attack: 0.005, decay: 0.03, lp: 700 });
  },
  move() { felt.tap(setup().currentTime); },
  capture() { const t = setup().currentTime; felt.tap(t, 0.85); felt.tap(t + 0.05, 0.7); },
  castle() { const t = setup().currentTime; felt.tap(t); felt.tap(t + 0.17, 0.85); },
  check() { const t = setup().currentTime; felt.tap(t); chime(t + 0.04, N.C5, 0.05, 0.4); },
  promote() { const t = setup().currentTime; felt.tap(t); chime(t + 0.06, N.G4, 0.06, 0.5); },
  tick() { body(setup().currentTime, 300, { gain: 0.05, attack: 0.005, decay: 0.03, lp: 600 }); },
};
// Marble: clean, short and crisp but not sharp
const marble = {
  ...common,
  tap(t, k = 1) {
    const f = jitter(640 * k);
    body(t, f, { gain: 0.16, attack: 0.002, decay: 0.045, lp: 3000 });
    body(t, f * 2.7, { gain: 0.04, attack: 0.002, decay: 0.02, lp: 3000 });
    body(t, 160, { gain: 0.14, attack: 0.003, decay: 0.05, glide: 0.8 });
  },
  move() { marble.tap(setup().currentTime); },
  capture() { const t = setup().currentTime; marble.tap(t, 0.85); marble.tap(t + 0.03, 1.15); },
  castle() { const t = setup().currentTime; marble.tap(t); marble.tap(t + 0.14, 0.9); },
  check() { const t = setup().currentTime; marble.tap(t); chime(t + 0.03, N.A4 * 2, 0.05, 0.4); },
  promote() { const t = setup().currentTime; marble.tap(t); chime(t + 0.05, N.E5, 0.06, 0.5); },
  tick() { body(setup().currentTime, 900, { gain: 0.04, attack: 0.002, decay: 0.02, lp: 2500 }); },
};
// Soft piano: every move is a mellow note from a calm scale
const SCALE = [N.C4, N.D4, N.E4, N.G4, N.A4, N.C5];
let note = 0;
const keyNote = (t, f, g = 0.22, d = 0.45) => {
  body(t, f, { gain: g, attack: 0.008, decay: d, type: 'triangle', lp: 1400 });
  body(t, f / 2, { gain: g * 0.4, attack: 0.008, decay: d * 0.8, lp: 900 });
};
const piano = {
  ...common,
  move() { note = (note + 1 + Math.floor(Math.random() * 2)) % SCALE.length; keyNote(setup().currentTime, SCALE[note]); },
  capture() { const t = setup().currentTime; keyNote(t, N.C4, 0.2); keyNote(t + 0.06, N.G3, 0.18, 0.55); },
  castle() { const t = setup().currentTime; keyNote(t, N.E4, 0.2); keyNote(t + 0.14, N.G4, 0.19); },
  check() { const t = setup().currentTime; keyNote(t, N.E4, 0.17); keyNote(t, N.A4, 0.14); },
  promote() { const t = setup().currentTime; [N.C4, N.E4, N.G4].forEach((f, i) => keyNote(t + i * 0.07, f, 0.16)); },
  tick() { keyNote(setup().currentTime, N.C5, 0.03, 0.1); },
};
// Bubbles: soft rounded pops
const bubble = {
  ...common,
  pop(t, f) { body(t, jitter(f), { gain: 0.3, attack: 0.006, decay: 0.07, glide: 1.6, lp: 1600 }); },
  move() { bubble.pop(setup().currentTime, 260); },
  capture() { const t = setup().currentTime; bubble.pop(t, 200); bubble.pop(t + 0.06, 300); },
  castle() { const t = setup().currentTime; bubble.pop(t, 240); bubble.pop(t + 0.13, 280); },
  check() { const t = setup().currentTime; bubble.pop(t, 260); chime(t + 0.05, N.E5, 0.05, 0.35); },
  promote() { const t = setup().currentTime; [220, 280, 360].forEach((f, i) => bubble.pop(t + i * 0.07, f)); },
  tick() { bubble.pop(setup().currentTime, 420); },
};

/* ---------------- earlier styles (kept for anyone who liked them) ---------------- */
function tock(t, { gain = 1, pitch = 1, decay = 1 } = {}) {
  gain *= 0.4;   // brought down to the same loudness as the other styles
  const c = setup(), f0 = jitter(760 * pitch, 0.04);
  const n = c.createBufferSource(); n.buffer = noise;
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = jitter(3200 * pitch); bp.Q.value = 0.9;
  const ng = c.createGain(); ng.gain.setValueAtTime(0.55 * gain, t); ng.gain.exponentialRampToValueAtTime(0.0008, t + 0.012);
  n.connect(bp).connect(ng).connect(out); n.start(t, Math.random() * 0.4); n.stop(t + 0.02);
  [[1, 0.5, 0.075], [2.31, 0.28, 0.045], [4.1, 0.14, 0.022]].forEach(([r, g, d]) => {
    const o = c.createOscillator(); o.frequency.value = f0 * r;
    const og = c.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(g * gain, t + 0.0015); og.gain.exponentialRampToValueAtTime(0.0001, t + d * decay);
    o.connect(og).connect(out); o.start(t); o.stop(t + d * decay + 0.02);
  });
  body(t, jitter(190 * pitch), { gain: 0.42 * gain, attack: 0.003, decay: 0.11 * decay, glide: 0.58 });
}
const crisp = {
  ...common,
  move() { tock(setup().currentTime); },
  capture() { const t = setup().currentTime; tock(t, { gain: 1.25, pitch: 1.12 }); tock(t + 0.022, { gain: 0.45, pitch: 0.82, decay: 0.7 }); },
  castle() { const t = setup().currentTime; tock(t); tock(t + 0.12, { gain: 0.8, pitch: 0.9 }); },
  check() { const t = setup().currentTime; tock(t, { gain: 1.1 }); chime(t + 0.03, 880, 0.1, 0.5); },
  promote() { const t = setup().currentTime; tock(t); chime(t + 0.04, N.E5, 0.12, 0.4); chime(t + 0.14, 880, 0.12, 0.6); },
  tick() { tock(setup().currentTime, { gain: 0.22, pitch: 1.6, decay: 0.4 }); },
};
function knock(t, freq = 900, dur = 0.07, gain = 0.9) {
  gain *= 0.55;
  const c = setup();
  const src = c.createBufferSource(); src.buffer = noise;
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1.4;
  const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(bp).connect(g).connect(out); src.start(t); src.stop(t + dur + 0.02);
  body(t, freq / 4, { gain: gain * 0.5, attack: 0.001, decay: dur, glide: 0.3 });
}
const classic = {
  ...common,
  move() { knock(setup().currentTime, 800, 0.06); },
  capture() { const t = setup().currentTime; knock(t, 1400, 0.09, 1); knock(t + 0.03, 500, 0.08, 0.6); },
  castle() { const t = setup().currentTime; knock(t, 800, 0.06); knock(t + 0.11, 700, 0.06); },
  check() { const t = setup().currentTime; knock(t, 900, 0.06); chime(t + 0.02, 880, 0.12, 0.2); },
  promote() { const t = setup().currentTime; knock(t, 800, 0.06); chime(t, 660, 0.15, 0.15); chime(t + 0.1, 990, 0.15, 0.2); },
  tick() { body(setup().currentTime, 1200, { gain: 0.04, attack: 0.001, decay: 0.03 }); },
};

export const SOUND_THEMES = [
  ['soft', 'Soft wood', 'Warm, rounded wooden taps (recommended)'],
  ['felt', 'Felt', 'Muffled and very quiet, like felt-bottomed pieces'],
  ['marble', 'Marble', 'Clean and short, still gentle'],
  ['piano', 'Soft piano', 'Each move plays a calm note'],
  ['bubble', 'Bubbles', 'Light, round pops'],
  ['wood', 'Crisp wood', 'The earlier, brighter wooden sound'],
  ['classic', 'Classic clicks', 'The original simple clicks'],
];
const themes = { soft, felt, marble, piano, bubble, wood: crisp, classic };
export const sfx = new Proxy({}, {
  get: (_, name) => () => { if (!volume) return; try { (themes[getPrefs().soundTheme] || soft)[name]?.(); } catch (e) { console.warn(e); } },
});
/** For previews and tests: play a sound from a specific style. */
export function playTheme(theme, name) { try { (themes[theme] || soft)[name]?.(); } catch (e) { console.warn(e); } }
