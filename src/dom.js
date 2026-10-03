// The browser's built-in el.append() prints `false`/`null` as text. Optional parts of the UI are often
// written as `condition && h(...)`, so skip those values everywhere instead of showing "false".
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  const native = proto.append;
  proto.append = function (...nodes) { return native.apply(this, nodes.filter(n => n != null && n !== false && n !== true)); };
}

// Tiny DOM helper: h('div.class#id', {attrs, on:{click}}, ...children)
export function h(tag, props, ...kids) {
  if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) { kids.unshift(props); props = {}; }
  const [name, ...rest] = tag.split(/(?=[.#])/);
  const el = document.createElement(name || 'div');
  for (const r of rest) { if (r[0] === '.') el.classList.add(r.slice(1)); else el.id = r.slice(1); }
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = c => { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(add); else el.append(c instanceof Node ? c : document.createTextNode(String(c))); };
  kids.forEach(add);
  return el;
}
export const $ = (s, r = document) => r.querySelector(s);
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function toast(msg, kind = '') {
  const t = h('div.toast', { class: kind, role: 'status' }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3000);
}

/** exit: optional { title, value } adds a ✕ in the top-right corner that resolves with that value. */
export function modal({ title, body, actions = [], dismissable = true, className = '', exit = null }) {
  return new Promise(resolve => {
    const root = document.getElementById('modal-root');
    let done = false;
    const close = v => { if (done) return; done = true; wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = e => { if (e.key === 'Escape' && dismissable) close(null); };
    const wrap = h('div.modal-wrap', { on: { click: e => { if (e.target === wrap && dismissable) close(null); } } },
      h('div.modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, class: className + (exit ? ' has-exit' : '') },
        exit && h('button.modal-x', { type: 'button', title: exit.title, 'aria-label': exit.title, on: { click: () => close(exit.value) } }, '✕'),
        title && h('h2', title),
        body,
        actions.length ? h('div.modal-actions', actions.map(a =>
          h('button.btn', { class: a.kind || '', on: { click: () => close(a.value) } }, a.label))) : null));
    root.append(wrap);
    document.addEventListener('keydown', onKey);
    setTimeout(() => (wrap.querySelector('.modal-actions .primary') || wrap.querySelector('button'))?.focus(), 30);
  });
}
export const confirmBox = (title, text, okLabel = 'Confirm', danger = false) =>
  modal({ title, body: h('p', text), actions: [{ label: 'Cancel', value: false }, { label: okLabel, value: true, kind: danger ? 'danger' : 'primary' }] });

export function fmtClock(ms) {
  if (ms <= 0) return '0:00';
  const s = ms / 1000;
  if (s < 10) return '0:0' + s.toFixed(1);
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return m + ':' + String(r).padStart(2, '0');
}
export function fmtDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
export function fmtDuration(ms) {
  const s = Math.round(ms / 1000), m = Math.floor(s / 60);
  return m ? `${m}m ${s % 60}s` : `${s}s`;
}
