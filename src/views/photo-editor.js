// Pick, position and zoom a profile picture. Produces a small square image (about 10 KB).
import { h, modal, toast } from '../dom.js';

const OUT = 160;      // saved size in pixels
const VIEW = 240;     // size of the editor preview

export async function openPhotoEditor(currentSrc) {
  let img = null, zoom = 1, ox = 0, oy = 0;      // offsets in preview pixels
  const canvas = h('canvas.photo-canvas', { width: VIEW * 2, height: VIEW * 2, 'aria-label': 'Photo preview. Drag to move.' });
  const ctx = canvas.getContext('2d');
  const file = h('input', { type: 'file', accept: 'image/*', class: 'hidden' });
  const zoomIn = h('input.range', { type: 'range', min: 1, max: 4, step: 0.01, value: 1, 'aria-label': 'Zoom', disabled: true });
  const hint = h('p.muted', { style: { margin: '6px 0 0', fontSize: '.85rem' } }, 'Choose a photo, then drag to move it and use the slider to zoom.');

  function baseScale() { return img ? Math.max(VIEW / img.width, VIEW / img.height) : 1; }
  function clamp() {
    if (!img) return;
    const s = baseScale() * zoom, w = img.width * s, hgt = img.height * s;
    const mx = Math.max(0, (w - VIEW) / 2), my = Math.max(0, (hgt - VIEW) / 2);
    ox = Math.max(-mx, Math.min(mx, ox)); oy = Math.max(-my, Math.min(my, oy));
  }
  function draw(target = ctx, size = VIEW * 2) {
    const k = size / VIEW;
    target.clearRect(0, 0, size, size);
    target.fillStyle = '#2a2d33'; target.fillRect(0, 0, size, size);
    if (!img) return;
    const s = baseScale() * zoom * k, w = img.width * s, hgt = img.height * s;
    target.imageSmoothingQuality = 'high';
    target.drawImage(img, (size - w) / 2 + ox * k, (size - hgt) / 2 + oy * k, w, hgt);
  }
  function load(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  }
  async function useFile(f) {
    if (!f) return;
    if (!f.type.startsWith('image/')) { toast('Please choose an image file.', 'error'); return; }
    const url = URL.createObjectURL(f);
    try { img = await load(url); zoom = 1; ox = oy = 0; zoomIn.value = 1; zoomIn.disabled = false; hint.textContent = 'Drag to move · use the slider to zoom.'; draw(); }
    catch { toast('That image could not be opened. Try a JPG or PNG.', 'error'); }
    finally { URL.revokeObjectURL(url); }
  }
  file.addEventListener('change', e => useFile(e.target.files[0]));
  zoomIn.addEventListener('input', () => { zoom = +zoomIn.value; clamp(); draw(); });

  // drag to reposition (mouse and touch)
  let drag = null;
  canvas.addEventListener('pointerdown', e => { if (!img) { file.click(); return; } drag = { x: e.clientX, y: e.clientY, ox, oy }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const r = canvas.getBoundingClientRect(), k = VIEW / r.width;
    ox = drag.ox + (e.clientX - drag.x) * k; oy = drag.oy + (e.clientY - drag.y) * k; clamp(); draw();
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('wheel', e => { if (!img) return; e.preventDefault(); zoom = Math.max(1, Math.min(4, zoom * (e.deltaY < 0 ? 1.08 : 0.93))); zoomIn.value = zoom; clamp(); draw(); }, { passive: false });

  if (currentSrc) { try { img = await load(currentSrc); zoomIn.disabled = false; } catch {} }
  draw();

  const body = h('div.photo-editor',
    h('div.photo-frame', canvas),
    h('div.vol', h('label', 'Zoom'), zoomIn),
    hint,
    file,
    h('button.btn', { style: { width: '100%', marginTop: '10px' }, on: { click: () => file.click() } }, 'Choose a photo…'));

  const choice = await modal({
    title: 'Profile picture', body, className: 'photo-modal',
    actions: [{ label: 'Remove', value: 'remove' }, { label: 'Cancel', value: null }, { label: 'Save', value: 'save', kind: 'primary' }],
  });
  if (choice === 'remove') return 'none';
  if (choice !== 'save' || !img) return null;
  const outC = h('canvas', { width: OUT, height: OUT });
  draw(outC.getContext('2d'), OUT);
  let data = outC.toDataURL('image/webp', 0.86);
  if (!data.startsWith('data:image/webp')) data = outC.toDataURL('image/jpeg', 0.86);   // older Safari
  return data;
}
