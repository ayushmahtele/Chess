let ctx = null, override = null;
/** Tests can render sounds into an OfflineAudioContext. */
export function setAudioCtxOverride(c) { override = c; }
export function audioCtx() {
  if (override) return override;
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
export function noiseBuffer(c, seconds = 1) {
  const b = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
